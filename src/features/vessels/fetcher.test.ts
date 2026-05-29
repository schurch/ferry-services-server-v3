import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { saveVessel } from "../service-status/repository.js";
import { enrichVoyage } from "./fetcher.js";
import type { VesselPosition } from "../../shared/fetcher-types.js";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers.js";

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

  it("does not carry stale arrival metadata into a newly detected voyage", () => {
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
      originName: "Ardrossan"
    }));

    assert.deepEqual(enrichVoyage(db, terminals, 1, {
      mmsi: 123456789,
      latitude: 55.61,
      longitude: -4.95,
      receivedAt: "2026-05-24 08:48:08"
    }), {
      destinationName: "Brodick",
      originName: "Ardrossan",
      originDepartedAt: "2026-05-24 08:48:08"
    });
  });

  it("uses reported destination for a newly detected voyage", () => {
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
      originName: "Ardrossan"
    }));

    assert.deepEqual(enrichVoyage(db, terminals, 1, {
      mmsi: 123456789,
      latitude: 55.61,
      longitude: -4.95,
      destinationName: "Brodick",
      receivedAt: "2026-05-24 08:48:08"
    }), {
      destinationName: "Brodick",
      originName: "Ardrossan",
      originDepartedAt: "2026-05-24 08:48:08"
    });
  });

  it("uses the route-derived destination when the reported destination is not a known terminal", () => {
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
      destinationName: "Not Available",
      originName: "Ardrossan"
    }));

    assert.deepEqual(enrichVoyage(db, terminals, 1, {
      mmsi: 123456789,
      latitude: 55.61,
      longitude: -4.95,
      destinationName: "Not Available",
      receivedAt: "2026-05-24 08:48:08"
    }), {
      destinationName: "Brodick",
      originName: "Ardrossan",
      originDepartedAt: "2026-05-24 08:48:08"
    });
  });

  it("does not derive a destination when a shared origin has multiple plausible services", () => {
    currentDb = createTestDatabase();
    const db = currentDb.db;
    const terminals = [
      { organisationId: 1, serviceId: 5, name: "Ardrossan", latitude: 55.640516, longitude: -4.823062 },
      { organisationId: 1, serviceId: 5, name: "Brodick", latitude: 55.576606, longitude: -5.139172 },
      { organisationId: 1, serviceId: 36, name: "Ardrossan", latitude: 55.640516, longitude: -4.823062 },
      { organisationId: 1, serviceId: 36, name: "Campbeltown", latitude: 55.424, longitude: -5.607 }
    ];

    saveVessel(db, vesselPosition({
      latitude: 55.640516,
      longitude: -4.823062,
      lastReceived: "2026-05-24 08:40:00",
      destinationName: "Not Available",
      originName: "Ardrossan"
    }));

    assert.deepEqual(enrichVoyage(db, terminals, 1, {
      mmsi: 123456789,
      latitude: 55.61,
      longitude: -4.95,
      destinationName: "Not Available",
      receivedAt: "2026-05-24 08:48:08"
    }), {
      destinationName: undefined,
      originName: "Ardrossan",
      originDepartedAt: "2026-05-24 08:48:08"
    });
  });

  it("uses a reported destination to disambiguate a shared origin", () => {
    currentDb = createTestDatabase();
    const db = currentDb.db;
    const terminals = [
      { organisationId: 1, serviceId: 5, name: "Ardrossan", latitude: 55.640516, longitude: -4.823062 },
      { organisationId: 1, serviceId: 5, name: "Brodick", latitude: 55.576606, longitude: -5.139172 },
      { organisationId: 1, serviceId: 36, name: "Ardrossan", latitude: 55.640516, longitude: -4.823062 },
      { organisationId: 1, serviceId: 36, name: "Campbeltown", latitude: 55.424, longitude: -5.607 }
    ];

    saveVessel(db, vesselPosition({
      latitude: 55.640516,
      longitude: -4.823062,
      lastReceived: "2026-05-24 08:40:00",
      destinationName: "Not Available",
      originName: "Ardrossan"
    }));

    assert.deepEqual(enrichVoyage(db, terminals, 1, {
      mmsi: 123456789,
      latitude: 55.61,
      longitude: -4.95,
      destinationName: "BRODICK",
      receivedAt: "2026-05-24 08:48:08"
    }), {
      destinationName: "Brodick",
      originName: "Ardrossan",
      originDepartedAt: "2026-05-24 08:48:08"
    });
  });

  it("uses a composite reported destination to disambiguate a shared origin", () => {
    currentDb = createTestDatabase();
    const db = currentDb.db;
    const terminals = [
      { organisationId: 1, serviceId: 5, name: "Ardrossan", latitude: 55.640516, longitude: -4.823062 },
      { organisationId: 1, serviceId: 5, name: "Brodick", latitude: 55.576606, longitude: -5.139172 },
      { organisationId: 1, serviceId: 36, name: "Ardrossan", latitude: 55.640516, longitude: -4.823062 },
      { organisationId: 1, serviceId: 36, name: "Campbeltown", latitude: 55.424, longitude: -5.607 }
    ];

    saveVessel(db, vesselPosition({
      latitude: 55.640516,
      longitude: -4.823062,
      lastReceived: "2026-05-24 08:40:00",
      destinationName: "Not Available",
      originName: "Ardrossan"
    }));

    assert.deepEqual(enrichVoyage(db, terminals, 1, {
      mmsi: 123456789,
      latitude: 55.61,
      longitude: -4.95,
      destinationName: "ARDROSSAN BRODICK",
      receivedAt: "2026-05-24 08:48:08"
    }), {
      destinationName: "Brodick",
      originName: "Ardrossan",
      originDepartedAt: "2026-05-24 08:48:08"
    });
  });

  it("matches shortened MarineTraffic destination tokens on the origin route", () => {
    currentDb = createTestDatabase();
    const db = currentDb.db;
    const terminals = [
      { organisationId: 3, serviceId: 2000, name: "McInroy's Point", latitude: 55.958, longitude: -4.83 },
      { organisationId: 3, serviceId: 2000, name: "Hunters Quay", latitude: 55.970, longitude: -4.90 }
    ];

    saveVessel(db, vesselPosition({
      latitude: 55.970,
      longitude: -4.90,
      lastReceived: "2026-05-24 08:40:00",
      destinationName: "Not Available",
      originName: "Hunters Quay",
      organisationId: 3
    }));

    assert.deepEqual(enrichVoyage(db, terminals, 3, {
      mmsi: 123456789,
      latitude: 55.965,
      longitude: -4.86,
      destinationName: "HUNTERS QY/MCINROYS",
      receivedAt: "2026-05-24 08:48:08"
    }), {
      destinationName: "McInroy's Point",
      originName: "Hunters Quay",
      originDepartedAt: "2026-05-24 08:48:08"
    });
  });

  it("does not pair an origin with a reported destination from another route", () => {
    currentDb = createTestDatabase();
    const db = currentDb.db;
    const terminals = [
      { organisationId: 1, serviceId: 5, name: "Ardrossan", latitude: 55.640516, longitude: -4.823062 },
      { organisationId: 1, serviceId: 5, name: "Brodick", latitude: 55.576606, longitude: -5.139172 },
      { organisationId: 1, serviceId: 39, name: "Gourock", latitude: 55.959938, longitude: -4.814372 },
      { organisationId: 1, serviceId: 39, name: "Kilcreggan", latitude: 55.984704635223416, longitude: -4.820426740646081 }
    ];

    saveVessel(db, vesselPosition({
      latitude: 55.640516,
      longitude: -4.823062,
      lastReceived: "2026-05-24 08:40:00",
      destinationName: "Brodick",
      originName: "Ardrossan"
    }));

    assert.deepEqual(enrichVoyage(db, terminals, 1, {
      mmsi: 123456789,
      latitude: 55.61,
      longitude: -4.95,
      destinationName: "Kilcreggan",
      receivedAt: "2026-05-24 08:48:08"
    }), {
      destinationName: "Brodick",
      originName: "Ardrossan",
      originDepartedAt: "2026-05-24 08:48:08"
    });
  });

  it("canonicalises reported destinations to known terminal names", () => {
    currentDb = createTestDatabase();
    const db = currentDb.db;
    const terminals = [
      { organisationId: 1, serviceId: 5, name: "Ardrossan", latitude: 55.640516, longitude: -4.823062 },
      { organisationId: 1, serviceId: 5, name: "Brodick", latitude: 55.576606, longitude: -5.139172 }
    ];

    assert.deepEqual(enrichVoyage(db, terminals, 1, {
      mmsi: 123456789,
      latitude: 55.640516,
      longitude: -4.823062,
      destinationName: "BRODICK",
      receivedAt: "2026-05-24 08:40:00"
    }), {
      destinationName: "Brodick",
      originName: "Ardrossan"
    });
  });

  it("does not carry stale voyage metadata while a vessel is at a terminal", () => {
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
      originName: "Ardrossan"
    }));

    assert.deepEqual(enrichVoyage(db, terminals, 1, {
      mmsi: 123456789,
      latitude: 55.640516,
      longitude: -4.823062,
      receivedAt: "2026-05-24 08:48:08"
    }), {
      destinationName: "Brodick",
      originName: "Ardrossan"
    });
  });

  it("does not use the current terminal as its own destination", () => {
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
      destinationName: "Ardrossan",
      originName: "Ardrossan"
    }));

    assert.deepEqual(enrichVoyage(db, terminals, 1, {
      mmsi: 123456789,
      latitude: 55.640516,
      longitude: -4.823062,
      destinationName: "ARDROSSAN",
      receivedAt: "2026-05-24 08:48:08"
    }), {
      destinationName: undefined,
      originName: "Ardrossan"
    });
  });

  it("replaces a carried same-origin destination with the route-derived destination", () => {
    currentDb = createTestDatabase();
    const db = currentDb.db;
    const terminals = [
      { organisationId: 1, serviceId: 5, name: "Ardrossan", latitude: 55.640516, longitude: -4.823062 },
      { organisationId: 1, serviceId: 5, name: "Brodick", latitude: 55.576606, longitude: -5.139172 }
    ];

    saveVessel(db, vesselPosition({
      latitude: 55.61,
      longitude: -4.95,
      lastReceived: "2026-05-24 08:40:00",
      destinationName: "Ardrossan",
      originName: "Ardrossan",
      originDepartedAt: "2026-05-24 08:35:00"
    }));

    assert.deepEqual(enrichVoyage(db, terminals, 1, {
      mmsi: 123456789,
      latitude: 55.60,
      longitude: -5.0,
      receivedAt: "2026-05-24 08:48:08"
    }), {
      destinationName: "Brodick",
      originName: "Ardrossan",
      originDepartedAt: "2026-05-24 08:35:00"
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
