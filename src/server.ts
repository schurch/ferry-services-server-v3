import fastifyStatic from "@fastify/static";
import * as Sentry from "@sentry/node";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryRateLimiter } from "./api/rate-limit.js";
import { registerApiDocumentation, registerApiRoutes } from "./api/routes.js";
import { config } from "./config.js";
import { openDatabase } from "./database.js";
import { deleteStaleInstallations } from "./api/db.js";
import { loggerOptions } from "./logger.js";
import { sentryEnabled } from "./sentry.js";
import { registerWebRoutes } from "./web/routes.js";

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

  runInstallationMaintenance();
  await registerApiDocumentation(app);
  await registerPlugins(app);

  registerWebRoutes(app, { db, now });
  registerApiRoutes(app, { db, now, rateLimiter, runInstallationMaintenance });

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
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
    index: false,
    wildcard: true
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startServer();
}
