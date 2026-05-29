import fastifyStatic from "@fastify/static";
import * as Sentry from "@sentry/node";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import path from "node:path";
import {
  AddServiceRequestSchema,
  CreateInstallationRequestSchema,
  DepartureDestinationSchema,
  DepartureResponseSchema,
  DeviceTypeSchema,
  ErrorResponseSchema,
  LocationResponseSchema,
  LocationSummaryResponseSchema,
  LocationWeatherResponseSchema,
  OrganisationResponseSchema,
  PushStatusSchema,
  RailDepartureResponseSchema,
  ReliabilityPeriodResponseSchema,
  ReliabilityResponseSchema,
  ReliabilityStatusBreakdownEntrySchema,
  ServiceListResponseSchema,
  ServiceResponseSchema,
  ServiceStatusSchema,
  SnapshotBodySchema,
  TimetableDocumentResponseSchema,
  UTCTimeSchema,
  VesselResponseSchema,
  VesselVoyageResponseSchema
} from "../api/schema.js";
import { registerInstallationApiRoutes } from "../features/installations/routes.js";
import { registerOfflineSnapshotApiRoutes } from "../features/offline-snapshot/routes.js";
import { registerServiceApiRoutes } from "../features/services/routes.js";
import { registerTimetableDocumentApiRoutes } from "../features/timetable-documents/routes.js";
import { registerWebRoutes } from "../web/routes.js";
import { deleteStaleInstallations } from "../features/installations/repository.js";
import { config } from "../shared/config.js";
import { openDatabase } from "../shared/database.js";
import { loggerOptions } from "../shared/logger.js";
import { sentryEnabled } from "../shared/sentry.js";
import { MemoryRateLimiter } from "./rate-limit.js";

export type BuildAppOptions = {
  db?: ReturnType<typeof openDatabase>;
  now?: () => Date;
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.nodeEnv === "test" ? false : loggerOptions(),
    routerOptions: {
      ignoreTrailingSlash: true
    },
    trustProxy: config.trustProxy
  });
  const db = options.db ?? openDatabase();
  const ownsDatabase = !options.db;
  const now = options.now ?? (() => new Date());
  const rateLimiter = new MemoryRateLimiter();
  let lastInstallationCleanupAt = 0;

  function runInstallationMaintenance(): void {
    const currentTime = now().getTime();
    if (currentTime - lastInstallationCleanupAt < INSTALLATION_CLEANUP_INTERVAL_MS) {
      return;
    }

    lastInstallationCleanupAt = currentTime;
    const deleted = deleteStaleInstallations(db, now());
    if (deleted.deletedInstallations > 0 || deleted.deletedAttempts > 0) {
      app.log.info(deleted, "Cleaned stale installation state");
    }
  }

  addSchemas(app);
  runInstallationMaintenance();
  await registerPlugins(app);

  app.get("/openapi.json", {
    schema: {
      hide: true
    }
  }, async () => app.swagger());

  registerWebRoutes(app, { db, now });
  registerServiceApiRoutes(app, { db, now, rateLimiter });
  registerInstallationApiRoutes(app, { db, now, rateLimiter, runInstallationMaintenance });
  registerTimetableDocumentApiRoutes(app, { db });
  registerOfflineSnapshotApiRoutes(app, { now, rateLimiter });

  if (sentryEnabled) {
    Sentry.setupFastifyErrorHandler(app, {
      shouldHandleError: (_error, _request, reply) => reply.statusCode >= 500
    });
  }

  app.addHook("onClose", async () => {
    if (ownsDatabase) {
      db.close();
    }
  });

  return app;
}

export async function startServer(): Promise<void> {
  const app = await buildApp();
  await app.listen({ host: config.host, port: config.port });
}

const publicDir = path.resolve("public");
const INSTALLATION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

async function registerPlugins(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Scottish Ferry Services API",
        description: "Live ferry service data, mobile installation state, vessel positions and offline timetable downloads.",
        version: "3.0.0"
      },
      tags: [{ name: "Ferry Services API" }]
    },
    refResolver: {
      buildLocalReference(json, _baseUri, _fragment, index) {
        return typeof json.$id === "string" ? json.$id : typeof json.title === "string" ? json.title : `def-${index}`;
      }
    }
  });

  await app.register(swaggerUi, {
    routePrefix: "/swagger",
    theme: {
      title: "Scottish Ferry Services API",
      css: [
        {
          filename: "theme.css",
          content: ".swagger-ui .topbar { display: none; }"
        }
      ]
    },
    uiConfig: {
      docExpansion: "list",
      deepLinking: false
    }
  });

  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
    index: false,
    wildcard: true
  });
}

function addSchemas(app: FastifyInstance): void {
  for (const schema of [
    ErrorResponseSchema,
    PushStatusSchema,
    DeviceTypeSchema,
    ServiceStatusSchema,
    UTCTimeSchema,
    CreateInstallationRequestSchema,
    AddServiceRequestSchema,
    OrganisationResponseSchema,
    LocationWeatherResponseSchema,
    LocationSummaryResponseSchema,
    RailDepartureResponseSchema,
    ReliabilityStatusBreakdownEntrySchema,
    ReliabilityPeriodResponseSchema,
    ReliabilityResponseSchema,
    DepartureDestinationSchema,
    DepartureResponseSchema,
    LocationResponseSchema,
    VesselVoyageResponseSchema,
    VesselResponseSchema,
    TimetableDocumentResponseSchema,
    ServiceListResponseSchema,
    ServiceResponseSchema,
    SnapshotBodySchema
  ]) {
    app.addSchema(schema);
  }
}
