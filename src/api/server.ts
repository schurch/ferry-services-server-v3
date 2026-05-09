import "dotenv/config";
import Fastify from "fastify";
import { config } from "../config/config.js";

const app = Fastify({ logger: true });

app.get("/api/health", async () => ({
  ok: true
}));

app.get("/", async () => ({
  ok: true,
  message: "ferry-services-server-v3 is running"
}));

await app.listen({ host: config.host, port: config.port });

