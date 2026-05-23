import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/api/app.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

let currentDb: TestDatabase | null = null;
let currentApp: FastifyInstance | null = null;

afterEach(async () => {
  await currentApp?.close();
  currentApp = null;
  currentDb?.cleanup();
  currentDb = null;
});

describe("Service API responses", () => {
  it("includes full operator contact details in list and detail responses", async () => {
    currentDb = createTestDatabase();
    currentApp = await buildApp({ db: currentDb.db });
    const app = currentApp;
    assert.notEqual(app, null);

    const listResponse = await app.inject({ method: "GET", url: "/api/services" });
    assert.equal(listResponse.statusCode, 200);
    const services = listResponse.json() as Array<{ service_id: number; operator?: Record<string, unknown> }>;
    const listService = services.find((service) => service.service_id === 1);
    assert.notEqual(listService, undefined);
    assertFullCalmacOperator(listService?.operator);

    const detailResponse = await app.inject({ method: "GET", url: "/api/services/1" });
    assert.equal(detailResponse.statusCode, 200);
    const detail = detailResponse.json() as { operator?: Record<string, unknown> };
    assertFullCalmacOperator(detail.operator);
  });
});

function assertFullCalmacOperator(operator: Record<string, unknown> | undefined): void {
  assert.deepEqual(operator, {
    id: 1,
    name: "Caledonian MacBrayne",
    website: "https://calmac.co.uk/",
    local_number: "0800 066 5000",
    international_number: "+44 1475 650 397",
    email: "enquiries@calmac.co.uk",
    x: "https://x.com/calmacferries",
    facebook: "https://www.facebook.com/calmacferries"
  });
}
