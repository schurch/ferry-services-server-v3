import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import { config } from "../../config.js";
import { openDatabase } from "../../database.js";
import { replaceRailDepartures } from "./db.js";
import { logger } from "../../logger.js";
import type { RailDeparture } from "./types.js";
type RailLocation = {
  locationName?: unknown;
  crs?: unknown;
};

type RailTrainService = {
  destination?: unknown;
  currentDestinations?: unknown;
  std?: unknown;
  etd?: unknown;
  platform?: unknown;
  isCancelled?: unknown;
};

type RailDepartureBoard = {
  locationName?: unknown;
  crs?: unknown;
  trainServices?: unknown;
};

type RailStation = {
  crs: string;
  locationId: number;
};
const railStations: RailStation[] = [
  { crs: "ADS", locationId: 3 },
  { crs: "LAR", locationId: 11 },
  { crs: "WMS", locationId: 7 },
  { crs: "GRK", locationId: 56 },
  { crs: "OBN", locationId: 19 },
  { crs: "MLG", locationId: 44 },
  { crs: "THS", locationId: 59 },
  { crs: "ABD", locationId: 61 },
  { crs: "TRN", locationId: 97 }
];
function isRailLocation(value: unknown): value is { locationName: string; crs: string } {
  const location = value as RailLocation;
  return typeof location?.locationName === "string" && typeof location.crs === "string";
}

function railLocations(value: unknown): Array<{ locationName: string; crs: string }> {
  return Array.isArray(value) ? value.filter(isRailLocation) : [];
}

function scheduledTime(value: string): string | null {
  return /^\d{2}:\d{2}(:\d{2})?$/.test(value) ? value : null;
}

function departureFromService(
  board: { locationName: string; crs: string },
  service: RailTrainService,
  locationId: number
): RailDeparture | null {
  if (
    typeof service.std !== "string" ||
    typeof service.etd !== "string" ||
    typeof service.isCancelled !== "boolean" ||
    (service.platform !== undefined && service.platform !== null && typeof service.platform !== "string")
  ) {
    return null;
  }

  const destination = railLocations(service.destination)[0];
  if (!destination) {
    return null;
  }

  const currentDestination = railLocations(service.currentDestinations)[0];
  if (currentDestination?.crs === board.crs) {
    return null;
  }

  const departureTime = scheduledTime(service.std);
  if (!departureTime) {
    return null;
  }

  return {
    departureCrs: board.crs,
    departureName: board.locationName,
    destinationCrs: destination.crs,
    destinationName: destination.locationName,
    scheduledDepartureTime: departureTime,
    estimatedDepartureTime: service.etd,
    cancelled: service.isCancelled,
    platform: service.platform ?? undefined,
    locationId
  };
}

function railDepartures(value: RailDepartureBoard, locationId: number): RailDeparture[] | null {
  if (typeof value.locationName !== "string" || typeof value.crs !== "string") {
    return null;
  }

  if (value.trainServices === undefined || value.trainServices === null) {
    return [];
  }

  if (!Array.isArray(value.trainServices)) {
    return null;
  }

  const board = { locationName: value.locationName, crs: value.crs };
  return value.trainServices
    .map((service) => departureFromService(board, service as RailTrainService, locationId))
    .filter((departure): departure is RailDeparture => departure !== null);
}
async function fetchRailDepartures(apiKey: string, station: RailStation): Promise<RailDeparture[] | null> {
  const url = new URL(`https://api1.raildata.org.uk/1010-live-departure-board-dep/LDBWS/api/20220120/GetDepBoardWithDetails/${station.crs}`);
  logger.info({ crs: station.crs, locationId: station.locationId }, "Fetching rail departures");

  try {
    const response = await fetch(url, {
      headers: { "x-apikey": apiKey },
      signal: AbortSignal.timeout(20_000)
    });
    const body = await response.text();
    if (!response.ok) {
      logger.warn({ crs: station.crs, locationId: station.locationId, statusCode: response.status, responseBody: body.slice(0, 500) }, "Skipping rail departures because Rail Data returned an error");
      return null;
    }

    const parsed = JSON.parse(body) as RailDepartureBoard;
    const departures = railDepartures(parsed, station.locationId);
    if (!departures) {
      logger.warn({ crs: station.crs, locationId: station.locationId }, "Skipping rail departures because Rail Data response could not be parsed");
      return null;
    }

    logger.info({ crs: station.crs, locationId: station.locationId, departureCount: departures.length }, "Fetched rail departures");
    return departures;
  } catch (error) {
    logger.warn({ err: error, crs: station.crs, locationId: station.locationId }, "Skipping rail departures because fetch failed");
    return null;
  }
}
async function main(): Promise<void> {
  if (!config.railDataApiKey) {
    logger.warn("RAIL_DATA_API_KEY is not set; skipping rail departure fetch");
    return;
  }

  const db = openDatabase();
  try {
    for (const station of railStations) {
      const departures = await fetchRailDepartures(config.railDataApiKey, station);
      if (departures) {
        replaceRailDepartures(db, station.crs, departures);
      }
      await delay(1_000);
    }
  } finally {
    db.close();
  }
}

await main();
