import "dotenv/config";
import fastifyStatic from "@fastify/static";
import * as Sentry from "@sentry/node";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Type } from "@sinclair/typebox";
import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config/config.js";
import { etagForJson, getService, listInstallationServices, listServices, listTimetableDocuments, listVessels } from "../db/api.js";
import { openDatabase } from "../db/database.js";
import { addInstallationService, deleteInstallationService, getPushStatus, updatePushStatus, upsertInstallation } from "../db/installations.js";
import { defaultSnapshotMetadataPath, defaultSnapshotPath, readOfflineSnapshotMetadata } from "../offline/snapshot.js";
import { sentryEnabled } from "../sentry.js";
import {
  AddServiceRequestSchema,
  CreateInstallationRequestSchema,
  ErrorResponseSchema,
  LocationResponseSchema,
  OfflineSnapshotSchema,
  OrganisationResponseSchema,
  PushStatusSchema,
  RailDepartureResponseSchema,
  ServiceResponseSchema,
  TimetableDocumentResponseSchema,
  VesselResponseSchema,
  DepartureDestinationSchema,
  DepartureResponseSchema,
  LocationWeatherResponseSchema
} from "./schema.js";
import { serviceToApi, timetableDocumentToApi, vesselToApi } from "./wire.js";

const app = Fastify({
  logger: true,
  ignoreTrailingSlash: true
});
const db = openDatabase();
const publicDir = path.resolve("public");

for (const schema of [
  ErrorResponseSchema,
  PushStatusSchema,
  CreateInstallationRequestSchema,
  AddServiceRequestSchema,
  OrganisationResponseSchema,
  LocationWeatherResponseSchema,
  RailDepartureResponseSchema,
  DepartureDestinationSchema,
  DepartureResponseSchema,
  LocationResponseSchema,
  VesselResponseSchema,
  TimetableDocumentResponseSchema,
  ServiceResponseSchema,
  OfflineSnapshotSchema
]) {
  app.addSchema(schema);
}

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

type CreateInstallationRequestBody = {
  device_token: string;
  device_type: "IOS" | "Android";
};

type AddServiceRequestBody = {
  service_id: number;
};

type PushStatusBody = {
  enabled: boolean;
};

function parseInstallationId(value: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function savedServicesForInstallation(installationId: string): Record<string, unknown>[] {
  return listInstallationServices(db, installationId).map(serviceToApi);
}

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

app.get(
  "/openapi.json",
  {
    schema: {
      hide: true
    }
  },
  async () => app.swagger()
);

app.get("/api/services", {
  schema: {
    operationId: "listServices",
    summary: "List services",
    description: "Returns all visible ferry services with current live status, operator, route and location metadata. Scheduled departures are not embedded in this list response.",
    tags: ["Ferry Services API"],
    response: {
      200: Type.Array(Type.Ref(ServiceResponseSchema))
    }
  }
}, async () => listServices(db).map(serviceToApi));

app.get("/api/services/:serviceID", {
  schema: {
    operationId: "getService",
    summary: "Get service detail",
    description: "Returns one visible service. Pass departuresDate as YYYY-MM-DD to include scheduled ferry departures for that local date.",
    tags: ["Ferry Services API"],
    params: ServiceIDParams,
    querystring: ServiceDetailQuery,
    response: {
      200: Type.Union([Type.Ref(ServiceResponseSchema), Type.Null()])
    }
  }
}, async (request) => {
  const { serviceID } = request.params as { serviceID: number };
  const { departuresDate } = request.query as { departuresDate?: string };
  const service = getService(db, serviceID, departuresDate);
  return service ? serviceToApi(service) : null;
});

app.post("/api/installations/:installationID", {
  schema: {
    operationId: "createInstallation",
    summary: "Create installation",
    description: "Registers a mobile app installation for push notifications and returns that installation's saved services.",
    tags: ["Ferry Services API"],
    params: InstallationIDParams,
    body: Type.Ref(CreateInstallationRequestSchema),
    response: {
      200: Type.Array(Type.Ref(ServiceResponseSchema)),
      400: Type.Ref(ErrorResponseSchema)
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
  schema: {
    operationId: "getPushStatus",
    summary: "Get push status",
    description: "Returns whether push notifications are enabled for the mobile app installation.",
    tags: ["Ferry Services API"],
    params: InstallationIDParams,
    response: {
      200: Type.Ref(PushStatusSchema),
      400: Type.Ref(ErrorResponseSchema),
      404: Type.Ref(ErrorResponseSchema)
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
  schema: {
    operationId: "updatePushStatus",
    summary: "Update push status",
    description: "Enables or disables push notifications for the mobile app installation.",
    tags: ["Ferry Services API"],
    params: InstallationIDParams,
    body: Type.Ref(PushStatusSchema),
    response: {
      200: Type.Ref(PushStatusSchema),
      400: Type.Ref(ErrorResponseSchema),
      404: Type.Ref(ErrorResponseSchema)
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
  schema: {
    operationId: "listInstallationServices",
    summary: "List installation services",
    description: "Returns the services saved by one mobile app installation.",
    tags: ["Ferry Services API"],
    params: InstallationIDParams,
    response: {
      200: Type.Array(Type.Ref(ServiceResponseSchema)),
      400: Type.Ref(ErrorResponseSchema)
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
  schema: {
    operationId: "addInstallationService",
    summary: "Add installation service",
    description: "Adds a service to one mobile app installation and returns the updated saved service list.",
    tags: ["Ferry Services API"],
    params: InstallationIDParams,
    body: Type.Ref(AddServiceRequestSchema),
    response: {
      200: Type.Array(Type.Ref(ServiceResponseSchema)),
      400: Type.Ref(ErrorResponseSchema)
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
  schema: {
    operationId: "deleteInstallationService",
    summary: "Delete installation service",
    description: "Removes a service from one mobile app installation and returns the updated saved service list.",
    tags: ["Ferry Services API"],
    params: InstallationServiceParams,
    response: {
      200: Type.Array(Type.Ref(ServiceResponseSchema)),
      400: Type.Ref(ErrorResponseSchema)
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

app.get("/api/vessels", {
  schema: {
    operationId: "listVessels",
    summary: "List vessels",
    description: "Returns recent vessel positions used by the live service UI.",
    tags: ["Ferry Services API"],
    response: {
      200: Type.Array(Type.Ref(VesselResponseSchema))
    }
  }
}, async () => listVessels(db).map(vesselToApi));

app.get("/api/timetable-documents", {
  schema: {
    operationId: "listTimetableDocuments",
    summary: "List timetable documents",
    description: "Returns current operator timetable documents. Pass serviceID to filter to documents linked to one service; omit it for the global timetable downloads screen. Clients should send If-None-Match with the stored ETag; unchanged lists return 304 Not Modified.",
    tags: ["Ferry Services API"],
    querystring: TimetableDocumentsQuery,
    response: {
      200: Type.Array(Type.Ref(TimetableDocumentResponseSchema)),
      304: Type.Null()
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
  schema: {
    operationId: "downloadOfflineSnapshot",
    summary: "Download offline SQLite snapshot",
    description: "Returns the generated offline timetable SQLite database. Clients should send If-None-Match with the stored ETag; unchanged snapshots return 304 Not Modified.",
    tags: ["Ferry Services API"],
    response: {
      200: {
        description: "Offline SQLite snapshot",
        content: {
          "application/vnd.sqlite3": {
            schema: Type.Ref(OfflineSnapshotSchema)
          }
        }
      },
      304: Type.Null(),
      404: Type.Ref(ErrorResponseSchema)
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

app.get("/", {
  schema: {
    hide: true,
    response: {
      200: Type.Any(),
      404: Type.Ref(ErrorResponseSchema)
    }
  }
}, async (_request, reply) => {
  if (fs.existsSync(path.join(publicDir, "index.html"))) {
    return reply.sendFile("index.html", { maxAge: 0, immutable: false });
  }

  return reply.code(404).send({ error: "Not Found", message: "Web dist has not been published to public/" });
});

if (sentryEnabled) {
  Sentry.setupFastifyErrorHandler(app, {
    shouldHandleError: (_error, _request, reply) => reply.statusCode >= 500
  });
}

app.addHook("onClose", async () => {
  db.close();
});

await app.listen({ host: config.host, port: config.port });
