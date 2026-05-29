import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type Database from "better-sqlite3";
import { getService, listServices } from "../services/read-model.js";
import { ingestTransxchangeDirectory } from "../transxchange/ingester.js";
import type { ServiceResponse } from "../services/types.js";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers.js";

let currentDb: TestDatabase | null = null;
const RealDate = Date;
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

afterEach(() => {
  globalThis.Date = RealDate;
  currentDb?.cleanup();
  currentDb = null;
});

describe("Vessel API formatting", () => {
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

  it("uses known vessel voyages to keep vessels on their matching service", () => {
    freezeNow("2026-05-14T11:00:00.000Z");

    currentDb = createTestDatabase();
    const db = currentDb.db;
    seedTimestampContractScenario(db);

    db.prepare(`
      INSERT INTO services (service_id, area, route, organisation_id, status, updated)
      VALUES (?, ?, ?, 999, 0, ?)
    `).run(9103, "PENTLAND FIRTH", "Nearby Test Route", "2026-05-14 10:50:00");
    db.prepare(`
      INSERT INTO locations (location_id, name, latitude, longitude)
      VALUES (?, ?, ?, ?), (?, ?, ?, ?)
    `).run(
      9104, "Nearby North", 58.68, -3.03,
      9105, "Nearby South", 58.73, -2.99
    );
    db.prepare("INSERT INTO service_locations (service_id, location_id) VALUES (?, ?), (?, ?)").run(9103, 9104, 9103, 9105);

    db.prepare(`
      UPDATE vessels
      SET destination_name = ?,
          origin_name = ?,
          origin_departed_at = ?
      WHERE mmsi = ?
    `).run("St Margaret's Hope", "Gills Bay", "2026-05-14 10:40:00", 123456789);

    assert.equal(requireService(db, 9100).vessels.length, 1);
    assert.equal(requireService(db, 9103).vessels.length, 0);
    assert.equal(requireService(db, 9100).vessels[0]?.voyage?.estimatedArrival, undefined);
  });

  it("shows recent vessels when voyage data is incomplete", () => {
    freezeNow("2026-05-14T11:00:00.000Z");

    currentDb = createTestDatabase();
    const db = currentDb.db;
    seedTimestampContractScenario(db);

    db.prepare(`
      UPDATE vessels
      SET origin_name = ?,
          destination_name = NULL,
          origin_departed_at = NULL
      WHERE mmsi = ?
    `).run("Unknown Pier", 123456789);

    assert.equal(requireService(db, 9100).vessels.length, 1);
    assert.equal(requireService(db, 9100).vessels[0]?.voyage, undefined);
  });

  it("shows recent vessels without voyage data when the voyage is complete", () => {
    freezeNow("2026-05-14T11:00:00.000Z");

    currentDb = createTestDatabase();
    const db = currentDb.db;
    seedTimestampContractScenario(db);

    db.prepare(`
      UPDATE vessels
      SET latitude = ?,
          longitude = ?,
          last_received = ?,
          destination_name = ?,
          origin_name = ?,
          origin_departed_at = ?
      WHERE mmsi = ?
    `).run(
      58.832021233320255,
      -2.9622400477352535,
      "2026-05-14 10:55:00",
      "St Margaret's Hope",
      "Gills Bay",
      "2026-05-14 10:20:00",
      123456789
    );

    assert.equal(requireService(db, 9100).vessels.length, 1);
    assert.equal(requireService(db, 9100).vessels[0]?.voyage, undefined);
  });

  it("does not expose a voyage when origin and destination resolve to the same terminal", () => {
    freezeNow("2026-05-14T11:00:00.000Z");

    currentDb = createTestDatabase();
    const db = currentDb.db;
    seedTimestampContractScenario(db);

    db.prepare(`
      UPDATE vessels
      SET destination_name = ?,
          origin_name = ?,
          origin_departed_at = ?
      WHERE mmsi = ?
    `).run("Gills Bay", "Gills Bay", "2026-05-14 10:40:00", 123456789);

    assert.equal(requireService(db, 9100).vessels[0]?.voyage, undefined);
  });

  it("keeps a short active voyage visible before the proportional destination radius", () => {
    freezeNow("2026-05-14T11:00:00.000Z");

    currentDb = createTestDatabase();
    const db = currentDb.db;
    seedShortRouteScenario(db);

    const vessel = requireService(db, 9200).vessels[0];
    assert.equal(vessel?.voyage?.originLocation.name, "Short North");
    assert.equal(vessel?.voyage?.destinationLocation.name, "Short South");
  });

  it("shows stale short-route vessels without voyage data", () => {
    freezeNow("2026-05-14T11:00:00.000Z");

    currentDb = createTestDatabase();
    const db = currentDb.db;
    seedShortRouteScenario(db);

    db.prepare(`
      UPDATE vessels
      SET last_received = ?,
          updated = ?
      WHERE mmsi = ?
    `).run("2026-05-14 10:50:00", "2026-05-14 10:50:00", 223456789);

    const vessel = requireService(db, 9200).vessels[0];
    assert.notEqual(vessel, undefined);
    assert.equal(vessel?.voyage, undefined);
  });

  it("does not estimate short-route arrivals from a later scheduled voyage", () => {
    freezeNow("2026-05-14T11:00:00.000Z");

    currentDb = createTestDatabase();
    const db = currentDb.db;
    seedShortRouteScenario(db);

    db.prepare(`
      UPDATE vessels
      SET last_received = ?,
          updated = ?,
          origin_departed_at = ?
      WHERE mmsi = ?
    `).run("2026-05-14 10:58:00", "2026-05-14 10:58:00", "2026-05-14 10:52:00", 223456789);

    const vessel = requireService(db, 9200, "2026-05-14").vessels[0];
    assert.notEqual(vessel?.voyage, undefined);
    assert.equal(vessel?.voyage?.estimatedArrival, undefined);
  });

  it("estimates vessel arrival from inferred departure time and scheduled crossing duration", () => {
    freezeNow("2026-03-16T09:45:00.000Z");

    currentDb = createTestDatabase();
    const db = currentDb.db;
    seedTimestampContractScenario(db);

    db.prepare(`
      UPDATE vessels
      SET latitude = ?,
          longitude = ?,
          last_received = ?,
          destination_name = ?,
          origin_name = ?,
          origin_departed_at = ?
      WHERE mmsi = ?
    `).run(
      58.7,
      -3.0,
      "2026-03-16 09:45:00",
      "St Margaret's Hope",
      "Gills Bay",
      "2026-03-16 09:31:00",
      123456789
    );

    assert.equal(getService(db, 9100, "2026-03-16")?.vessels[0]?.voyage?.estimatedArrival, "2026-03-16T10:41:00.000Z");
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

function seedShortRouteScenario(db: Database.Database): void {
  db.prepare("INSERT INTO organisations (organisation_id, name) VALUES (999, 'Short Route Test') ON CONFLICT DO NOTHING").run();
  db.prepare(`
    INSERT INTO services (service_id, area, route, organisation_id, status, updated)
    VALUES (?, ?, ?, 999, 0, ?)
  `).run(9200, "SHORT AREA", "Short North - Short South", "2026-05-14 10:50:00");
  db.prepare(`
    INSERT INTO locations (location_id, name, latitude, longitude, stop_point_id)
    VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
  `).run(
    9201, "Short North", 0, 0, "9300SHN",
    9202, "Short South", 0, 0.018, "9300SHS"
  );
  db.prepare("INSERT INTO service_locations (service_id, location_id) VALUES (?, ?), (?, ?)").run(9200, 9201, 9200, 9202);
  seedShortRouteTimetable(db);
  db.prepare(`
    INSERT INTO vessels (
      mmsi,
      name,
      latitude,
      longitude,
      last_received,
      updated,
      organisation_id,
      destination_name,
      origin_name,
      origin_departed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    223456789,
    "MV Short Example",
    0,
    0.0135,
    "2026-05-14 10:55:00",
    "2026-05-14 10:55:00",
    999,
    "Short South",
    "Short North",
    "2026-05-14 10:45:00"
  );
}

function seedShortRouteTimetable(db: Database.Database): void {
  const result = db.prepare(`
    INSERT INTO transxchange_documents (
      source_path,
      source_file_name,
      source_version_key,
      source_creation_datetime,
      source_modification_datetime
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(
    "short-route.xml",
    "short-route.xml",
    "short-route",
    "2026-05-14 08:00:00",
    "2026-05-14 08:00:00"
  );
  const documentId = Number(result.lastInsertRowid);

  db.prepare(`
    INSERT INTO transxchange_stop_points (document_id, stop_point_ref, common_name)
    VALUES (?, ?, ?), (?, ?, ?)
  `).run(documentId, "9300SHN", "Short North", documentId, "9300SHS", "Short South");
  db.prepare(`
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
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(documentId, "SHORT_1", "SHORT", "ferry", "Short route", "Short North", "Short South", "2026-01-01", "2026-12-31");
  db.prepare(`
    INSERT INTO transxchange_lines (document_id, line_id, service_code, line_name)
    VALUES (?, ?, ?, ?)
  `).run(documentId, "SHORT_LINE", "SHORT_1", "Short route");
  db.prepare(`
    INSERT INTO transxchange_journey_patterns (document_id, journey_pattern_id, service_code, direction)
    VALUES (?, ?, ?, ?)
  `).run(documentId, "SHORT_PATTERN", "SHORT_1", "outbound");
  db.prepare(`
    INSERT INTO transxchange_journey_pattern_sections (document_id, journey_pattern_id, section_ref, section_order)
    VALUES (?, ?, ?, ?)
  `).run(documentId, "SHORT_PATTERN", "SHORT_SECTION", 1);
  db.prepare(`
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
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(documentId, "SHORT_LINK", "SHORT_SECTION", 1, "9300SHN", "pickUp", "", "9300SHS", "setDown", "", "SHORT_ROUTE_LINK", "outbound", 600, 0);

  const insertJourney = db.prepare(`
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
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertDay = db.prepare(`
    INSERT INTO transxchange_vehicle_journey_days (document_id, vehicle_journey_code, day_rule)
    VALUES (?, ?, ?)
  `);

  for (const [journeyCode, departureTime] of [["SHORT_1040", "10:40:00"], ["SHORT_1055", "10:55:00"]] as const) {
    insertJourney.run(documentId, journeyCode, "SHORT_1", "SHORT_LINE", "SHORT_PATTERN", "SHORT", departureTime, "", "");
    insertDay.run(documentId, journeyCode, "thursday");
  }

  db.prepare("INSERT INTO transxchange_service_mappings (service_id, service_code) VALUES (?, ?)").run(9200, "SHORT_1");
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
  return ["departure", "arrival", "departedAt", "estimatedArrival", "lastReceived", "lastSeenAt", "updated", "lastUpdatedDate"].includes(key);
}

function requireService(db: Database.Database, serviceId: number, date?: string): ServiceResponse {
  const service = getService(db, serviceId, date);
  assert.notEqual(service, null);
  return service as ServiceResponse;
}
