import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const config = loadConfig();

function loadConfig() {
  loadDotenv({
    path: path.resolve(process.cwd(), ".env"),
    quiet: true
  });

  const envSchema = Type.Object({
    NODE_ENV: Type.Optional(Type.Union([Type.Literal("development"), Type.Literal("test"), Type.Literal("production")])),
    HOST: Type.Optional(Type.String({ minLength: 1 })),
    PORT: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
    TRUST_PROXY: Type.Optional(Type.Boolean()),
    DATABASE_PATH: Type.Optional(Type.String({ minLength: 1 })),
    OPENWEATHERMAP_APPID: Type.Optional(Type.String()),
    GOOGLE_MAPS_API_KEY: Type.Optional(Type.String()),
    AIS_STREAM_API_KEY: Type.Optional(Type.String()),
    RAIL_DATA_API_KEY: Type.Optional(Type.String()),
    TRAVELLINE_FTP_ADDRESS: Type.Optional(Type.String()),
    TRAVELLINE_FTP_USERNAME: Type.Optional(Type.String()),
    TRAVELLINE_FTP_PASSWORD: Type.Optional(Type.String()),
    OPENAI_API_KEY: Type.Optional(Type.String()),
    OPENAI_MODEL: Type.Optional(Type.String({ minLength: 1 })),
    OPENAI_TIMEOUT_MS: Type.Optional(Type.Integer({ minimum: 1 })),
    SERVER_SENTRY_DSN: Type.Optional(Type.String()),
    SCRAPER_SENTRY_DSN: Type.Optional(Type.String()),
    WEATHER_FETCHER_SENTRY_DSN: Type.Optional(Type.String()),
    VESSEL_FETCHER_SENTRY_DSN: Type.Optional(Type.String()),
    RAIL_DEPARTURE_FETCHER_SENTRY_DSN: Type.Optional(Type.String()),
    TIMETABLE_DOCUMENT_SCRAPER_SENTRY_DSN: Type.Optional(Type.String()),
    TRANSXCHANGE_INGESTER_SENTRY_DSN: Type.Optional(Type.String()),
    OFFLINE_SNAPSHOT_GENERATOR_SENTRY_DSN: Type.Optional(Type.String()),
    SENTRY_TRACES_SAMPLE_RATE: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    APNS_TEAM_ID: Type.Optional(Type.String()),
    APNS_KEY_ID: Type.Optional(Type.String()),
    APNS_BUNDLE_ID: Type.Optional(Type.String()),
    APNS_PRIVATE_KEY_PATH: Type.Optional(Type.String()),
    APNS_PRODUCTION: Type.Optional(Type.Boolean()),
    FCM_PROJECT_ID: Type.Optional(Type.String()),
    GOOGLE_APPLICATION_CREDENTIALS: Type.Optional(Type.String())
  });

  type Env = Static<typeof envSchema>;
  const env = Value.Parse(envSchema, {
    NODE_ENV: process.env.NODE_ENV,
    HOST: process.env.HOST,
    PORT: parseOptionalInteger(process.env.PORT),
    TRUST_PROXY: parseOptionalBoolean(process.env.TRUST_PROXY),
    DATABASE_PATH: process.env.DATABASE_PATH,
    OPENWEATHERMAP_APPID: process.env.OPENWEATHERMAP_APPID,
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? process.env.VITE_GOOGLE_MAPS_API_KEY,
    AIS_STREAM_API_KEY: process.env.AIS_STREAM_API_KEY,
    RAIL_DATA_API_KEY: process.env.RAIL_DATA_API_KEY,
    TRAVELLINE_FTP_ADDRESS: process.env.TRAVELLINE_FTP_ADDRESS,
    TRAVELLINE_FTP_USERNAME: process.env.TRAVELLINE_FTP_USERNAME,
    TRAVELLINE_FTP_PASSWORD: process.env.TRAVELLINE_FTP_PASSWORD,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    OPENAI_TIMEOUT_MS: parseOptionalInteger(process.env.OPENAI_TIMEOUT_MS),
    SERVER_SENTRY_DSN: process.env.SERVER_SENTRY_DSN,
    SCRAPER_SENTRY_DSN: process.env.SCRAPER_SENTRY_DSN,
    WEATHER_FETCHER_SENTRY_DSN: process.env.WEATHER_FETCHER_SENTRY_DSN,
    VESSEL_FETCHER_SENTRY_DSN: process.env.VESSEL_FETCHER_SENTRY_DSN,
    RAIL_DEPARTURE_FETCHER_SENTRY_DSN: process.env.RAIL_DEPARTURE_FETCHER_SENTRY_DSN,
    TIMETABLE_DOCUMENT_SCRAPER_SENTRY_DSN: process.env.TIMETABLE_DOCUMENT_SCRAPER_SENTRY_DSN,
    TRANSXCHANGE_INGESTER_SENTRY_DSN: process.env.TRANSXCHANGE_INGESTER_SENTRY_DSN,
    OFFLINE_SNAPSHOT_GENERATOR_SENTRY_DSN: process.env.OFFLINE_SNAPSHOT_GENERATOR_SENTRY_DSN,
    SENTRY_TRACES_SAMPLE_RATE: parseOptionalNumber(process.env.SENTRY_TRACES_SAMPLE_RATE),
    APNS_TEAM_ID: process.env.APNS_TEAM_ID,
    APNS_KEY_ID: process.env.APNS_KEY_ID,
    APNS_BUNDLE_ID: process.env.APNS_BUNDLE_ID,
    APNS_PRIVATE_KEY_PATH: process.env.APNS_PRIVATE_KEY_PATH,
    APNS_PRODUCTION: parseOptionalBoolean(process.env.APNS_PRODUCTION),
    FCM_PROJECT_ID: process.env.FCM_PROJECT_ID,
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS
  }) satisfies Env;

  return {
    nodeEnv: env.NODE_ENV ?? "development",
    host: env.HOST ?? "127.0.0.1",
    port: env.PORT ?? 4321,
    trustProxy: env.TRUST_PROXY ?? ((env.NODE_ENV ?? "development") === "production"),
    databasePath: env.DATABASE_PATH ?? "./data/ferry-services.sqlite3",
    openWeatherMapAppId: env.OPENWEATHERMAP_APPID ?? null,
    googleMapsApiKey: env.GOOGLE_MAPS_API_KEY ?? null,
    aisStreamApiKey: env.AIS_STREAM_API_KEY ?? null,
    railDataApiKey: env.RAIL_DATA_API_KEY ?? null,
    travelineFtp: {
      address: env.TRAVELLINE_FTP_ADDRESS ?? null,
      username: env.TRAVELLINE_FTP_USERNAME ?? null,
      password: env.TRAVELLINE_FTP_PASSWORD ?? null
    },
    openAi: {
      apiKey: env.OPENAI_API_KEY ?? null,
      model: env.OPENAI_MODEL ?? "gpt-5.4-nano-2026-03-17",
      timeoutMs: env.OPENAI_TIMEOUT_MS ?? 10000
    },
    sentry: {
      serverDsn: env.SERVER_SENTRY_DSN ?? null,
      scraperDsn: env.SCRAPER_SENTRY_DSN ?? null,
      weatherFetcherDsn: env.WEATHER_FETCHER_SENTRY_DSN ?? null,
      vesselFetcherDsn: env.VESSEL_FETCHER_SENTRY_DSN ?? null,
      railDepartureFetcherDsn: env.RAIL_DEPARTURE_FETCHER_SENTRY_DSN ?? null,
      timetableDocumentScraperDsn: env.TIMETABLE_DOCUMENT_SCRAPER_SENTRY_DSN ?? null,
      transxchangeIngesterDsn: env.TRANSXCHANGE_INGESTER_SENTRY_DSN ?? null,
      offlineSnapshotGeneratorDsn: env.OFFLINE_SNAPSHOT_GENERATOR_SENTRY_DSN ?? null,
      environment: (env.NODE_ENV ?? "development") === "production" ? "production" : "development",
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE
    },
    apns: {
      teamId: env.APNS_TEAM_ID ?? null,
      keyId: env.APNS_KEY_ID ?? null,
      bundleId: env.APNS_BUNDLE_ID ?? null,
      privateKeyPath: env.APNS_PRIVATE_KEY_PATH ?? null,
      production: env.APNS_PRODUCTION
    },
    fcm: {
      projectId: env.FCM_PROJECT_ID ?? null,
      googleApplicationCredentials: env.GOOGLE_APPLICATION_CREDENTIALS ?? null
    }
  } as const;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return Number.NaN;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!/^(?:\d+|\d*\.\d+)$/.test(trimmed)) {
    return Number.NaN;
  }

  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}
