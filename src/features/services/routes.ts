import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { openDatabase } from "../../shared/database.js";
import { ServiceListResponseSchema, ServiceResponseSchema } from "../../api/schema.js";
import { MemoryRateLimiter } from "../../app/rate-limit.js";
import { errorResponse, rateLimited, ServiceDetailQuery, ServiceIDParams } from "../../app/route-support.js";
import { getService, listServices } from "./read-model.js";
import { serviceToApi } from "./wire.js";

export function registerServiceApiRoutes(
  app: FastifyInstance,
  options: {
    db: ReturnType<typeof openDatabase>;
    now: () => Date;
    rateLimiter: MemoryRateLimiter;
  }
): void {
  const { db, now, rateLimiter } = options;

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
}
