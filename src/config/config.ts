import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const envSchema = Type.Object({
  NODE_ENV: Type.Optional(Type.Union([Type.Literal("development"), Type.Literal("test"), Type.Literal("production")])),
  HOST: Type.Optional(Type.String({ minLength: 1 })),
  PORT: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
  DATABASE_PATH: Type.Optional(Type.String({ minLength: 1 })),
  APNS_TEAM_ID: Type.Optional(Type.String()),
  APNS_KEY_ID: Type.Optional(Type.String()),
  APNS_BUNDLE_ID: Type.Optional(Type.String()),
  APNS_PRIVATE_KEY_PATH: Type.Optional(Type.String()),
  APNS_PRODUCTION: Type.Optional(Type.Boolean()),
  FCM_PROJECT_ID: Type.Optional(Type.String()),
  GOOGLE_APPLICATION_CREDENTIALS: Type.Optional(Type.String())
});

type Env = Static<typeof envSchema>;

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  return ["1", "true", "yes"].includes(value.toLowerCase());
}

const env = Value.Parse(envSchema, {
  NODE_ENV: process.env.NODE_ENV,
  HOST: process.env.HOST,
  PORT: parseOptionalInteger(process.env.PORT),
  DATABASE_PATH: process.env.DATABASE_PATH,
  APNS_TEAM_ID: process.env.APNS_TEAM_ID,
  APNS_KEY_ID: process.env.APNS_KEY_ID,
  APNS_BUNDLE_ID: process.env.APNS_BUNDLE_ID,
  APNS_PRIVATE_KEY_PATH: process.env.APNS_PRIVATE_KEY_PATH,
  APNS_PRODUCTION: parseOptionalBoolean(process.env.APNS_PRODUCTION),
  FCM_PROJECT_ID: process.env.FCM_PROJECT_ID,
  GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS
}) satisfies Env;

export const config = {
  nodeEnv: env.NODE_ENV ?? "development",
  host: env.HOST ?? "127.0.0.1",
  port: env.PORT ?? 4321,
  databasePath: env.DATABASE_PATH ?? "./data/ferry-services.sqlite3",
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
