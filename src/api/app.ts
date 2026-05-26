import fastifyStatic from "@fastify/static";
import * as Sentry from "@sentry/node";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Type, type Static } from "@sinclair/typebox";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { etagForJson, getService, listInstallationServices, listServices, listTimetableDocuments } from "../db/api.js";
import { openDatabase } from "../db/database.js";
import {
  addInstallationService,
  checkAndRecordInstallationRegistrationAttempt,
  deleteInstallationService,
  deleteStaleInstallations,
  getPushStatus,
  updatePushStatus,
  upsertInstallation
} from "../db/installations.js";
import { defaultSnapshotMetadataPath, defaultSnapshotPath, readOfflineSnapshotMetadata } from "../offline/snapshot.js";
import { loggerOptions } from "../logger.js";
import { sentryEnabled } from "../sentry.js";
import {
  AddServiceRequestSchema,
  CreateInstallationRequestSchema,
  DepartureDestinationSchema,
  DepartureResponseSchema,
  DeviceTypeSchema,
  ErrorResponseSchema,
  LocationResponseSchema,
  LocationWeatherResponseSchema,
  LocationSummaryResponseSchema,
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
  VesselVoyageResponseSchema,
  VesselResponseSchema
} from "./schema.js";
import { serviceToApi, timetableDocumentToApi } from "./wire.js";
import { MemoryRateLimiter } from "./rate-limit.js";
import {
  dateInput,
  isDateInput,
  renderAdditionalInfoPage,
  renderNotFoundPage,
  renderPrivacyPolicyPage,
  renderServicePage,
  renderServicesPage
} from "../web/pages.js";

// #region Route schemas and types

const publicDir = path.resolve("public");
const INSTALLATION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

const ServiceIDParams = Type.Object({
  serviceID: Type.Integer()
});

const InstallationIDParams = Type.Object({
  installationID: Type.String()
});

const InstallationServiceParams = Type.Object({
  installationID: Type.String(),
  serviceID: Type.Integer()
});

const ServiceDetailQuery = Type.Object({
  departuresDate: Type.Optional(Type.String({ format: "date" }))
});

const TimetableDocumentsQuery = Type.Object({
  serviceID: Type.Optional(Type.Integer())
});

const IfNoneMatchHeaders = Type.Object({
  "if-none-match": Type.Optional(Type.String())
});

type CreateInstallationRequestBody = Static<typeof CreateInstallationRequestSchema>;

type AddServiceRequestBody = Static<typeof AddServiceRequestSchema>;

type PushStatusBody = Static<typeof PushStatusSchema>;

type BuildAppOptions = {
  db?: ReturnType<typeof openDatabase>;
  now?: () => Date;
};

// #endregion

// #region Route helpers

function describedResponse<T extends Record<string, unknown>>(description: string, schema: T): T & { description: string } {
  return {
    ...schema,
    description
  };
}

function errorResponse(description: string) {
  return describedResponse(description, Type.Ref(ErrorResponseSchema));
}

function parseInstallationId(value: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function installationScopedKey(request: FastifyRequest): string {
  return `${request.ip}:${String((request.params as { installationID?: string }).installationID ?? "")}`;
}

function rateLimited(
  limiter: MemoryRateLimiter,
  options: {
    bucket: string;
    limit: number;
    windowMs: number;
    key: (request: FastifyRequest) => string;
    message: string;
    now: () => Date;
  }
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const result = limiter.consume(
      `${options.bucket}:${options.key(request)}`,
      options.limit,
      options.windowMs,
      options.now().getTime()
    );

    reply.header("RateLimit-Limit", String(result.limit));
    reply.header("RateLimit-Remaining", String(result.remaining));
    reply.header("RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      return reply.code(429).send({ error: "Too Many Requests", message: options.message });
    }
  };
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

// #endregion

// #region App setup

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

  function savedServicesForInstallation(installationId: string): Record<string, unknown>[] {
    return listInstallationServices(db, installationId).map((service) => serviceToApi(service, {
      includeAdditionalInfo: false,
      includeLocationDetails: false,
      includeVessels: false
    }));
  }

  addSchemas(app);
  runInstallationMaintenance();

  // #region Plugins and static assets

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

  // #endregion

  // #region Public web routes

  app.get("/openapi.json", {
    schema: {
      hide: true
    }
  }, async () => app.swagger());

  app.get("/", {
    schema: {
      hide: true,
      response: {
        200: Type.String()
      }
    }
  }, async (_request, reply) => {
    const services = listServices(db).map((service) => serviceToApi(service, {
      includeAdditionalInfo: false,
      includeLocationDetails: false,
      includeVessels: false
    }));
    return reply.type("text/html").send(renderServicesPage(services));
  });

  app.get("/service/:serviceID", {
    schema: {
      hide: true,
      params: ServiceIDParams,
      querystring: ServiceDetailQuery,
      response: {
        200: Type.String(),
        404: Type.String()
      }
    }
  }, async (request, reply) => {
    const { serviceID } = request.params as { serviceID: number };
    const { departuresDate } = request.query as { departuresDate?: string };
    const currentTime = now();
    const queryDate = isDateInput(departuresDate) ? departuresDate : dateInput(currentTime);
    const service = getService(db, serviceID, queryDate, currentTime);
    if (!service) {
      return reply.code(404).type("text/html").send(renderNotFoundPage("Service not found"));
    }

    return reply.type("text/html").send(renderServicePage(serviceToApi(service), queryDate, currentTime));
  });

  app.get("/service/:serviceID/info", {
    schema: {
      hide: true,
      params: ServiceIDParams,
      response: {
        200: Type.String(),
        404: Type.String()
      }
    }
  }, async (request, reply) => {
    const { serviceID } = request.params as { serviceID: number };
    const service = getService(db, serviceID, undefined, now());
    if (!service || !service.additionalInfo?.trim()) {
      return reply.code(404).type("text/html").send(renderNotFoundPage("Service information not found"));
    }

    return reply.type("text/html").send(renderAdditionalInfoPage(serviceToApi(service)));
  });

  app.get("/privacy-policy", {
    schema: {
      hide: true,
      response: {
        200: Type.String()
      }
    }
  }, async (_request, reply) => reply.type("text/html").send(renderPrivacyPolicyPage()));

  app.get("/privacy-policy.html", {
    schema: {
      hide: true,
      response: {
        200: Type.String()
      }
    }
  }, async (_request, reply) => reply.type("text/html").send(renderPrivacyPolicyPage()));

  // #endregion

  // #region Service API routes

  app.get("/api/services", {
    schema: {
      operationId: "listServices",
      summary: "List services",
      description: "Returns all visible ferry services with current live status, operator, route and location metadata. Scheduled departures are not embedded in this list response.",
      tags: ["Ferry Services API"],
      response: {
        200: Type.Array(Type.Ref(ServiceListResponseSchema))
      }
    }
  }, async () => listServices(db).map((service) => serviceToApi(service, {
    includeAdditionalInfo: false,
    includeLocationDetails: false,
    includeVessels: false
  })));

  app.get("/api/services/:serviceID", {
    preHandler: rateLimited(rateLimiter, {
      bucket: "service-detail",
      limit: 120,
      windowMs: 60 * 1000,
      key: (request) => request.ip,
      message: "Too many service detail requests",
      now
    }),
    schema: {
      operationId: "getService",
      summary: "Get service detail",
      description: "Returns one visible service. Pass departuresDate as YYYY-MM-DD to include scheduled ferry departures for that local date.",
      tags: ["Ferry Services API"],
      params: ServiceIDParams,
      querystring: ServiceDetailQuery,
      response: {
        200: Type.Ref(ServiceResponseSchema),
        400: errorResponse("Invalid departuresDate"),
        404: errorResponse("Service not found"),
        429: errorResponse("Too many service detail requests")
      }
    }
  }, async (request, reply) => {
    const { serviceID } = request.params as { serviceID: number };
    const { departuresDate } = request.query as { departuresDate?: string };
    const service = getService(db, serviceID, departuresDate, now());
    return service
      ? serviceToApi(service)
      : reply.code(404).send({ error: "Not Found", message: "Service not found" });
  });

  // #endregion

  // #region Installation API routes

  app.post("/api/installations/:installationID", {
    preHandler: [
      rateLimited(rateLimiter, {
        bucket: "installation-create",
        limit: 20,
        windowMs: 60 * 1000,
        key: (request) => request.ip,
        message: "Too many installation registration requests",
        now
      }),
      async (request, reply) => {
        runInstallationMaintenance();
        const { installationID } = request.params as { installationID: string };
        const installationId = parseInstallationId(installationID);
        if (!installationId) {
          return;
        }

        const body = request.body as CreateInstallationRequestBody;
        const result = checkAndRecordInstallationRegistrationAttempt(db, installationId, request.ip, body.device_token, now());
        if (!result.allowed) {
          const message = result.reason === "duplicate-churn"
            ? "Duplicate installation churn from this client has been temporarily blocked"
            : "Too many installation registration requests from this client";
          return reply.code(429).send({ error: "Too Many Requests", message });
        }
      }
    ],
    schema: {
      operationId: "createInstallation",
      summary: "Create installation",
      description: "Registers a mobile app installation for push notifications and returns that installation's saved services.",
      tags: ["Ferry Services API"],
      params: InstallationIDParams,
      body: Type.Ref(CreateInstallationRequestSchema),
      response: {
        200: Type.Array(Type.Ref(ServiceListResponseSchema)),
        400: errorResponse("Invalid installationID or request body"),
        429: errorResponse("Too many installation registration requests")
      }
    }
  }, async (request, reply) => {
    const { installationID } = request.params as { installationID: string };
    const installationId = parseInstallationId(installationID);
    if (!installationId) {
      return reply.code(400).send({ error: "Bad Request", message: "Invalid installationID" });
    }

    const body = request.body as CreateInstallationRequestBody;
    upsertInstallation(db, installationId, {
      deviceToken: body.device_token,
      deviceType: body.device_type
    });
    return savedServicesForInstallation(installationId);
  });

  app.get("/api/installations/:installationID/push-status", {
    preHandler: rateLimited(rateLimiter, {
      bucket: "installation-push-status-read",
      limit: 60,
      windowMs: 60 * 1000,
      key: installationScopedKey,
      message: "Too many installation push status requests",
      now
    }),
    schema: {
      operationId: "getPushStatus",
      summary: "Get push status",
      description: "Returns whether push notifications are enabled for the mobile app installation.",
      tags: ["Ferry Services API"],
      params: InstallationIDParams,
      response: {
        200: Type.Ref(PushStatusSchema),
        400: errorResponse("Invalid installationID"),
        404: errorResponse("Installation not found"),
        429: errorResponse("Too many installation push status requests")
      }
    }
  }, async (request, reply) => {
    const { installationID } = request.params as { installationID: string };
    const installationId = parseInstallationId(installationID);
    if (!installationId) {
      return reply.code(400).send({ error: "Bad Request", message: "Invalid installationID" });
    }

    const status = getPushStatus(db, installationId);
    return status ?? reply.code(404).send({ error: "Not Found", message: "Installation not found" });
  });

  app.post("/api/installations/:installationID/push-status", {
    preHandler: rateLimited(rateLimiter, {
      bucket: "installation-push-status-write",
      limit: 20,
      windowMs: 60 * 1000,
      key: installationScopedKey,
      message: "Too many installation push status updates",
      now
    }),
    schema: {
      operationId: "updatePushStatus",
      summary: "Update push status",
      description: "Enables or disables push notifications for the mobile app installation.",
      tags: ["Ferry Services API"],
      params: InstallationIDParams,
      body: Type.Ref(PushStatusSchema),
      response: {
        200: Type.Ref(PushStatusSchema),
        400: errorResponse("Invalid installationID or request body"),
        404: errorResponse("Installation not found"),
        429: errorResponse("Too many installation push status updates")
      }
    }
  }, async (request, reply) => {
    const { installationID } = request.params as { installationID: string };
    const installationId = parseInstallationId(installationID);
    if (!installationId) {
      return reply.code(400).send({ error: "Bad Request", message: "Invalid installationID" });
    }

    const status = updatePushStatus(db, installationId, request.body as PushStatusBody);
    return status ?? reply.code(404).send({ error: "Not Found", message: "Installation not found" });
  });

  app.get("/api/installations/:installationID/services", {
    preHandler: rateLimited(rateLimiter, {
      bucket: "installation-services-read",
      limit: 60,
      windowMs: 60 * 1000,
      key: installationScopedKey,
      message: "Too many installation service list requests",
      now
    }),
    schema: {
      operationId: "listInstallationServices",
      summary: "List installation services",
      description: "Returns the services saved by one mobile app installation.",
      tags: ["Ferry Services API"],
      params: InstallationIDParams,
      response: {
        200: Type.Array(Type.Ref(ServiceListResponseSchema)),
        400: errorResponse("Invalid installationID"),
        429: errorResponse("Too many installation service list requests")
      }
    }
  }, async (request, reply) => {
    const { installationID } = request.params as { installationID: string };
    const installationId = parseInstallationId(installationID);
    if (!installationId) {
      return reply.code(400).send({ error: "Bad Request", message: "Invalid installationID" });
    }

    return savedServicesForInstallation(installationId);
  });

  app.post("/api/installations/:installationID/services", {
    preHandler: rateLimited(rateLimiter, {
      bucket: "installation-services-write",
      limit: 20,
      windowMs: 60 * 1000,
      key: installationScopedKey,
      message: "Too many installation service updates",
      now
    }),
    schema: {
      operationId: "addInstallationService",
      summary: "Add installation service",
      description: "Adds a service to one mobile app installation and returns the updated saved service list.",
      tags: ["Ferry Services API"],
      params: InstallationIDParams,
      body: Type.Ref(AddServiceRequestSchema),
      response: {
        200: Type.Array(Type.Ref(ServiceListResponseSchema)),
        400: errorResponse("Invalid installationID or request body"),
        429: errorResponse("Too many installation service updates")
      }
    }
  }, async (request, reply) => {
    const { installationID } = request.params as { installationID: string };
    const installationId = parseInstallationId(installationID);
    if (!installationId) {
      return reply.code(400).send({ error: "Bad Request", message: "Invalid installationID" });
    }

    const { service_id: serviceId } = request.body as AddServiceRequestBody;
    addInstallationService(db, installationId, serviceId);
    return savedServicesForInstallation(installationId);
  });

  app.delete("/api/installations/:installationID/services/:serviceID", {
    preHandler: rateLimited(rateLimiter, {
      bucket: "installation-services-delete",
      limit: 20,
      windowMs: 60 * 1000,
      key: installationScopedKey,
      message: "Too many installation service updates",
      now
    }),
    schema: {
      operationId: "deleteInstallationService",
      summary: "Delete installation service",
      description: "Removes a service from one mobile app installation and returns the updated saved service list.",
      tags: ["Ferry Services API"],
      params: InstallationServiceParams,
      response: {
        200: Type.Array(Type.Ref(ServiceListResponseSchema)),
        400: errorResponse("Invalid installationID or serviceID"),
        429: errorResponse("Too many installation service updates")
      }
    }
  }, async (request, reply) => {
    const { installationID, serviceID } = request.params as { installationID: string; serviceID: number };
    const installationId = parseInstallationId(installationID);
    if (!installationId) {
      return reply.code(400).send({ error: "Bad Request", message: "Invalid installationID" });
    }

    deleteInstallationService(db, installationId, serviceID);
    return savedServicesForInstallation(installationId);
  });

  // #endregion

  // #region Timetable and offline API routes

  app.get("/api/timetable-documents", {
    schema: {
      operationId: "listTimetableDocuments",
      summary: "List timetable documents",
      description: "Returns current operator timetable documents. Pass serviceID to filter to documents linked to one service; omit it for the global timetable downloads screen. Clients should send If-None-Match with the stored ETag; unchanged lists return 304 Not Modified.",
      tags: ["Ferry Services API"],
      querystring: TimetableDocumentsQuery,
      headers: IfNoneMatchHeaders,
      response: {
        200: {
          description: "Timetable document list",
          headers: {
            "Cache-Control": Type.String({ description: "Cache policy for the response" }),
            ETag: Type.String({ description: "Entity tag for conditional requests" })
          },
          content: {
            "application/json": {
              schema: Type.Array(Type.Ref(TimetableDocumentResponseSchema))
            }
          }
        },
        304: describedResponse("Not Modified", Type.Null()),
        400: errorResponse("Invalid serviceID")
      }
    }
  }, async (request, reply) => {
    const { serviceID } = request.query as { serviceID?: number };
    const documents = listTimetableDocuments(db, serviceID).map(timetableDocumentToApi);
    const etag = etagForJson(documents);
    reply.header("Cache-Control", "private, no-cache, no-transform");
    reply.header("ETag", etag);

    if (request.headers["if-none-match"]?.split(",").map((value) => value.trim().replace(/^W\//, "")).includes(etag)) {
      return reply.code(304).send();
    }

    return documents;
  });

  app.get("/api/offline/snapshot.sqlite3", {
    preHandler: rateLimited(rateLimiter, {
      bucket: "offline-snapshot",
      limit: 12,
      windowMs: 5 * 60 * 1000,
      key: (request) => request.ip,
      message: "Too many offline snapshot download requests",
      now
    }),
    schema: {
      operationId: "getOfflineSnapshot",
      summary: "Download offline SQLite snapshot",
      description: "Returns the generated offline timetable SQLite database. Clients should send If-None-Match with the stored ETag; unchanged snapshots return 304 Not Modified. The response is CDN-cacheable and includes Cache-Control, ETag and Last-Modified headers.",
      tags: ["Ferry Services API"],
      headers: IfNoneMatchHeaders,
      response: {
        200: {
          description: "Offline SQLite snapshot",
          headers: {
            "Cache-Control": Type.String({ description: "Cache policy for the snapshot" }),
            ETag: Type.String({ description: "Entity tag for conditional requests" }),
            "Last-Modified": Type.String({ description: "Last modification time for the snapshot" })
          },
          content: {
            "application/vnd.sqlite3": {
              schema: Type.Ref(SnapshotBodySchema)
            }
          }
        },
        304: describedResponse("Not Modified", Type.Null()),
        400: errorResponse("Invalid request"),
        404: errorResponse("Offline snapshot has not been generated"),
        429: errorResponse("Too many offline snapshot download requests")
      }
    }
  }, async (request, reply) => {
    const metadata = readOfflineSnapshotMetadata(defaultSnapshotMetadataPath);
    if (!metadata || !fs.existsSync(defaultSnapshotPath)) {
      return reply.code(404).send({ error: "Not Found", message: "Offline snapshot has not been generated" });
    }

    reply.header("Cache-Control", "public, max-age=900, stale-while-revalidate=86400");
    reply.header("ETag", metadata.etag);
    reply.header("Last-Modified", new Date(metadata.generated_at).toUTCString());

    if (request.headers["if-none-match"]?.split(",").map((value) => value.trim().replace(/^W\//, "")).includes(metadata.etag)) {
      return reply.code(304).send();
    }

    return reply.type("application/vnd.sqlite3").send(fs.createReadStream(defaultSnapshotPath));
  });

  // #endregion

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

// #endregion

// #region Server entry point

export async function startServer(): Promise<void> {
  const app = await buildApp();
  await app.listen({ host: config.host, port: config.port });
}

// #endregion
