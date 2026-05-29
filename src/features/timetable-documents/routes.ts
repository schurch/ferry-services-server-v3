import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { openDatabase } from "../../shared/database.js";
import { TimetableDocumentResponseSchema } from "../../api/schema.js";
import { describedResponse, errorResponse, IfNoneMatchHeaders, TimetableDocumentsQuery } from "../../app/route-support.js";
import { etagForJson, listTimetableDocuments } from "../services/read-model.js";
import { timetableDocumentToApi } from "../services/wire.js";

export function registerTimetableDocumentApiRoutes(
  app: FastifyInstance,
  options: {
    db: ReturnType<typeof openDatabase>;
  }
): void {
  const { db } = options;

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
}
