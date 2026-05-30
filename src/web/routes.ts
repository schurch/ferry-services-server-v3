import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { openDatabase } from "../shared/database.js";
import { getService, listServices } from "../features/services/read-model.js";
import { serviceToApi } from "../features/services/wire.js";
import { ServiceDetailQuery, ServiceIDParams } from "../app/route-support.js";
import {
  dateInput,
  isDateInput,
  renderAdditionalInfoPage,
  renderNotFoundPage,
  renderPrivacyPolicyPage,
  renderServicePage,
  renderServicesPage,
  renderStatsPage
} from "./pages.js";
import { getWebsiteStats } from "./stats.js";

export function registerWebRoutes(
  app: FastifyInstance,
  options: {
    db: ReturnType<typeof openDatabase>;
    now: () => Date;
  }
): void {
  const { db, now } = options;

  app.get("/", {
    schema: {
      hide: true,
      response: {
        200: Type.String()
      }
    }
  }, async (_request, reply) => {
    const services = listServices(db).map((service) => serviceToApi(service, {
      includeAdditionalInfo: false,
      includeLocationDetails: false,
      includeVessels: false
    }));
    return reply.type("text/html").send(renderServicesPage(services));
  });

  app.get("/service/:serviceID", {
    schema: {
      hide: true,
      params: ServiceIDParams,
      querystring: ServiceDetailQuery,
      response: {
        200: Type.String(),
        404: Type.String()
      }
    }
  }, async (request, reply) => {
    const { serviceID } = request.params as { serviceID: number };
    const { departuresDate } = request.query as { departuresDate?: string };
    const currentTime = now();
    const queryDate = isDateInput(departuresDate) ? departuresDate : dateInput(currentTime);
    const service = getService(db, serviceID, queryDate, currentTime);
    if (!service) {
      return reply.code(404).type("text/html").send(renderNotFoundPage("Service not found"));
    }

    return reply.type("text/html").send(renderServicePage(serviceToApi(service), queryDate, currentTime));
  });

  app.get("/service/:serviceID/info", {
    schema: {
      hide: true,
      params: ServiceIDParams,
      response: {
        200: Type.String(),
        404: Type.String()
      }
    }
  }, async (request, reply) => {
    const { serviceID } = request.params as { serviceID: number };
    const service = getService(db, serviceID, undefined, now());
    if (!service || !service.additionalInfo?.trim()) {
      return reply.code(404).type("text/html").send(renderNotFoundPage("Service information not found"));
    }

    return reply.type("text/html").send(renderAdditionalInfoPage(serviceToApi(service)));
  });

  app.get("/privacy-policy", {
    schema: {
      hide: true,
      response: {
        200: Type.String()
      }
    }
  }, async (_request, reply) => reply.type("text/html").send(renderPrivacyPolicyPage()));

  app.get("/privacy-policy.html", {
    schema: {
      hide: true,
      response: {
        200: Type.String()
      }
    }
  }, async (_request, reply) => reply.type("text/html").send(renderPrivacyPolicyPage()));

  app.get("/stats", {
    schema: {
      hide: true,
      response: {
        200: Type.String()
      }
    }
  }, async (_request, reply) => {
    const stats = getWebsiteStats(db, now());
    return reply.type("text/html").send(renderStatsPage(stats));
  });
}
