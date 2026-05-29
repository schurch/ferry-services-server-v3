import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type Database from "better-sqlite3";
import { getService, listServices } from "../services/read-model.js";
import type { ServiceResponse } from "../services/types.js";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers.js";

let currentDb: TestDatabase | null = null;
const RealDate = Date;

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

function requireService(db: Database.Database, serviceId: number): ServiceResponse {
  const service = getService(db, serviceId);
  assert.notEqual(service, null);
  return service as ServiceResponse;
}
