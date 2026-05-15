import * as Sentry from "@sentry/node";
import { config as loadDotenv } from "dotenv";
import path from "node:path";

loadDotenv({
  path: path.resolve(process.cwd(), "../../.env")
});
import { config } from "./config.js";

type SentryService =
  | "server"
  | "scraper"
  | "weather-fetcher"
  | "vessel-fetcher"
  | "rail-departure-fetcher"
  | "timetable-document-scraper"
  | "transxchange-ingester"
  | "offline-snapshot-generator";

function serviceFromEntrypoint(entrypoint: string | undefined): SentryService {
  if (!entrypoint) return "server";

  if (entrypoint.endsWith("/scraper.js")) return "scraper";
  if (entrypoint.endsWith("/weather-fetcher.js")) return "weather-fetcher";
  if (entrypoint.endsWith("/vessel-fetcher.js")) return "vessel-fetcher";
  if (entrypoint.endsWith("/rail-departure-fetcher.js")) return "rail-departure-fetcher";
  if (entrypoint.endsWith("/timetable-document-fetcher.js")) return "timetable-document-scraper";
  if (entrypoint.endsWith("/transxchange-ingester.js")) return "transxchange-ingester";
  if (entrypoint.endsWith("/offline-snapshot-generator.js")) return "offline-snapshot-generator";
  return "server";
}

const sentryService = serviceFromEntrypoint(process.argv[1]);

function serviceDsn(service: SentryService): string | null {
  switch (service) {
    case "server":
      return config.sentry.serverDsn;
    case "scraper":
      return config.sentry.scraperDsn;
    case "weather-fetcher":
      return config.sentry.weatherFetcherDsn;
    case "vessel-fetcher":
      return config.sentry.vesselFetcherDsn;
    case "rail-departure-fetcher":
      return config.sentry.railDepartureFetcherDsn;
    case "timetable-document-scraper":
      return config.sentry.timetableDocumentScraperDsn;
    case "transxchange-ingester":
      return config.sentry.transxchangeIngesterDsn;
    case "offline-snapshot-generator":
      return config.sentry.offlineSnapshotGeneratorDsn;
  }
}

const dsn = serviceDsn(sentryService);

export const sentryEnabled = dsn !== null;

if (dsn) {
  Sentry.init({
    dsn,
    environment: config.sentry.environment,
    tracesSampleRate: config.sentry.tracesSampleRate ?? 0.1,
    initialScope: {
      tags: {
        service: sentryService
      }
    },
    integrations: [Sentry.fastifyIntegration()]
  });
}
