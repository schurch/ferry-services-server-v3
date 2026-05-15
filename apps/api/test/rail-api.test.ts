import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type Database from "better-sqlite3";
import { getService, listServices } from "../src/db/api.js";
import { ingestTransxchangeDirectory } from "../src/jobs/transxchange-ingester.js";
import type { ServiceResponse } from "../src/types/api.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

let currentDb: TestDatabase | null = null;
const RealDate = Date;
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

afterEach(() => {
  globalThis.Date = RealDate;
  currentDb?.cleanup();
  currentDb = null;
});

describe("Rail departure API formatting", () => {
  it("emits next rail departures with seconds when stored times are minute precision", () => {
    freezeNow("2026-05-14T11:00:00.000Z");

    currentDb = createTestDatabase();
    const db = currentDb.db;
    seedRailDepartureScenario(db);

    const detail = requireService(db, 5);
    const listed = listServices(db).find((service) => service.serviceId === 5);

    assert.equal(detail.locations[0]?.nextRailDeparture?.departure, "2026-05-14T11:48:00.000Z");
    assert.equal(listed?.locations[0]?.nextRailDeparture?.departure, "2026-05-14T11:48:00.000Z");
  });

  it("keeps all client-facing timestamps on one ISO-8601 format", () => {
    freezeNow("2026-05-14T11:00:00.000Z");

    currentDb = createTestDatabase();
    const db = currentDb.db;
    seedTimestampContractScenario(db);

    const listed = listServices(db).find((service) => service.serviceId === 9100);
    const detail = getService(db, 9100, "2026-03-16");

    assert.notEqual(listed, undefined);
    assert.notEqual(detail, null);

    assertAllTimestampsMatch(listed as ServiceResponse);
    assertAllTimestampsMatch(detail as ServiceResponse);
  });
});

function freezeNow(isoTimestamp: string): void {
  const fixed = new RealDate(isoTimestamp);
  globalThis.Date = class extends RealDate {
    constructor(value?: string | number | Date) {
      super(value ?? fixed);
    }

    static now(): number {
      return fixed.getTime();
    }
  } as DateConstructor;
}

function seedRailDepartureScenario(db: Database.Database): void {
  db.prepare("DELETE FROM rail_departures WHERE location_id = ?").run(3);
  db.prepare("DELETE FROM service_locations WHERE service_id = ? AND location_id != ?").run(5, 3);

  db.prepare(`
    INSERT INTO rail_departures (
      departure_crs,
      departure_name,
      destination_crs,
      destination_name,
      scheduled_departure_time,
      estimated_departure_time,
      cancelled,
      platform,
      location_id,
      created
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "ADS",
    "Ardrossan Harbour",
    "GLC",
    "Glasgow Central",
    "11:48",
    "On time",
    0,
    "1",
    3,
    "2026-05-14 10:59:00"
  );
}

function seedTimestampContractScenario(db: Database.Database): void {
  ingestTransxchangeDirectory(db, "test/fixtures/transxchange-api/01-basic-real");

  db.prepare("DELETE FROM transxchange_service_mappings WHERE service_id = ?").run(9100);
  db.prepare("DELETE FROM service_locations WHERE service_id = ?").run(9100);
  db.prepare("DELETE FROM service_locations WHERE location_id IN (SELECT location_id FROM locations WHERE stop_point_id IN (?, ?))").run("9300GIL", "9300SMH");
  db.prepare("DELETE FROM services WHERE service_id = ?").run(9100);
  db.prepare("DELETE FROM locations WHERE location_id IN (?, ?)").run(9101, 9102);
  db.prepare("DELETE FROM locations WHERE stop_point_id IN (?, ?)").run("9300GIL", "9300SMH");
  db.prepare("DELETE FROM rail_departures WHERE location_id = ?").run(9101);
  db.prepare("DELETE FROM vessels WHERE mmsi = ?").run(123456789);
  db.prepare("DELETE FROM timetable_document_services WHERE service_id = ?").run(9100);
  db.prepare("DELETE FROM timetable_documents WHERE timetable_document_id = ?").run(910001);

  db.prepare("INSERT INTO organisations (organisation_id, name) VALUES (999, 'TX API Test') ON CONFLICT DO NOTHING").run();
  db.prepare(`
    INSERT INTO services (service_id, area, route, organisation_id, status, last_updated_date, updated)
    VALUES (?, ?, ?, 999, 0, ?, ?)
  `).run(9100, "PENTLAND FIRTH", "Gills Bay - St Margaret's Hope", "2026-05-14 10:40:00", "2026-05-14 10:50:00");
  db.prepare(`
    INSERT INTO locations (location_id, name, latitude, longitude, stop_point_id)
    VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
  `).run(
    9101, "Gills Bay", 58.63917534851306, -3.1614340648459605, "9300GIL",
    9102, "St Margaret's Hope", 58.832021233320255, -2.9622400477352535, "9300SMH"
  );
  db.prepare("INSERT INTO service_locations (service_id, location_id) VALUES (?, ?), (?, ?)").run(9100, 9101, 9100, 9102);
  db.prepare("INSERT INTO transxchange_service_mappings (service_id, service_code) VALUES (?, ?)").run(9100, "PENT_PF1");

  db.prepare(`
    INSERT INTO rail_departures (
      departure_crs,
      departure_name,
      destination_crs,
      destination_name,
      scheduled_departure_time,
      estimated_departure_time,
      cancelled,
      platform,
      location_id,
      created
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "GBY",
    "Gills Bay",
    "SMH",
    "St Margaret's Hope",
    "11:48",
    "On time",
    0,
    "1",
    9101,
    "2026-05-14 10:59:00"
  );

  db.prepare(`
    INSERT INTO vessels (mmsi, name, latitude, longitude, last_received, updated, organisation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(123456789, "MV Example", 58.7, -3.0, "2026-05-14 10:55:00", "2026-05-14 10:55:00", 999);

  db.prepare(`
    INSERT INTO timetable_documents (
      timetable_document_id,
      organisation_id,
      title,
      source_url,
      content_hash,
      content_type,
      content_length,
      last_seen_at,
      updated
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    910001,
    999,
    "Example timetable",
    "https://example.com/timetable.pdf",
    "sha256-example",
    "application/pdf",
    12345,
    "2026-05-14 10:45:00",
    "2026-05-14 10:46:00"
  );
  db.prepare("INSERT INTO timetable_document_services (timetable_document_id, service_id) VALUES (?, ?)").run(910001, 9100);
}

function assertAllTimestampsMatch(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertAllTimestampsMatch(item);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && isTimestampKey(key)) {
      assert.match(child, isoTimestampPattern, `${key} should be full ISO-8601 with milliseconds`);
    } else {
      assertAllTimestampsMatch(child);
    }
  }
}

function isTimestampKey(key: string): boolean {
  return ["departure", "arrival", "lastReceived", "lastSeenAt", "updated", "lastUpdatedDate"].includes(key);
}

function requireService(db: Database.Database, serviceId: number): ServiceResponse {
  const service = getService(db, serviceId);
  assert.notEqual(service, null);
  return service as ServiceResponse;
}
