import "dotenv/config";
import type Database from "better-sqlite3";
import * as cycleTLS from "cycletls";
import type { CycleTLSClient } from "cycletls";
import { setTimeout as delay } from "node:timers/promises";
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

type MarineTrafficVessel = {
  SHIP_ID?: unknown;
  MMSI?: unknown;
  SHIPNAME?: unknown;
  LAT?: unknown;
  LON?: unknown;
  SPEED?: unknown;
  COURSE?: unknown;
  TIMESTAMP?: unknown;
};

type MarineTrafficVoyage = {
  reportedDestination?: unknown;
  eta?: unknown;
  etaCalc?: unknown;
};

type VesselFetchResult = {
  position: PositionUpdate;
  name?: string;
} | "blocked" | null;

type MarineTrafficHeaders = Record<string, string>;
type MarineTrafficResponse = Awaited<ReturnType<CycleTLSClient["get"]>>;
type MarineTrafficResponseHeaders = MarineTrafficResponse["headers"];
type MarineTrafficClient = CycleTLSClient;
type MarineTrafficRequestOptions = Parameters<CycleTLSClient["get"]>[1];

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

const initCycleTLS = cycleTLS.default as unknown as () => Promise<CycleTLSClient>;
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

function unixTimestampToSql(value: unknown): string | undefined {
  const seconds = parseInteger(value);
  if (seconds === undefined) {
    return undefined;
  }

  return sqlTimestamp(new Date(seconds * 1000));
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

function cleanVesselText(value: string): string | undefined {
  const cleaned = value.replace(/@/g, " ").trim().replace(/\s+/g, " ");
  return cleaned === "" ? undefined : cleaned;
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

function marineTrafficHeaders(): MarineTrafficHeaders {
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.5",
    "X-NewRelic-ID": "undefined",
    "Vessel-Image": "0054729193319b27a6d45397a3b5a4d83e17",
    "X-Requested-With": "XMLHttpRequest",
    "Alt-Used": "www.marinetraffic.com",
    Connection: "keep-alive",
    Referer: "https://www.marinetraffic.com/en/ais/home/centerx:-5.5/centery:56.4/zoom:8",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin"
  };
}

function marineTrafficRequestOptions(headers: MarineTrafficHeaders): MarineTrafficRequestOptions {
  return {
    body: "",
    headers,
    timeout: 20,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15"
  };
}

function responseHeader(headers: MarineTrafficResponseHeaders, name: string): string | null {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) {
      continue;
    }

    if (Array.isArray(value)) {
      return value.length > 0 ? String(value[0]) : null;
    }
    return value === undefined ? null : String(value);
  }
  return null;
}

function isCloudflareChallenge(status: number, contentType: string | null, body: string): boolean {
  return status === 403 && contentType?.includes("text/html") === true && body.includes("Attention Required! | Cloudflare");
}

function marineTrafficPosition(value: MarineTrafficVessel): { position: PositionUpdate; name?: string; shipId?: number } | null {
  const mmsi = parseInteger(value.MMSI);
  const latitude = parseNumber(value.LAT);
  const longitude = parseNumber(value.LON);
  const timestamp = parseText(value.TIMESTAMP);
  if (mmsi === undefined || latitude === undefined || longitude === undefined || timestamp === undefined) {
    return null;
  }

  const name = parseText(value.SHIPNAME);
  return {
    position: {
      mmsi,
      latitude,
      longitude,
      speed: parseNumber(value.SPEED),
      course: parseNumber(value.COURSE),
      receivedAt: timestamp
    },
    name: name ? capitaliseWords(name) : undefined,
    shipId: parseInteger(value.SHIP_ID)
  };
}

async function fetchMarineTrafficVessel(
  client: MarineTrafficClient,
  headers: MarineTrafficHeaders,
  mmsi: Mmsi
): Promise<VesselFetchResult> {
  try {
    const response = await client.get(
      `https://www.marinetraffic.com/map/getvesseljson/mmsi:${mmsi}`,
      marineTrafficRequestOptions(headers)
    );
    const body = await response.text();

    if (response.status < 200 || response.status >= 300) {
      if (isCloudflareChallenge(response.status, responseHeader(response.headers, "Content-Type"), body)) {
        logger.error({ mmsi }, "MarineTraffic blocked vessel fetching with a Cloudflare challenge");
        return "blocked";
      }
      logger.warn({ mmsi, statusCode: response.status, responseBody: body.slice(0, 500) }, "Skipping vessel because MarineTraffic returned an error");
      return null;
    }

    const parsed = marineTrafficPosition(JSON.parse(body) as MarineTrafficVessel);
    if (!parsed) {
      logger.warn({ mmsi }, "Skipping vessel because MarineTraffic response could not be parsed");
      return null;
    }

    const voyage = await fetchMarineTrafficVoyageData(client, headers, parsed.shipId);
    return {
      position: {
        ...parsed.position,
        ...voyage
      },
      name: parsed.name
    };
  } catch (error) {
    logger.warn({ err: error, mmsi }, "Skipping vessel because MarineTraffic fetch failed");
    return null;
  }
}

async function fetchMarineTrafficVoyageData(
  client: MarineTrafficClient,
  headers: MarineTrafficHeaders,
  shipId: number | undefined
): Promise<Pick<PositionUpdate, "destinationName" | "eta">> {
  if (shipId === undefined) {
    return {};
  }

  try {
    const response = await client.get(
      `https://www.marinetraffic.com/en/vessels/${shipId}/voyage`,
      marineTrafficRequestOptions(headers)
    );
    const body = await response.text();
    if (response.status < 200 || response.status >= 300) {
      logger.warn({ shipId, statusCode: response.status }, "Skipping voyage enrichment because MarineTraffic returned an error");
      return {};
    }

    const voyage = JSON.parse(body) as MarineTrafficVoyage;
    const rawDestination = parseText(voyage.reportedDestination);
    return {
      destinationName: rawDestination ? cleanVesselText(rawDestination) : undefined,
      eta: unixTimestampToSql(voyage.eta ?? voyage.etaCalc)
    };
  } catch (error) {
    logger.warn({ err: error, shipId }, "Skipping voyage enrichment because MarineTraffic fetch failed");
    return {};
  }
}

async function fetchVesselsFromMarineTraffic(
  client: MarineTrafficClient,
  db: Database.Database,
  terminals: TerminalReference[],
  vesselOrganisations: Map<number, OrganisationId>,
  vesselNames: Map<number, string>
): Promise<boolean> {
  const headers = marineTrafficHeaders();
  for (const { organisationId, mmsis } of trackedVessels) {
    for (const mmsi of mmsis) {
      const result = await fetchMarineTrafficVessel(client, headers, mmsi);
      if (result === "blocked") {
        return false;
      }

      if (result) {
        if (result.name) {
          vesselNames.set(result.position.mmsi, result.name);
        }

        const vessel = vesselPosition(db, terminals, vesselOrganisations, vesselNames, result.position);
        if (vessel) {
          saveVessel(db, vessel);
          logger.info({ mmsi: vessel.mmsi, vesselName: vessel.name, organisationId }, "Saved MarineTraffic vessel update");
        }
      }

      await delay(4_000);
    }
  }
  return true;
}

async function main(): Promise<void> {
  const client = await initCycleTLS();
  let db: Database.Database | undefined;

  try {
    db = openDatabase();
    const terminals = loadTerminals(db);
    const vesselNames = loadVesselNames(db);
    const vesselOrganisations = trackedVesselMap();
    const completed = await fetchVesselsFromMarineTraffic(client, db, terminals, vesselOrganisations, vesselNames);
    if (!completed) {
      process.exitCode = 1;
    }
  } finally {
    await client.exit();
    db?.close();
  }
}

await main();
