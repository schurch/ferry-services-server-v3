import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type Database from "better-sqlite3";
import { getService, listServices } from "../src/db/api.js";
import { ingestTransxchangeDirectory } from "../src/jobs/transxchange-ingester.js";
import type { DepartureResponse, LocationResponse, ServiceResponse } from "../src/types/api.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

type Scenario = {
  fixtureDir: string;
  queryDate: string;
  seed: ScenarioSeed;
};

type ScenarioSeed = {
  serviceId: number;
  area: string;
  route: string;
  serviceCode: string;
  locations: ScenarioLocation[];
};

type ScenarioLocation = {
  id: number;
  name: string;
  stopPointId: string;
  latitude: number;
  longitude: number;
};

let currentDb: TestDatabase | null = null;

afterEach(() => {
  currentDb?.cleanup();
  currentDb = null;
});

describe("TransXChange API departure data", () => {
  it("returns exact departures for a basic mapped real ferry service", () => {
    const db = setupScenario(basicPentlandScenario);
    const service = requireService(db, basicPentlandScenario.seed.serviceId, basicPentlandScenario.queryDate);
    const gillsBay = findLocation(service, 9101);
    const stMargaretsHope = findLocation(service, 9102);

    assert.equal(service.scheduledDeparturesAvailable, true);
    assert.deepEqual(departureTimes(gillsBay), [
      "2026-03-16T09:30:00.000Z",
      "2026-03-16T13:30:00.000Z",
      "2026-03-16T18:45:00.000Z"
    ]);
    assert.deepEqual(arrivalTimes(gillsBay), [
      "2026-03-16T10:40:00.000Z",
      "2026-03-16T14:40:00.000Z",
      "2026-03-16T19:55:00.000Z"
    ]);
    assert.deepEqual(destinationIds(gillsBay), [9102, 9102, 9102]);
    assert.deepEqual(departureTimes(stMargaretsHope), [
      "2026-03-16T07:45:00.000Z",
      "2026-03-16T11:30:00.000Z",
      "2026-03-16T17:00:00.000Z"
    ]);
    assert.deepEqual(arrivalTimes(stMargaretsHope), [
      "2026-03-16T08:55:00.000Z",
      "2026-03-16T12:40:00.000Z",
      "2026-03-16T18:10:00.000Z"
    ]);
    assert.deepEqual(destinationIds(stMargaretsHope), [9101, 9101, 9101]);
  });

  it("applies real non-operation and bank-holiday rules", () => {
    const nonOperationDb = setupScenario(nonOperationScenario);
    assert.deepEqual(departureCounts(requireService(nonOperationDb, 9300, "2026-05-22")), [30, 30]);

    currentDb?.cleanup();
    currentDb = null;

    const bankHolidayDb = setupScenario(bankHolidayScenario);
    assert.deepEqual(departureCounts(requireService(bankHolidayDb, 9400, "2026-05-04")), [28, 28]);
  });

  it("chooses the correct file when two TransXChange files cover adjacent dates", () => {
    const db = setupScenario(multiFileScenario);
    const saturday = requireService(db, 9700, "2026-03-14");
    const sunday = requireService(db, 9700, "2026-03-15");

    assert.deepEqual(departureTimes(findLocation(saturday, 9701)), [
      "2026-03-14T07:15:00.000Z",
      "2026-03-14T09:15:00.000Z",
      "2026-03-14T11:10:00.000Z",
      "2026-03-14T15:40:00.000Z",
      "2026-03-14T17:20:00.000Z"
    ]);
    assert.deepEqual(departureTimes(findLocation(saturday, 9702)), [
      "2026-03-14T08:10:00.000Z",
      "2026-03-14T10:10:00.000Z",
      "2026-03-14T13:00:00.000Z",
      "2026-03-14T16:30:00.000Z",
      "2026-03-14T18:15:00.000Z"
    ]);
    assert.deepEqual(departureTimes(findLocation(sunday, 9701)), [
      "2026-03-15T08:45:00.000Z",
      "2026-03-15T16:30:00.000Z"
    ]);
    assert.deepEqual(departureTimes(findLocation(sunday, 9702)), [
      "2026-03-15T09:30:00.000Z",
      "2026-03-15T17:20:00.000Z"
    ]);
    assert.deepEqual(notes(findLocation(sunday, 9701)), [
      "Passengers should check-in 10 mins before ferry departure time shown | Book by 1400 on day before travel.",
      "Passengers should check-in 10 mins before ferry departure time shown"
    ]);
  });

  it("does not advertise departures when a mapping has no visible legs between app locations", () => {
    const db = setupScenario(mappedServiceWithNoVisibleLegScenario);
    const detail = requireService(db, 9600, "2026-03-16");
    const listed = listServices(db).find((service) => service.serviceId === 9600);

    assert.equal(detail.scheduledDeparturesAvailable, false);
    assert.equal(listed?.scheduledDeparturesAvailable, false);
    assert.deepEqual(departureCounts(detail), [0, 0]);
  });
});

function setupScenario(scenario: Scenario): Database.Database {
  currentDb = createTestDatabase();
  seedScenario(currentDb.db, scenario.seed);
  ingestTransxchangeDirectory(currentDb.db, scenario.fixtureDir);
  return currentDb.db;
}

function seedScenario(db: Database.Database, seed: ScenarioSeed): void {
  const locationIds = seed.locations.map((location) => location.id);
  const stopPointIds = seed.locations.map((location) => location.stopPointId);

  db.prepare("INSERT INTO organisations (organisation_id, name) VALUES (999, 'TX API Test') ON CONFLICT DO NOTHING").run();
  db.prepare(`DELETE FROM transxchange_service_mappings WHERE service_id = ?`).run(seed.serviceId);
  db.prepare(`DELETE FROM service_locations WHERE service_id = ?`).run(seed.serviceId);
  for (const locationId of locationIds) {
    db.prepare(`DELETE FROM service_locations WHERE location_id = ?`).run(locationId);
  }
  for (const stopPointId of stopPointIds) {
    db.prepare(`DELETE FROM service_locations WHERE location_id IN (SELECT location_id FROM locations WHERE stop_point_id = ?)`).run(stopPointId);
    db.prepare(`DELETE FROM locations WHERE stop_point_id = ?`).run(stopPointId);
  }
  db.prepare(`DELETE FROM services WHERE service_id = ?`).run(seed.serviceId);

  db.prepare(`
    INSERT INTO services (service_id, area, route, organisation_id, status, updated)
    VALUES (?, ?, ?, 999, -99, CURRENT_TIMESTAMP)
  `).run(seed.serviceId, seed.area, seed.route);
  for (const location of seed.locations) {
    db.prepare(`
      INSERT INTO locations (location_id, name, latitude, longitude, stop_point_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(location.id, location.name, location.latitude, location.longitude, location.stopPointId);
    db.prepare(`
      INSERT INTO service_locations (service_id, location_id)
      VALUES (?, ?)
    `).run(seed.serviceId, location.id);
  }
  db.prepare(`
    INSERT INTO transxchange_service_mappings (service_id, service_code)
    VALUES (?, ?)
  `).run(seed.serviceId, seed.serviceCode);
}

function requireService(db: Database.Database, serviceId: number, date: string): ServiceResponse {
  const service = getService(db, serviceId, date);
  assert.notEqual(service, null);
  return service as ServiceResponse;
}

function findLocation(service: ServiceResponse, locationId: number): LocationResponse {
  const location = service.locations.find((item) => item.id === locationId);
  assert.notEqual(location, undefined);
  return location as LocationResponse;
}

function departures(location: LocationResponse): DepartureResponse[] {
  return location.scheduledDepartures ?? [];
}

function departureTimes(location: LocationResponse): string[] {
  return departures(location).map((departure) => departure.departure);
}

function arrivalTimes(location: LocationResponse): string[] {
  return departures(location).map((departure) => departure.arrival);
}

function destinationIds(location: LocationResponse): number[] {
  return departures(location).map((departure) => departure.destination.id);
}

function notes(location: LocationResponse): Array<string | null | undefined> {
  return departures(location).map((departure) => departure.notes);
}

function departureCounts(service: ServiceResponse): number[] {
  return service.locations.map((location) => location.scheduledDepartures?.length ?? 0);
}

const basicPentlandScenario: Scenario = {
  fixtureDir: "test/fixtures/transxchange-api/01-basic-real",
  queryDate: "2026-03-16",
  seed: {
    serviceId: 9100,
    area: "PENTLAND FIRTH",
    route: "Gills Bay - St Margaret's Hope",
    serviceCode: "PENT_PF1",
    locations: [
      { id: 9101, name: "Gills Bay", stopPointId: "9300GIL", latitude: 58.63917534851306, longitude: -3.1614340648459605 },
      { id: 9102, name: "St Margaret's Hope", stopPointId: "9300SMH", latitude: 58.832021233320255, longitude: -2.9622400477352535 }
    ]
  }
};

const nonOperationScenario: Scenario = {
  fixtureDir: "test/fixtures/transxchange-api/03-non-operation-real",
  queryDate: "2026-05-22",
  seed: {
    serviceId: 9300,
    area: "ARGYLL",
    route: "North Cuan Seil - South Cuan Luing",
    serviceCode: "ABCF_LUI",
    locations: [
      { id: 9301, name: "North Cuan Seil", stopPointId: "9300CUN", latitude: 56.2473, longitude: -5.6288 },
      { id: 9302, name: "South Cuan Luing", stopPointId: "9300LUI", latitude: 56.2456, longitude: -5.6296 }
    ]
  }
};

const bankHolidayScenario: Scenario = {
  fixtureDir: "test/fixtures/transxchange-api/04-bank-holiday-real",
  queryDate: "2026-05-04",
  seed: {
    serviceId: 9400,
    area: "ARGYLL",
    route: "North Cuan Seil - South Cuan Luing",
    serviceCode: "ABCF_LUI",
    locations: [
      { id: 9401, name: "North Cuan Seil", stopPointId: "9300CUN", latitude: 56.2473, longitude: -5.6288 },
      { id: 9402, name: "South Cuan Luing", stopPointId: "9300LUI", latitude: 56.2456, longitude: -5.6296 }
    ]
  }
};

const multiFileScenario: Scenario = {
  fixtureDir: "test/fixtures/transxchange-api/07-multi-file-same-service-real",
  queryDate: "2026-03-14",
  seed: {
    serviceId: 9700,
    area: "OUTER HEBRIDES",
    route: "Barra - Eriskay",
    serviceCode: "CALM_CM21",
    locations: [
      { id: 9701, name: "Aird Mhor Barra", stopPointId: "9300AHB", latitude: 57.0155, longitude: -7.4429 },
      { id: 9702, name: "Eriskay", stopPointId: "9300ERI", latitude: 57.0822, longitude: -7.2958 }
    ]
  }
};

const mappedServiceWithNoVisibleLegScenario: Scenario = {
  fixtureDir: "test/fixtures/transxchange-api/01-basic-real",
  queryDate: "2026-03-16",
  seed: {
    serviceId: 9600,
    area: "PENTLAND FIRTH",
    route: "Mapped service with unmatched stops",
    serviceCode: "PENT_PF1",
    locations: [
      { id: 9601, name: "Unmatched Origin", stopPointId: "9300UNMATCHED1", latitude: 58.0, longitude: -3.0 },
      { id: 9602, name: "Unmatched Destination", stopPointId: "9300UNMATCHED2", latitude: 58.1, longitude: -3.1 }
    ]
  }
};
