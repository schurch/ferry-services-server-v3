import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { openDatabase } from "../../shared/database.js";
import { AddServiceRequestSchema, CreateInstallationRequestSchema, PushStatusSchema, ServiceListResponseSchema } from "../../api/schema.js";
import { MemoryRateLimiter } from "../../app/rate-limit.js";
import { serviceToApi } from "../services/wire.js";
import {
  AddServiceRequestBody,
  CreateInstallationRequestBody,
  errorResponse,
  InstallationIDParams,
  installationScopedKey,
  InstallationServiceParams,
  parseInstallationId,
  PushStatusBody,
  rateLimited
} from "../../app/route-support.js";
import {
  addInstallationService,
  checkAndRecordInstallationRegistrationAttempt,
  deleteInstallationService,
  getPushStatus,
  updatePushStatus,
  upsertInstallation
} from "./repository.js";
import { listInstallationServices } from "../services/read-model.js";

export function registerInstallationApiRoutes(
  app: FastifyInstance,
  options: {
    db: ReturnType<typeof openDatabase>;
    now: () => Date;
    rateLimiter: MemoryRateLimiter;
    runInstallationMaintenance: () => void;
  }
): void {
  const { db, now, rateLimiter, runInstallationMaintenance } = options;

  function savedServicesForInstallation(installationId: string): Record<string, unknown>[] {
    return listInstallationServices(db, installationId).map((service) => serviceToApi(service, {
      includeAdditionalInfo: false,
      includeLocationDetails: false,
      includeVessels: false
    }));
  }

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
}
