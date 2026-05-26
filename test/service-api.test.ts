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
  it("serves server-rendered public pages", async () => {
    currentDb = createTestDatabase();
    currentApp = await buildApp({
      db: currentDb.db,
      now: () => new Date("2026-05-25T12:00:00Z")
    });
    const app = currentApp;
    assert.notEqual(app, null);

    const listResponse = await app.inject({ method: "GET", url: "/" });
    assert.equal(listResponse.statusCode, 200);
    assert.match(listResponse.headers["content-type"] as string, /text\/html/);
    assert.match(listResponse.body, /Scottish Ferries/);
    assert.match(listResponse.body, /Search by area or route/);

    const detailResponse = await app.inject({ method: "GET", url: "/service/1?departuresDate=2026-05-25" });
    assert.equal(detailResponse.statusCode, 200);
    assert.match(detailResponse.headers["content-type"] as string, /text\/html/);
    assert.match(detailResponse.body, /panel-map-bleed/);
    assert.match(detailResponse.body, /map-shell/);
    assert.match(detailResponse.body, /Locations/);
    assert.match(detailResponse.body, /Caledonian MacBrayne/);
  });

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

  it("includes reliability status breakdown on service detail responses", async () => {
    currentDb = createTestDatabase();
    seedReliabilityFixture(currentDb);
    currentApp = await buildApp({
      db: currentDb.db,
      now: () => new Date("2026-05-25T12:00:00Z")
    });
    const app = currentApp;
    assert.notEqual(app, null);

    const response = await app.inject({ method: "GET", url: "/api/services/5?departuresDate=2026-05-25" });
    assert.equal(response.statusCode, 200);

    const detail = response.json() as {
      reliability?: {
        status_breakdown: Record<string, {
          period: string;
          observed_operating_days: number;
          scheduled_sailings: number;
          day_statuses: Record<string, { days: number; percentage: number }>;
        }>;
      };
    };

    assert.deepEqual(detail.reliability, {
      status_breakdown: {
        last_7_days: {
          period: "last_7_days",
          start: "2026-05-19T00:00:00.000Z",
          end: "2026-05-26T00:00:00.000Z",
          observed_operating_days: 2,
          scheduled_sailings: 4,
          day_statuses: {
            normal: { days: 0, percentage: 0 },
            disrupted: { days: 1, percentage: 50 },
            cancelled: { days: 1, percentage: 50 }
          }
        },
        last_30_days: {
          period: "last_30_days",
          start: "2026-04-26T00:00:00.000Z",
          end: "2026-05-26T00:00:00.000Z",
          observed_operating_days: 2,
          scheduled_sailings: 4,
          day_statuses: {
            normal: { days: 0, percentage: 0 },
            disrupted: { days: 1, percentage: 50 },
            cancelled: { days: 1, percentage: 50 }
          }
        }
      }
    });
  });

  it("documents reliability fields in the OpenAPI service detail schema", async () => {
    currentDb = createTestDatabase();
    currentApp = await buildApp({ db: currentDb.db });
    const app = currentApp;
    assert.notEqual(app, null);

    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    assert.equal(response.statusCode, 200);

    const openapi = response.json() as {
      components?: {
        schemas?: Record<string, {
          properties?: Record<string, unknown>;
        }>;
      };
    };
    const schemas = openapi.components?.schemas ?? {};

    assert.deepEqual(schemas.ServiceResponse?.properties?.reliability, {
      $ref: "#/components/schemas/ReliabilityResponse"
    });
    assert.deepEqual(schemas.ReliabilityResponse?.properties?.status_breakdown, {
      type: "object",
      properties: {
        last_7_days: { $ref: "#/components/schemas/ReliabilityPeriodResponse" },
        last_30_days: { $ref: "#/components/schemas/ReliabilityPeriodResponse" }
      },
      required: ["last_7_days", "last_30_days"],
      description: "Rolling reliability breakdowns for this service, keyed by period to prevent duplicate ranges."
    });
    assert.notEqual(schemas.ReliabilityPeriodResponse?.properties?.observed_operating_days, undefined);
    assert.notEqual(schemas.ReliabilityPeriodResponse?.properties?.scheduled_sailings, undefined);
    assert.notEqual(schemas.ReliabilityPeriodResponse?.properties?.day_statuses, undefined);
    assert.notEqual(schemas.ReliabilityStatusBreakdownEntry?.properties?.percentage, undefined);
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

function seedReliabilityFixture(testDb: TestDatabase): void {
  testDb.db.exec(`
    INSERT INTO transxchange_documents (
      document_id,
      source_path,
      source_file_name,
      source_version_key,
      source_creation_datetime,
      source_modification_datetime,
      imported_at
    ) VALUES (
      1,
      'fixture',
      'fixture.xml',
      'fixture-v1',
      '2026-05-01 00:00:00',
      '2026-05-01 00:00:00',
      '2026-05-01 00:00:00'
    );

    INSERT INTO transxchange_services (
      document_id,
      service_code,
      operator_ref,
      mode,
      description,
      origin,
      destination,
      start_date,
      end_date
    ) VALUES (
      1,
      'CALM_CM5',
      'CALMAC',
      'ferry',
      'Ardrossan - Brodick',
      'Ardrossan',
      'Brodick',
      '2026-01-01',
      '2026-12-31'
    );

    INSERT INTO transxchange_journey_patterns (
      document_id,
      journey_pattern_id,
      service_code,
      direction
    ) VALUES (
      1,
      'JP1',
      'CALM_CM5',
      'outbound'
    );

    INSERT INTO transxchange_journey_pattern_sections (
      document_id,
      journey_pattern_id,
      section_ref,
      section_order
    ) VALUES (
      1,
      'JP1',
      'SEC1',
      1
    );

    INSERT INTO transxchange_journey_pattern_timing_links (
      document_id,
      journey_pattern_timing_link_id,
      journey_pattern_section_ref,
      sort_order,
      from_stop_point_ref,
      from_activity,
      from_timing_status,
      to_stop_point_ref,
      to_activity,
      to_timing_status,
      route_link_ref,
      direction,
      run_seconds,
      from_wait_seconds
    ) VALUES (
      1,
      'TL1',
      'SEC1',
      1,
      '9300ARD',
      '',
      '',
      '9300BRB',
      '',
      '',
      'RL1',
      'outbound',
      3600,
      0
    );

    INSERT INTO transxchange_vehicle_journeys (
      document_id,
      vehicle_journey_code,
      service_code,
      line_id,
      journey_pattern_id,
      operator_ref,
      departure_time,
      note,
      note_code
    ) VALUES
      (
        1,
        'VJ1',
        'CALM_CM5',
        'LINE1',
        'JP1',
        'CALMAC',
        '08:00:00',
        '',
        ''
      ),
      (
        1,
        'VJ2',
        'CALM_CM5',
        'LINE1',
        'JP1',
        'CALMAC',
        '12:00:00',
        '',
        ''
      );

    INSERT INTO transxchange_vehicle_journey_days (
      document_id,
      vehicle_journey_code,
      day_rule
    ) VALUES
      (
        1,
        'VJ1',
        'monday_to_sunday'
      ),
      (
        1,
        'VJ2',
        'monday_to_sunday'
      );

    INSERT INTO service_scrape_runs (
      scrape_run_id,
      operator_name,
      organisation_id,
      source_name,
      started_at,
      completed_at,
      success
    ) VALUES
      (1, 'CalMac', 1, 'fixture', '2026-05-24 08:00:00', '2026-05-24 08:05:00', 1),
      (2, 'CalMac', 1, 'fixture', '2026-05-25 08:00:00', '2026-05-25 08:05:00', 1);

    INSERT INTO service_status_observations (
      observation_id,
      scrape_run_id,
      service_id,
      observed_at,
      status
    ) VALUES
      (1, 1, 5, '2026-05-24 09:00:00', 1),
      (2, 2, 5, '2026-05-25 09:00:00', 2),
      (3, 2, 5, '2026-05-25 17:00:00', 0);
  `);
}
