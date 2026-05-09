import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(4321),
  DATABASE_PATH: z.string().default("./data/ferry-services.sqlite3"),
  APNS_TEAM_ID: z.string().optional(),
  APNS_KEY_ID: z.string().optional(),
  APNS_BUNDLE_ID: z.string().optional(),
  APNS_PRIVATE_KEY_PATH: z.string().optional(),
  APNS_PRODUCTION: z.coerce.boolean().default(false),
  FCM_PROJECT_ID: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional()
});

const env = envSchema.parse(process.env);

export const config = {
  nodeEnv: env.NODE_ENV,
  host: env.HOST,
  port: env.PORT,
  databasePath: env.DATABASE_PATH,
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

