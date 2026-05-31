import "dotenv/config";
import type Database from "better-sqlite3";
import { pathToFileURL } from "node:url";
import { config } from "../../config.js";
import { openDatabase } from "../../database.js";
import { loadTerminals, loadVesselNames, previousVesselPosition, saveVessel } from "./db.js";
import { logger } from "../../logger.js";
import { runAisStreamLoop } from "./aisstream.js";
import { createMarineTrafficClient, runMarineTrafficPollLoop } from "./marine-traffic.js";
import type {
  OrganisationId,
  OrganisationVessels,
  PositionUpdate,
  SourceVesselUpdate,
  TerminalReference,
  VesselPosition
} from "./types.js";

export function enrichVoyage(
  db: Database.Database,
  terminals: TerminalReference[],
  organisationId: number,
  position: PositionUpdate
): Pick<VesselPosition, "originName" | "originDepartedAt" | "destinationName"> {
  const previous = previousVesselPosition(db, position.mmsi);
  const previousTerminal = previous ? nearestTerminal(terminals, organisationId, previous) : undefined;
  const currentTerminal = nearestTerminal(terminals, organisationId, position);

  if (currentTerminal) {
    return {
      destinationName: destinationAtTerminal(terminals, organisationId, currentTerminal, position, previous?.destinationName),
      originName: currentTerminal.name
    };
  }

  if (previousTerminal) {
    const originDepartedAt = position.receivedAt;
    return {
      destinationName: destinationForPosition(terminals, organisationId, position, previousTerminal, undefined),
      originName: previousTerminal.name,
      originDepartedAt
    };
  }

  if (previous?.originName && previous.originDepartedAt) {
    const origin = originFromName(terminals, organisationId, previous.originName);
    return {
      destinationName: destinationForPosition(terminals, organisationId, position, origin, previous.destinationName),
      originName: previous.originName,
      originDepartedAt: previous.originDepartedAt
    };
  }

  return {};
}

const terminalDepartureRadiusKm = 0.75;

const trackedVessels: OrganisationVessels[] = [
  {
    organisationId: 1,
    organisationName: "CalMac",
    mmsis: [
      232003244,
      235104000,
      232000420,
      232003376,
      232003369,
      232003371,
      232003370,
      232343000,
      232605000,
      232003165,
      232003368,
      232003372,
      232001580,
      232002521,
      232002598,
      232003073,
      232003288,
      235056506,
      235000141,
      235000864,
      235087611,
      235008928,
      235008929,
      235025112,
      235052541,
      235053239,
      235052285,
      235083892,
      235099235,
      235099237,
      235101635,
      235116772,
      232003166,
      232019501,
      232049068
    ]
  },
  {
    organisationId: 2,
    organisationName: "NorthLink",
    mmsis: [235449000, 235450000, 235448000]
  },
  {
    organisationId: 3,
    organisationName: "Western Ferries",
    mmsis: [235001902, 235013197, 235101062, 235101063]
  },
  {
    organisationId: 4,
    organisationName: "Shetland Ferries",
    mmsis: [
      232003606,
      232003604,
      232003597,
      232003605,
      235009928,
      232003608,
      232003598,
      235003893,
      235014766,
      235014768,
      232003596,
      232003607
    ]
  },
  {
    organisationId: 5,
    organisationName: "Orkney Ferries",
    mmsis: [
      232000670,
      232000760,
      232000550,
      235019175,
      235018907,
      235021681,
      235019173,
      235019174,
      235018919,
      232029607
    ]
  },
  {
    organisationId: 6,
    organisationName: "Pentland Ferries",
    mmsis: [235061705]
  },
  {
    organisationId: 7,
    organisationName: "Highland Council",
    mmsis: [235001223, 235002334]
  }
];

function trackedVesselMap(): Map<number, OrganisationId> {
  const map = new Map<number, OrganisationId>();
  for (const { organisationId, organisationName, mmsis } of trackedVessels) {
    for (const mmsi of mmsis) {
      if (map.has(mmsi)) {
        logger.warn({ mmsi, organisationName }, "Ignoring duplicate tracked vessel MMSI");
        continue;
      }
      map.set(mmsi, organisationId);
    }
  }
  return map;
}

function allTrackedMmsis(vesselOrganisations: Map<number, OrganisationId>): string[] {
  return [...vesselOrganisations.keys()].map(String);
}

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const earthRadiusKm = 6371;
  const lat1 = a.latitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const deltaLatitude = (b.latitude - a.latitude) * Math.PI / 180;
  const deltaLongitude = (b.longitude - a.longitude) * Math.PI / 180;
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function nearestTerminal(
  terminals: TerminalReference[],
  organisationId: number,
  position: { latitude: number; longitude: number }
): TerminalReference | undefined {
  let nearest: { terminal: TerminalReference; distance: number } | undefined;
  for (const terminal of terminals) {
    if (terminal.organisationId !== organisationId) {
      continue;
    }

    const distance = distanceKm(position, terminal);
    if (distance <= terminalDepartureRadiusKm && (nearest === undefined || distance < nearest.distance)) {
      nearest = { terminal, distance };
    }
  }
  return nearest?.terminal;
}

function serviceTerminals(terminals: TerminalReference[], serviceId: number): TerminalReference[] {
  return terminals.filter((terminal) => terminal.serviceId === serviceId);
}

function withinServiceBox(
  terminals: TerminalReference[],
  position: { latitude: number; longitude: number }
): boolean {
  const padding = 0.02;
  const latitudes = terminals.map((terminal) => terminal.latitude);
  const longitudes = terminals.map((terminal) => terminal.longitude);
  return position.latitude >= Math.min(...latitudes) - padding
    && position.latitude <= Math.max(...latitudes) + padding
    && position.longitude >= Math.min(...longitudes) - padding
    && position.longitude <= Math.max(...longitudes) + padding;
}

function destinationFromOrigin(
  terminals: TerminalReference[],
  origin: TerminalReference,
  position: PositionUpdate
): string | undefined {
  const candidates = terminals.filter((terminal) => terminal.name === origin.name && terminal.organisationId === origin.organisationId);
  const destinations = new Set<string>();
  for (const candidate of candidates) {
    const routeTerminals = serviceTerminals(terminals, candidate.serviceId);
    if (routeTerminals.length !== 2 || !withinServiceBox(routeTerminals, position)) {
      continue;
    }

    const destination = routeTerminals.find((terminal) => terminal.name !== candidate.name);
    if (destination) {
      destinations.add(destination.name);
    }
  }
  return destinations.size === 1 ? [...destinations][0] : undefined;
}

function normalizeLocationName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bqy\b/g, "quay")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function locationNameTokens(value: string): string[] {
  return normalizeLocationName(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !["bay", "pier", "point", "quay", "slip", "terminal"].includes(token));
}

function destinationTokenMatches(targetTokens: string[], token: string): boolean {
  return targetTokens.some((targetToken) => (
    targetToken === token ||
    targetToken === `${token}s` ||
    token === `${targetToken}s` ||
    (token.length >= 5 && targetToken.length >= 5 && (
      targetToken.startsWith(token) ||
      token.startsWith(targetToken)
    ))
  ));
}

function rawDestinationIncludesLocation(rawDestination: string, locationName: string): boolean {
  const target = normalizeLocationName(rawDestination);
  const location = normalizeLocationName(locationName);
  const tokens = locationNameTokens(locationName);
  if (target === "" || location === "" || tokens.length === 0) {
    return false;
  }

  if (target === location || target.includes(location)) {
    return true;
  }

  const targetTokens = target.split(" ");
  return tokens.every((token) => destinationTokenMatches(targetTokens, token)) ||
    tokens.some((token) => token.length >= 5 && destinationTokenMatches(targetTokens, token));
}

function matchingTerminalDestinations(
  terminals: TerminalReference[],
  organisationId: number,
  rawDestination: string | undefined,
  excludedName?: string
): TerminalReference[] {
  if (rawDestination === undefined) {
    return [];
  }

  return terminals.filter((terminal) => (
    terminal.organisationId === organisationId &&
    terminal.name !== excludedName &&
    rawDestinationIncludesLocation(rawDestination, terminal.name)
  ));
}

function matchingTerminalDestination(
  terminals: TerminalReference[],
  organisationId: number,
  rawDestination: string | undefined,
  excludedName?: string
): string | undefined {
  const matches = new Map<string, TerminalReference>();
  for (const terminal of matchingTerminalDestinations(terminals, organisationId, rawDestination, excludedName)) {
    matches.set(terminal.name, terminal);
  }
  return matches.size === 1 ? [...matches.values()][0]?.name : undefined;
}

function routeMatchedDestination(
  terminals: TerminalReference[],
  origin: TerminalReference | undefined,
  position: PositionUpdate,
  rawDestination: string | undefined
): string | undefined {
  if (origin === undefined || rawDestination === undefined) {
    return undefined;
  }

  const originCandidates = terminals.filter((terminal) => (
    terminal.organisationId === origin.organisationId &&
    terminal.name === origin.name
  ));

  for (const candidate of originCandidates) {
    const routeTerminals = serviceTerminals(terminals, candidate.serviceId);
    const destination = routeTerminals.find((terminal) => (
      terminal.name !== candidate.name &&
      rawDestinationIncludesLocation(rawDestination, terminal.name)
    ));
    if (destination && withinServiceBox(routeTerminals, position)) {
      return destination.name;
    }
  }

  return undefined;
}

function routeDerivedDestination(
  terminals: TerminalReference[],
  origin: TerminalReference | undefined,
  position: PositionUpdate
): string | undefined {
  return origin ? destinationFromOrigin(terminals, origin, position) : undefined;
}

function originFromName(
  terminals: TerminalReference[],
  organisationId: number,
  rawOrigin: string | undefined
): TerminalReference | undefined {
  if (rawOrigin === undefined) {
    return undefined;
  }

  const target = normalizeLocationName(rawOrigin);
  return terminals.find((terminal) => (
    terminal.organisationId === organisationId &&
    normalizeLocationName(terminal.name) === target
  ));
}

function destinationAtTerminal(
  terminals: TerminalReference[],
  organisationId: number,
  currentTerminal: TerminalReference,
  position: PositionUpdate,
  fallback: string | undefined
): string | undefined {
  return matchingTerminalDestination(terminals, organisationId, position.destinationName, currentTerminal.name)
    ?? matchingTerminalDestination(terminals, organisationId, fallback, currentTerminal.name);
}

function destinationForPosition(
  terminals: TerminalReference[],
  organisationId: number,
  position: PositionUpdate,
  origin: TerminalReference | undefined,
  fallback: string | undefined
): string | undefined {
  if (origin === undefined) {
    return matchingTerminalDestination(terminals, organisationId, position.destinationName)
      ?? matchingTerminalDestination(terminals, organisationId, fallback);
  }

  return routeMatchedDestination(terminals, origin, position, position.destinationName)
    ?? routeDerivedDestination(terminals, origin, position)
    ?? routeMatchedDestination(terminals, origin, position, fallback);
}

function vesselPosition(
  db: Database.Database,
  terminals: TerminalReference[],
  vesselOrganisations: Map<number, OrganisationId>,
  vesselNames: Map<number, string>,
  position: PositionUpdate
): VesselPosition | null {
  const organisationId = vesselOrganisations.get(position.mmsi);
  if (organisationId === undefined) {
    return null;
  }

  const previous = previousVesselPosition(db, position.mmsi);
  const name = vesselNames.get(position.mmsi) ?? previous?.name ?? `MMSI ${position.mmsi}`;
  return {
    mmsi: position.mmsi,
    name,
    speed: position.speed,
    course: position.course,
    latitude: position.latitude,
    longitude: position.longitude,
    lastReceived: position.receivedAt,
    organisationId,
    ...enrichVoyage(db, terminals, organisationId, position)
  };
}

function saveSourceUpdate(
  db: Database.Database,
  terminals: TerminalReference[],
  vesselOrganisations: Map<number, OrganisationId>,
  vesselNames: Map<number, string>,
  update: SourceVesselUpdate
): void {
  if (update.name && vesselOrganisations.has(update.position.mmsi)) {
    vesselNames.set(update.position.mmsi, update.name);
  }

  const vessel = vesselPosition(db, terminals, vesselOrganisations, vesselNames, update.position);
  if (!vessel) {
    return;
  }

  saveVessel(db, vessel);
  logger.info({ mmsi: vessel.mmsi, vesselName: vessel.name }, "Saved vessel update");
}

async function main(): Promise<void> {
  const client = await createMarineTrafficClient();
  let db: Database.Database | undefined;

  try {
    db = openDatabase();
    const terminals = loadTerminals(db);
    const vesselNames = loadVesselNames(db);
    const vesselOrganisations = trackedVesselMap();
    const saveUpdate = (update: SourceVesselUpdate): void => {
      saveSourceUpdate(db as Database.Database, terminals, vesselOrganisations, vesselNames, update);
    };
    const saveName = (mmsi: number, name: string): void => {
      if (vesselOrganisations.has(mmsi)) {
        vesselNames.set(mmsi, name);
      }
    };
    if (config.aisStreamApiKey) {
      await Promise.all([
        runAisStreamLoop(config.aisStreamApiKey, allTrackedMmsis(vesselOrganisations), saveUpdate, saveName),
        runMarineTrafficPollLoop(client, trackedVessels, saveUpdate)
      ]);
    } else {
      await runMarineTrafficPollLoop(client, trackedVessels, saveUpdate);
    }
  } finally {
    await client.exit();
    db?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
