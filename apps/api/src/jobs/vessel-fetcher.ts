import "dotenv/config";
import type Database from "better-sqlite3";
import { setTimeout as delay } from "node:timers/promises";
import { config } from "../config.js";
import { openDatabase } from "../db/database.js";
import { saveVessel } from "../db/fetchers.js";
import { logger } from "../logger.js";
import type { VesselPosition } from "../types/fetchers.js";

type OrganisationId = number;
type Mmsi = number;

type OrganisationVessels = {
  organisationId: OrganisationId;
  organisationName: string;
  mmsis: Mmsi[];
};

type AisStreamMessage = {
  MessageType?: unknown;
  Metadata?: Record<string, unknown>;
  Message?: Record<string, unknown>;
};

type PositionUpdate = {
  mmsi: number;
  latitude: number;
  longitude: number;
  speed?: number;
  course?: number;
  destinationName?: string;
  eta?: string;
  receivedAt: string;
};

type TerminalReference = {
  organisationId: number;
  serviceId: number;
  name: string;
  latitude: number;
  longitude: number;
};

type PreviousVesselPosition = {
  name: string;
  latitude: number;
  longitude: number;
  destinationName?: string;
  eta?: string;
  originName?: string;
  originDepartedAt?: string;
};

const aisStreamUrl = "wss://stream.aisstream.io/v0/stream";
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

function parseNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseInteger(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function sqlTimestamp(date = new Date()): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function capitaliseWords(value: string): string {
  return value.split(/\s+/).filter(Boolean).map((word) => {
    const upper = word.toUpperCase();
    if (upper === "OF" || upper === "THE") {
      return upper.toLowerCase();
    }
    return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
  }).join(" ");
}

function cleanAisText(value: string): string | undefined {
  const cleaned = value.replace(/@/g, " ").trim().replace(/\s+/g, " ");
  return cleaned === "" ? undefined : cleaned;
}

function parseAisEta(value: unknown, now = new Date()): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const eta = value as Record<string, unknown>;
  const month = parseInteger(eta.Month);
  const day = parseInteger(eta.Day);
  const hour = parseInteger(eta.Hour);
  const minute = parseInteger(eta.Minute);
  if (
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  ) {
    return undefined;
  }

  const currentYear = now.getUTCFullYear();
  const candidates = [currentYear - 1, currentYear, currentYear + 1]
    .map((year) => new Date(Date.UTC(year, month - 1, day, hour, minute)));
  const best = candidates.reduce((nearest, candidate) => (
    Math.abs(candidate.getTime() - now.getTime()) < Math.abs(nearest.getTime() - now.getTime()) ? candidate : nearest
  ));
  return sqlTimestamp(best);
}

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

function aisMessageBody(message: AisStreamMessage): Record<string, unknown> {
  const messageType = parseText(message.MessageType);
  const value = messageType ? message.Message?.[messageType] : undefined;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parsePositionUpdate(message: AisStreamMessage): PositionUpdate | null {
  const body = aisMessageBody(message);
  const metadata = message.Metadata ?? {};
  const mmsi = parseInteger(body.UserID ?? body.MMSI ?? body.Mmsi ?? metadata.MMSI ?? metadata.ShipMMSI);
  const latitude = parseNumber(body.Latitude ?? metadata.Latitude ?? metadata.latitude);
  const longitude = parseNumber(body.Longitude ?? metadata.Longitude ?? metadata.longitude);
  if (mmsi === undefined || latitude === undefined || longitude === undefined) {
    return null;
  }

  return {
    mmsi,
    latitude,
    longitude,
    speed: parseNumber(body.Sog ?? body.SOG ?? metadata.Sog ?? metadata.SOG),
    course: parseNumber(body.Cog ?? body.COG ?? metadata.Cog ?? metadata.COG),
    destinationName: parseText(body.Destination) ? cleanAisText(String(body.Destination)) : undefined,
    eta: parseAisEta(body.Eta),
    receivedAt: sqlTimestamp()
  };
}

function parseShipName(message: AisStreamMessage): { mmsi: number; name: string } | null {
  const body = aisMessageBody(message);
  const metadata = message.Metadata ?? {};
  const mmsi = parseInteger(body.UserID ?? body.MMSI ?? body.Mmsi ?? metadata.MMSI ?? metadata.ShipMMSI);
  const rawName = parseText(body.Name ?? body.ShipName ?? body.NameExtension ?? metadata.ShipName);
  if (mmsi === undefined || rawName === undefined) {
    return null;
  }
  return { mmsi, name: capitaliseWords(rawName) };
}

async function eventDataText(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (data instanceof Blob) {
    return data.text();
  }
  return String(data);
}

function loadTerminals(db: Database.Database): TerminalReference[] {
  return db.prepare(`
    SELECT DISTINCT
      s.organisation_id AS organisationId,
      sl.service_id AS serviceId,
      l.name,
      l.latitude,
      l.longitude
    FROM service_locations sl
    JOIN services s ON s.service_id = sl.service_id
    JOIN locations l ON l.location_id = sl.location_id
  `).all() as TerminalReference[];
}

function loadVesselNames(db: Database.Database): Map<number, string> {
  const rows = db.prepare(`
    SELECT mmsi, name
    FROM vessels
  `).all() as Array<{ mmsi: number; name: string }>;

  return new Map(rows.map((row) => [row.mmsi, row.name]));
}

function previousVesselPosition(db: Database.Database, mmsi: number): PreviousVesselPosition | undefined {
  const row = db.prepare(`
    SELECT name, latitude, longitude, destination_name, eta, origin_name, origin_departed_at
    FROM vessels
    WHERE mmsi = ?
  `).get(mmsi) as {
    name: string;
    latitude: number;
    longitude: number;
    destination_name: string | null;
    eta: string | null;
    origin_name: string | null;
    origin_departed_at: string | null;
  } | undefined;

  return row
    ? {
        name: row.name,
        latitude: row.latitude,
        longitude: row.longitude,
        destinationName: row.destination_name ?? undefined,
        eta: row.eta ?? undefined,
        originName: row.origin_name ?? undefined,
        originDepartedAt: row.origin_departed_at ?? undefined
      }
    : undefined;
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
  for (const candidate of candidates) {
    const routeTerminals = serviceTerminals(terminals, candidate.serviceId);
    if (routeTerminals.length !== 2 || !withinServiceBox(routeTerminals, position)) {
      continue;
    }

    const destination = routeTerminals.find((terminal) => terminal.name !== candidate.name);
    if (destination) {
      return destination.name;
    }
  }
  return undefined;
}

function enrichVoyage(
  db: Database.Database,
  terminals: TerminalReference[],
  organisationId: number,
  position: PositionUpdate
): Pick<VesselPosition, "originName" | "originDepartedAt" | "destinationName" | "eta"> {
  const previous = previousVesselPosition(db, position.mmsi);
  const previousTerminal = previous ? nearestTerminal(terminals, organisationId, previous) : undefined;
  const currentTerminal = nearestTerminal(terminals, organisationId, position);

  if (currentTerminal) {
    return {
      destinationName: position.destinationName ?? previous?.destinationName,
      eta: position.eta ?? previous?.eta,
      originName: currentTerminal.name
    };
  }

  if (previousTerminal) {
    return {
      destinationName: position.destinationName ?? destinationFromOrigin(terminals, previousTerminal, position),
      eta: position.eta ?? previous?.eta,
      originName: previousTerminal.name,
      originDepartedAt: position.receivedAt
    };
  }

  if (previous?.originName && previous.originDepartedAt) {
    return {
      destinationName: position.destinationName ?? previous.destinationName,
      eta: position.eta ?? previous.eta,
      originName: previous.originName,
      originDepartedAt: previous.originDepartedAt
    };
  }

  return {};
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

function connectToAisStream(
  apiKey: string,
  db: Database.Database,
  terminals: TerminalReference[],
  vesselOrganisations: Map<number, OrganisationId>,
  vesselNames: Map<number, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(aisStreamUrl);
    let settled = false;

    const settle = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    socket.addEventListener("open", () => {
      const mmsis = allTrackedMmsis(vesselOrganisations);
      socket.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FiltersShipMMSI: mmsis,
        FilterMessageTypes: [
          "PositionReport",
          "ShipStaticData",
          "StaticDataReport",
          "StandardClassBPositionReport",
          "ExtendedClassBPositionReport"
        ]
      }));
      logger.info({ vesselCount: mmsis.length }, "Subscribed to AISStream vessel updates");
    });

    socket.addEventListener("message", (event) => {
      void (async () => {
        const text = await eventDataText(event.data);
        const message = JSON.parse(text) as AisStreamMessage;
        const shipName = parseShipName(message);
        if (shipName && vesselOrganisations.has(shipName.mmsi)) {
          vesselNames.set(shipName.mmsi, shipName.name);
        }

        const position = parsePositionUpdate(message);
        if (!position) {
          return;
        }

        const vessel = vesselPosition(db, terminals, vesselOrganisations, vesselNames, position);
        if (!vessel) {
          return;
        }

        saveVessel(db, vessel);
        logger.info({ mmsi: vessel.mmsi, vesselName: vessel.name }, "Saved AISStream vessel update");
      })().catch((error: unknown) => {
        logger.warn({ err: error }, "Skipping AISStream message because it could not be processed");
      });
    });

    socket.addEventListener("error", () => {
      socket.close();
      settle(new Error("AISStream websocket error"));
    });

    socket.addEventListener("close", (event) => {
      const reason = event.reason || undefined;
      logger.warn({ code: event.code, reason }, "AISStream websocket closed");
      settle();
    });
  });
}

async function main(): Promise<void> {
  if (!config.aisStreamApiKey) {
    logger.warn("AIS_STREAM_API_KEY is not set; skipping vessel fetch");
    return;
  }

  const db = openDatabase();
  const terminals = loadTerminals(db);
  const vesselNames = loadVesselNames(db);
  const vesselOrganisations = trackedVesselMap();
  let reconnectDelayMs = 5_000;

  try {
    while (true) {
      try {
        await connectToAisStream(config.aisStreamApiKey, db, terminals, vesselOrganisations, vesselNames);
        reconnectDelayMs = 5_000;
      } catch (error) {
        logger.warn({ err: error }, "AISStream vessel fetcher disconnected with an error");
      }

      await delay(reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, 60_000);
    }
  } finally {
    db.close();
  }
}

await main();
