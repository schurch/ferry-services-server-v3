import { Type, type Static } from "@sinclair/typebox";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ErrorResponseSchema, AddServiceRequestSchema, CreateInstallationRequestSchema, PushStatusSchema } from "../api/schema.js";
import { MemoryRateLimiter } from "./rate-limit.js";

export const ServiceIDParams = Type.Object({
  serviceID: Type.Integer()
});

export const InstallationIDParams = Type.Object({
  installationID: Type.String()
});

export const InstallationServiceParams = Type.Object({
  installationID: Type.String(),
  serviceID: Type.Integer()
});

export const ServiceDetailQuery = Type.Object({
  departuresDate: Type.Optional(Type.String({ format: "date" }))
});

export const TimetableDocumentsQuery = Type.Object({
  serviceID: Type.Optional(Type.Integer())
});

export const IfNoneMatchHeaders = Type.Object({
  "if-none-match": Type.Optional(Type.String())
});

export type CreateInstallationRequestBody = Static<typeof CreateInstallationRequestSchema>;

export type AddServiceRequestBody = Static<typeof AddServiceRequestSchema>;

export type PushStatusBody = Static<typeof PushStatusSchema>;

export function describedResponse<T extends Record<string, unknown>>(description: string, schema: T): T & { description: string } {
  return {
    ...schema,
    description
  };
}

export function errorResponse(description: string) {
  return describedResponse(description, Type.Ref(ErrorResponseSchema));
}

export function parseInstallationId(value: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

export function installationScopedKey(request: FastifyRequest): string {
  return `${request.ip}:${String((request.params as { installationID?: string }).installationID ?? "")}`;
}

export function rateLimited(
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
