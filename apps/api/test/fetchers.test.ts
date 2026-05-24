import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { saveVessel } from "../src/db/fetchers.js";
import { enrichVoyage } from "../src/jobs/vessel-fetcher.js";
import type { VesselPosition } from "../src/types/fetchers.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

let currentDb: TestDatabase | null = null;

afterEach(() => {
  currentDb?.cleanup();
  currentDb = null;
});

describe("vessel persistence", () => {
  it("keeps the freshest vessel position for a MMSI", () => {
    currentDb = createTestDatabase();
    const db = currentDb.db;

    saveVessel(db, vesselPosition({
      name: "Fresh Position",
      latitude: 56.1,
      longitude: -5.1,
      lastReceived: "2026-05-24 10:10:00",
      destinationName: "Fresh Destination"
    }));

    saveVessel(db, vesselPosition({
      name: "Older Position",
      latitude: 57.2,
      longitude: -4.2,
      lastReceived: "2026-05-24 10:05:00",
      destinationName: "Older Destination"
    }));

    assert.deepEqual(vesselRow(db), {
      name: "Fresh Position",
      latitude: 56.1,
      longitude: -5.1,
      last_received: "2026-05-24 10:10:00",
      destination_name: "Fresh Destination"
    });

    saveVessel(db, vesselPosition({
      name: "Newer Position",
      latitude: 58.3,
      longitude: -3.3,
      lastReceived: "2026-05-24 10:15:00",
      destinationName: "Newer Destination"
    }));

    assert.deepEqual(vesselRow(db), {
      name: "Newer Position",
      latitude: 58.3,
      longitude: -3.3,
      last_received: "2026-05-24 10:15:00",
      destination_name: "Newer Destination"
    });
  });

  it("does not carry a stale ETA into a newly detected voyage", () => {
    currentDb = createTestDatabase();
    const db = currentDb.db;
    const terminals = [
      { organisationId: 1, serviceId: 5, name: "Ardrossan", latitude: 55.640516, longitude: -4.823062 },
      { organisationId: 1, serviceId: 5, name: "Brodick", latitude: 55.576606, longitude: -5.139172 }
    ];

    saveVessel(db, vesselPosition({
      latitude: 55.640516,
      longitude: -4.823062,
      lastReceived: "2026-05-24 08:40:00",
      destinationName: "Brodick",
      eta: "2026-05-23 20:30:00",
      originName: "Ardrossan"
    }));

    assert.deepEqual(enrichVoyage(db, terminals, 1, {
      mmsi: 123456789,
      latitude: 55.61,
      longitude: -4.95,
      receivedAt: "2026-05-24 08:48:08"
    }), {
      destinationName: "Brodick",
      eta: undefined,
      originName: "Ardrossan",
      originDepartedAt: "2026-05-24 08:48:08"
    });
  });

  it("keeps a valid ETA when a newly detected voyage has one", () => {
    currentDb = createTestDatabase();
    const db = currentDb.db;
    const terminals = [
      { organisationId: 1, serviceId: 5, name: "Ardrossan", latitude: 55.640516, longitude: -4.823062 },
      { organisationId: 1, serviceId: 5, name: "Brodick", latitude: 55.576606, longitude: -5.139172 }
    ];

    saveVessel(db, vesselPosition({
      latitude: 55.640516,
      longitude: -4.823062,
      lastReceived: "2026-05-24 08:40:00",
      destinationName: "Brodick",
      eta: "2026-05-23 20:30:00",
      originName: "Ardrossan"
    }));

    assert.deepEqual(enrichVoyage(db, terminals, 1, {
      mmsi: 123456789,
      latitude: 55.61,
      longitude: -4.95,
      destinationName: "Brodick",
      eta: "2026-05-24 09:35:00",
      receivedAt: "2026-05-24 08:48:08"
    }), {
      destinationName: "Brodick",
      eta: "2026-05-24 09:35:00",
      originName: "Ardrossan",
      originDepartedAt: "2026-05-24 08:48:08"
    });
  });
});

function vesselPosition(overrides: Partial<VesselPosition>): VesselPosition {
  return {
    mmsi: 123456789,
    name: "Test Vessel",
    speed: 12.3,
    course: 180,
    latitude: 56,
    longitude: -5,
    lastReceived: "2026-05-24 10:00:00",
    organisationId: 1,
    ...overrides
  };
}

function vesselRow(db: TestDatabase["db"]): Record<string, unknown> | undefined {
  return db.prepare(`
    SELECT name, latitude, longitude, last_received, destination_name
    FROM vessels
    WHERE mmsi = ?
  `).get(123456789) as Record<string, unknown> | undefined;
}
