import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type SourceDatabase from "better-sqlite3";
import { logger } from "../logger.js";
import { londonLocalTimestampResponse, listLocationDepartureRows, listServicesWithScheduledDepartures } from "../api/db.js";
import type {
  LocationRow,
  OfflineDeparture,
  OfflineSnapshot,
  OrganisationRow,
  ServiceLocationRow,
  ServiceRow
} from "./types.js";

export function readServices(db: SourceDatabase.Database): ServiceRow[] {
  return db.prepare(`
    SELECT service_id, area, route, organisation_id
    FROM services
    WHERE visible = 1
    ORDER BY service_id
  `).all() as ServiceRow[];
}

export function readLocations(db: SourceDatabase.Database): LocationRow[] {
  return db.prepare(`
    SELECT location_id, name, latitude, longitude
    FROM locations
    ORDER BY location_id
  `).all() as LocationRow[];
}

export function readOrganisations(db: SourceDatabase.Database, services: ServiceRow[]): OrganisationRow[] {
  const organisationIds = [...new Set(services.map((service) => service.organisation_id))];
  if (organisationIds.length === 0) {
    return [];
  }

  return db.prepare(`
    SELECT organisation_id, name, website, local_phone, international_phone, email, x, facebook
    FROM organisations
    WHERE organisation_id IN (${organisationIds.map(() => "?").join(", ")})
    ORDER BY organisation_id
  `).all(...organisationIds) as OrganisationRow[];
}

export function readServiceLocations(db: SourceDatabase.Database, services: ServiceRow[]): ServiceLocationRow[] {
  const serviceIds = new Set(services.map((service) => service.service_id));
  const rows = db.prepare(`
    SELECT service_id, location_id
    FROM service_locations
    ORDER BY service_id, location_id
  `).all() as Array<{ service_id: number; location_id: number }>;

  const grouped = new Map<number, number[]>();
  for (const row of rows) {
    if (!serviceIds.has(row.service_id)) {
      continue;
    }
    grouped.set(row.service_id, [...(grouped.get(row.service_id) ?? []), row.location_id]);
  }

  return [...grouped.entries()].flatMap(([serviceId, locationIds]) =>
    locationIds.map((locationId, displayOrder) => ({
      service_id: serviceId,
      location_id: locationId,
      display_order: displayOrder
    }))
  );
}

export function readDepartures(
  db: SourceDatabase.Database,
  services: ServiceRow[],
  validFrom: string,
  validTo: string
): OfflineDeparture[] {
  const servicesWithDepartures = listServicesWithScheduledDepartures(db);
  const serviceIds = services.map((service) => service.service_id).filter((serviceId) => servicesWithDepartures.has(serviceId));
  const days = dateRange(validFrom, validTo);
  const departures: OfflineDeparture[] = [];

  logger.info({ serviceCount: serviceIds.length, dayCount: days.length }, "Offline snapshot departure generation started");
  serviceIds.forEach((serviceId, index) => {
    if (index === 0 || index === serviceIds.length - 1 || (index + 1) % 5 === 0) {
      logger.info({ processedCount: index + 1, serviceCount: serviceIds.length, serviceId }, "Offline snapshot departure progress");
    }

    let serviceDepartureCount = 0;
    for (const day of days) {
      const rows = listLocationDepartureRows(db, serviceId, day);
      serviceDepartureCount += rows.length;
      departures.push(...rows.map((row) => ({
        service_id: serviceId,
        service_date: day,
        from_location_id: row.from_location_id,
        to_location_id: row.to_location_id,
        departure_time_utc: utcSeconds(londonLocalTimestampResponse(row.departure)),
        arrival_time_utc: utcSeconds(londonLocalTimestampResponse(row.arrival)),
        notes: row.notes
      })));
    }
    logger.info({ serviceId, departureCount: serviceDepartureCount }, "Offline snapshot departures generated for service");
  });

  return departures;
}

export function writeSnapshotDatabase(snapshotPath: string, snapshot: OfflineSnapshot): void {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const tempPath = `${snapshotPath}.tmp`;
  removeIfExists(tempPath);
  removeIfExists(`${tempPath}-wal`);
  removeIfExists(`${tempPath}-shm`);

  const db = new Database(tempPath);
  try {
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = DELETE");
    db.pragma("synchronous = OFF");
    createSnapshotSchema(db);
    const insertMetadata = db.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)");
    const insertOrganisation = db.prepare("INSERT INTO organisations (organisation_id, name, website, local_number, international_number, email, x, facebook) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const insertService = db.prepare("INSERT INTO services (service_id, area, route, organisation_id, scheduled_departures_available) VALUES (?, ?, ?, ?, ?)");
    const insertLocation = db.prepare("INSERT INTO locations (location_id, name, latitude, longitude) VALUES (?, ?, ?, ?)");
    const insertServiceLocation = db.prepare("INSERT INTO service_locations (service_id, location_id, display_order) VALUES (?, ?, ?)");
    const insertDeparture = db.prepare("INSERT INTO departures (service_id, service_date, from_location_id, to_location_id, departure_time_utc, arrival_time_utc, notes) VALUES (?, ?, ?, ?, ?, ?, ?)");

    db.transaction(() => {
      for (const [key, value] of [
        ["schema_version", String(snapshot.schemaVersion)],
        ["data_version", snapshot.dataVersion],
        ["generated_at_utc", utcSeconds(snapshot.generatedAt)],
        ["valid_from", snapshot.validFrom],
        ["valid_to", snapshot.validTo]
      ]) {
        insertMetadata.run(key, value);
      }
      for (const organisation of snapshot.organisations) {
        insertOrganisation.run(
          organisation.organisation_id,
          organisation.name,
          organisation.website,
          organisation.local_phone,
          organisation.international_phone,
          organisation.email,
          organisation.x,
          organisation.facebook
        );
      }
      for (const service of snapshot.services) {
        insertService.run(service.service_id, service.area, service.route, service.organisation_id, service.scheduled_departures_available);
      }
      for (const location of snapshot.locations) {
        insertLocation.run(location.location_id, location.name, location.latitude, location.longitude);
      }
      for (const serviceLocation of snapshot.serviceLocations) {
        insertServiceLocation.run(serviceLocation.service_id, serviceLocation.location_id, serviceLocation.display_order);
      }
      for (const departure of snapshot.departures) {
        insertDeparture.run(
          departure.service_id,
          departure.service_date,
          departure.from_location_id,
          departure.to_location_id,
          departure.departure_time_utc,
          departure.arrival_time_utc,
          departure.notes
        );
      }
    })();
  } finally {
    db.close();
  }

  fs.renameSync(tempPath, snapshotPath);
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateString(date);
}

function dateRange(validFrom: string, validTo: string): string[] {
  const days: string[] = [];
  for (let day = validFrom; day <= validTo; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

function utcSeconds(timestamp: string): string {
  return timestamp.replace(/\.\d{3}Z$/, "Z");
}

function removeIfExists(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath);
  }
}

function createSnapshotSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE organisations (
      organisation_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      website TEXT NULL,
      local_number TEXT NULL,
      international_number TEXT NULL,
      email TEXT NULL,
      x TEXT NULL,
      facebook TEXT NULL
    );

    CREATE TABLE services (
      service_id INTEGER PRIMARY KEY,
      area TEXT NOT NULL,
      route TEXT NOT NULL,
      organisation_id INTEGER NOT NULL REFERENCES organisations (organisation_id),
      scheduled_departures_available INTEGER NOT NULL
    );

    CREATE TABLE locations (
      location_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL
    );

    CREATE TABLE service_locations (
      service_id INTEGER NOT NULL REFERENCES services (service_id),
      location_id INTEGER NOT NULL REFERENCES locations (location_id),
      display_order INTEGER NOT NULL,
      PRIMARY KEY (service_id, location_id)
    );

    CREATE TABLE departures (
      service_id INTEGER NOT NULL REFERENCES services (service_id),
      service_date TEXT NOT NULL,
      from_location_id INTEGER NOT NULL REFERENCES locations (location_id),
      to_location_id INTEGER NOT NULL REFERENCES locations (location_id),
      departure_time_utc TEXT NOT NULL,
      arrival_time_utc TEXT NOT NULL,
      notes TEXT NULL
    );

    CREATE INDEX departures_service_date_idx
    ON departures (service_id, service_date, departure_time_utc);

    CREATE VIEW client_services AS
    SELECT
      s.service_id,
      s.area,
      s.route,
      s.organisation_id,
      o.name AS organisation_name,
      s.scheduled_departures_available
    FROM services s
    JOIN organisations o ON o.organisation_id = s.organisation_id;

    CREATE VIEW client_service_locations AS
    SELECT
      sl.service_id,
      sl.location_id,
      l.name,
      l.latitude,
      l.longitude,
      sl.display_order
    FROM service_locations sl
    JOIN locations l ON l.location_id = sl.location_id;

    CREATE VIEW client_departures AS
    SELECT
      d.service_id,
      d.service_date,
      d.from_location_id,
      from_location.name AS from_location_name,
      d.to_location_id,
      to_location.name AS to_location_name,
      d.departure_time_utc,
      d.arrival_time_utc,
      d.notes
    FROM departures d
    JOIN locations from_location ON from_location.location_id = d.from_location_id
    JOIN locations to_location ON to_location.location_id = d.to_location_id;
  `);
}
