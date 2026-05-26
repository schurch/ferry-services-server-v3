import * as Sentry from "@sentry/node";
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { config } from "./config.js";
import { serviceName } from "./logger.js";

// #region Environment loading

loadDotenv({
  path: path.resolve(process.cwd(), "../../.env"),
  quiet: true
});

// #endregion

// #region Helpers

function serviceDsn(service: typeof serviceName): string | null {
  switch (service) {
    case "server":
      return config.sentry.serverDsn;
    case "migrate":
      return null;
    case "scraper":
      return config.sentry.scraperDsn;
    case "weather-fetcher":
      return config.sentry.weatherFetcherDsn;
    case "vessel-fetcher":
      return config.sentry.vesselFetcherDsn;
    case "rail-departure-fetcher":
      return config.sentry.railDepartureFetcherDsn;
    case "timetable-document-fetcher":
      return config.sentry.timetableDocumentScraperDsn;
    case "transxchange-ingester":
      return config.sentry.transxchangeIngesterDsn;
    case "offline-snapshot-generator":
      return config.sentry.offlineSnapshotGeneratorDsn;
  }
}

// #endregion

// #region Sentry setup

const dsn = serviceDsn(serviceName);

export const sentryEnabled = dsn !== null;

if (dsn) {
  Sentry.init({
    dsn,
    environment: config.sentry.environment,
    tracesSampleRate: config.sentry.tracesSampleRate ?? 0.1,
    initialScope: {
      tags: {
        service: serviceName
      }
    },
    integrations: [Sentry.fastifyIntegration()]
  });
}

// #endregion
