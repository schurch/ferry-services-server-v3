import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import * as cycleTLS from "cycletls";
import type { CycleTLSClient } from "cycletls";
import { openDatabase } from "../db/database.js";
import { saveVessel } from "../db/fetchers.js";
import type { VesselPosition } from "../types/fetchers.js";

type OrganisationId = number;
type Mmsi = number;

type MarineTrafficVessel = {
  MMSI?: unknown;
  SHIPNAME?: unknown;
  LAT?: unknown;
  LON?: unknown;
  SPEED?: unknown;
  COURSE?: unknown;
  TIMESTAMP?: unknown;
};

type VesselFetchResult = VesselPosition | "blocked" | null;

type OrganisationVessels = {
  organisationId: OrganisationId;
  organisationName: string;
  mmsis: Mmsi[];
};

const initCycleTLS = cycleTLS.default as unknown as () => Promise<CycleTLSClient>;

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
      232029607,
      235021681
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

function capitaliseWords(value: string): string {
  return value.split(/\s+/).filter(Boolean).map((word) => {
    const upper = word.toUpperCase();
    if (upper === "OF" || upper === "THE") {
      return upper.toLowerCase();
    }
    return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
  }).join(" ");
}

function vesselPosition(organisationId: number, value: MarineTrafficVessel): VesselPosition | null {
  if (
    typeof value.MMSI !== "string" ||
    typeof value.SHIPNAME !== "string" ||
    typeof value.LAT !== "string" ||
    typeof value.LON !== "string" ||
    typeof value.TIMESTAMP !== "string"
  ) {
    return null;
  }

  const mmsi = Number.parseInt(value.MMSI, 10);
  const latitude = Number.parseFloat(value.LAT);
  const longitude = Number.parseFloat(value.LON);
  if (!Number.isFinite(mmsi) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    mmsi,
    name: capitaliseWords(value.SHIPNAME),
    speed: parseNumber(value.SPEED),
    course: parseNumber(value.COURSE),
    latitude,
    longitude,
    lastReceived: value.TIMESTAMP,
    organisationId
  };
}

function isCloudflareChallenge(status: number, contentType: string | null, body: string): boolean {
  return status === 403 && contentType?.includes("text/html") === true && body.includes("Attention Required! | Cloudflare");
}

async function fetchVessel(client: CycleTLSClient, organisationId: OrganisationId, mmsi: Mmsi): Promise<VesselFetchResult> {
  const headers = {
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

  try {
    const response = await client.get(`https://www.marinetraffic.com/map/getvesseljson/mmsi:${mmsi}`, {
      body: "",
      headers,
      timeout: 20,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15"
    });
    const body = await response.text();

    if (response.status < 200 || response.status >= 300) {
      const contentType = Array.isArray(response.headers["Content-Type"])
        ? String(response.headers["Content-Type"][0])
        : null;
      if (isCloudflareChallenge(response.status, contentType, body)) {
        console.error(`MarineTraffic blocked vessel fetching with a Cloudflare challenge at vessel ${mmsi}`);
        return "blocked";
      }
      console.error(`Skipping vessel ${mmsi}: MarineTraffic returned HTTP ${response.status} - ${body.slice(0, 500)}`);
      return null;
    }

    const value = JSON.parse(body) as MarineTrafficVessel;
    const vessel = vesselPosition(organisationId, value);
    if (!vessel) {
      console.error(`Skipping vessel ${mmsi}: could not parse MarineTraffic response`);
      return null;
    }

    console.log(`Fetched ${vessel.name} ${vessel.mmsi}`);
    return vessel;
  } catch (error) {
    console.error(`Skipping vessel ${mmsi}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function main(): Promise<void> {
  const db = openDatabase();
  const client = await initCycleTLS();
  try {
    for (const { organisationId, mmsis } of trackedVessels) {
      for (const mmsi of mmsis) {
        const vessel = await fetchVessel(client, organisationId, mmsi);
        if (vessel === "blocked") {
          process.exitCode = 1;
          return;
        }
        if (vessel) {
          saveVessel(db, vessel);
        }
        await delay(4_000);
      }
    }
  } finally {
    await client.exit();
    db.close();
  }
}

await main();
