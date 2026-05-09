import "dotenv/config";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Type } from "@sinclair/typebox";
import Fastify from "fastify";
import { config } from "../config/config.js";

const app = Fastify({ logger: true });

const HealthResponse = Type.Object({
  ok: Type.Boolean()
});

const RootResponse = Type.Object({
  ok: Type.Boolean(),
  message: Type.String()
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

await app.listen({ host: config.host, port: config.port });
