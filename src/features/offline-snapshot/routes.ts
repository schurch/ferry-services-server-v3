import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import { SnapshotBodySchema } from "../../api/schema.js";
import { MemoryRateLimiter } from "../../app/rate-limit.js";
import { describedResponse, errorResponse, IfNoneMatchHeaders, rateLimited } from "../../app/route-support.js";
import { defaultSnapshotMetadataPath, defaultSnapshotPath, readOfflineSnapshotMetadata } from "./snapshot.js";

export function registerOfflineSnapshotApiRoutes(
  app: FastifyInstance,
  options: {
    now: () => Date;
    rateLimiter: MemoryRateLimiter;
  }
): void {
  const { now, rateLimiter } = options;

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
}
