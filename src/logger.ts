import pino from "pino";
import type { LoggerOptions } from "pino";
import { config } from "./config.js";
export type ServiceName =
  | "server"
  | "migrate"
  | "scraper"
  | "weather-fetcher"
  | "vessel-fetcher"
  | "rail-departure-fetcher"
  | "timetable-document-fetcher"
  | "transxchange-ingester"
  | "offline-snapshot-generator";
export function serviceFromEntrypoint(entrypoint: string | undefined): ServiceName {
  if (!entrypoint) return "server";

  if (entrypoint.endsWith("/migrate.js")) return "migrate";
  if (entrypoint.endsWith("/service-status/fetcher.js")) return "scraper";
  if (entrypoint.endsWith("/weather/fetcher.js")) return "weather-fetcher";
  if (entrypoint.endsWith("/vessels/fetcher.js")) return "vessel-fetcher";
  if (entrypoint.endsWith("/rail/fetcher.js")) return "rail-departure-fetcher";
  if (entrypoint.endsWith("/timetable-documents/fetcher.js")) return "timetable-document-fetcher";
  if (entrypoint.endsWith("/transxchange/ingester.js")) return "transxchange-ingester";
  if (entrypoint.endsWith("/offline-snapshot/generator.js")) return "offline-snapshot-generator";
  return "server";
}

export const serviceName = serviceFromEntrypoint(process.argv[1]);

export function loggerOptions(): LoggerOptions {
  return {
    level: config.nodeEnv === "test" ? "silent" : (process.env.LOG_LEVEL ?? "info"),
    base: {
      service: serviceName
    },
    ...(config.nodeEnv === "development"
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              translateTime: "HH:MM:ss Z",
              ignore: "pid,hostname"
            }
          }
        }
      : {})
  };
}

export const logger = pino(loggerOptions());
