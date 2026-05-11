import "dotenv/config";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Type } from "@sinclair/typebox";
import Fastify from "fastify";
import { config } from "../config/config.js";
import { etagForJson, getService, listServices, listTimetableDocuments, listVessels } from "../db/api.js";
import { openDatabase } from "../db/database.js";

const app = Fastify({ logger: true });
const db = openDatabase();

const HealthResponse = Type.Object({
  ok: Type.Boolean()
});

const RootResponse = Type.Object({
  ok: Type.Boolean(),
  message: Type.String()
});

const ServiceIDParams = Type.Object({
  serviceID: Type.Integer()
});

const ServiceDetailQuery = Type.Object({
  departuresDate: Type.Optional(Type.String({ format: "date" }))
});

const TimetableDocumentsQuery = Type.Object({
  serviceID: Type.Optional(Type.Integer())
});

await app.register(swagger, {
  openapi: {
    info: {
      title: "Scottish Ferry Services API",
      description: "Live ferry service data, mobile installation state, vessel positions and offline timetable downloads.",
      version: "3.0.0"
    },
    tags: [{ name: "Ferry Services API" }]
  }
});

await app.register(swaggerUi, {
  routePrefix: "/swagger",
  uiConfig: {
    docExpansion: "list",
    deepLinking: false
  }
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

app.get("/api/health", {
  schema: {
    summary: "Health check",
    tags: ["Ferry Services API"],
    response: {
      200: HealthResponse
    }
  }
}, async () => ({
  ok: true
}));

app.get("/api/services", {
  schema: {
    summary: "List services",
    description: "Returns all visible ferry services with current live status, operator, route and location metadata.",
    tags: ["Ferry Services API"],
    response: {
      200: Type.Array(Type.Any())
    }
  }
}, async () => listServices(db));

app.get("/api/services/:serviceID", {
  schema: {
    summary: "Get service detail",
    description: "Returns one visible service. departuresDate is accepted for API compatibility; scheduled ferry departures will be added with the v3 TransXChange importer.",
    tags: ["Ferry Services API"],
    params: ServiceIDParams,
    querystring: ServiceDetailQuery,
    response: {
      200: Type.Union([Type.Any(), Type.Null()])
    }
  }
}, async (request) => {
  const { serviceID } = request.params as { serviceID: number };
  return getService(db, serviceID);
});

app.get("/api/vessels", {
  schema: {
    summary: "List vessels",
    description: "Returns recent vessel positions used by the live service UI.",
    tags: ["Ferry Services API"],
    response: {
      200: Type.Array(Type.Any())
    }
  }
}, async () => listVessels(db));

app.get("/api/timetable-documents", {
  schema: {
    summary: "List timetable documents",
    description: "Returns current operator timetable documents. Pass serviceID to filter to documents linked to one service.",
    tags: ["Ferry Services API"],
    querystring: TimetableDocumentsQuery,
    response: {
      200: Type.Array(Type.Any()),
      304: Type.Null()
    }
  }
}, async (request, reply) => {
  const { serviceID } = request.query as { serviceID?: number };
  const documents = listTimetableDocuments(db, serviceID);
  const etag = etagForJson(documents);
  reply.header("Cache-Control", "private, no-cache, no-transform");
  reply.header("ETag", etag);

  if (request.headers["if-none-match"]?.split(",").map((value) => value.trim().replace(/^W\//, "")).includes(etag)) {
    return reply.code(304).send();
  }

  return documents;
});

app.get("/", {
  schema: {
    hide: true,
    response: {
      200: RootResponse
    }
  }
}, async () => ({
  ok: true,
  message: "ferry-services-server-v3 is running"
}));

app.addHook("onClose", async () => {
  db.close();
});

await app.listen({ host: config.host, port: config.port });
