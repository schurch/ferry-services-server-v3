import * as cycleTLS from "cycletls";
import type { CycleTLSClient } from "cycletls";
import { setTimeout as delay } from "node:timers/promises";
import { logger } from "../../logger.js";
import { capitaliseWords, cleanVesselText, parseInteger, parseNumber, parseText } from "./source-utils.js";
import type { Mmsi, OrganisationVessels, PositionUpdate, SourceVesselUpdate, SourceVesselUpdateHandler } from "./types.js";

export type MarineTrafficClient = CycleTLSClient;

export async function createMarineTrafficClient(): Promise<MarineTrafficClient> {
  return initCycleTLS();
}

export async function runMarineTrafficPollLoop(
  client: MarineTrafficClient,
  trackedVessels: OrganisationVessels[],
  onUpdate: SourceVesselUpdateHandler
): Promise<void> {
  while (true) {
    const completed = await fetchVesselsFromMarineTraffic(client, trackedVessels, onUpdate);
    if (!completed) {
      process.exitCode = 1;
    }
    await delay(marineTrafficPollIntervalMs);
  }
}

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
};

type VesselFetchResult = SourceVesselUpdate | "blocked" | null;

type MarineTrafficHeaders = Record<string, string>;

type MarineTrafficResponse = Awaited<ReturnType<CycleTLSClient["get"]>>;

type MarineTrafficResponseHeaders = MarineTrafficResponse["headers"];

type MarineTrafficRequestOptions = Parameters<CycleTLSClient["get"]>[1];

const initCycleTLS = cycleTLS.default as unknown as () => Promise<CycleTLSClient>;

const marineTrafficPollIntervalMs = 5 * 60 * 1000;

async function fetchVesselsFromMarineTraffic(
  client: MarineTrafficClient,
  trackedVessels: OrganisationVessels[],
  onUpdate: SourceVesselUpdateHandler
): Promise<boolean> {
  const headers = marineTrafficHeaders();
  for (const { organisationId, mmsis } of trackedVessels) {
    for (const mmsi of mmsis) {
      const result = await fetchMarineTrafficVessel(client, headers, mmsi);
      if (result === "blocked") {
        return false;
      }

      if (result) {
        await onUpdate(result);
        logger.info({ mmsi: result.position.mmsi, organisationId }, "Received MarineTraffic vessel update");
      }

      await delay(4_000);
    }
  }
  return true;
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
): Promise<Pick<PositionUpdate, "destinationName">> {
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
      destinationName: rawDestination ? cleanVesselText(rawDestination) : undefined
    };
  } catch (error) {
    logger.warn({ err: error, shipId }, "Skipping voyage enrichment because MarineTraffic fetch failed");
    return {};
  }
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

function marineTrafficPosition(value: MarineTrafficVessel): { position: PositionUpdate; name?: string | undefined; shipId?: number | undefined } | null {
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
