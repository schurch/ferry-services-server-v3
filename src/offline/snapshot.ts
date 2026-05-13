import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type SourceDatabase from "better-sqlite3";
import { londonLocalTimestampResponse, listLocationDepartureRows, listServicesWithScheduledDepartures } from "../db/api.js";

export const defaultSnapshotPath = "offline/snapshot.sqlite3";
export const defaultSnapshotMetadataPath = "offline/snapshot.meta.json";

type ServiceRow = {
  service_id: number;
  area: string;
  route: string;
  organisation_id: number;
};

type LocationRow = {
  location_id: number;
  name: string;
  latitude: number;
  longitude: number;
};

type OrganisationRow = {
  organisation_id: number;
  name: string;
  website: string | null;
  local_phone: string | null;
  international_phone: string | null;
  email: string | null;
  x: string | null;
  facebook: string | null;
};

type ServiceLocationRow = {
  service_id: number;
  location_id: number;
  display_order: number;
};

type OfflineDeparture = {
  service_id: number;
  service_date: string;
  from_location_id: number;
  to_location_id: number;
  departure_time_utc: string;
  arrival_time_utc: string;
  notes: string | null;
};

export type OfflineSnapshotMetadata = {
  data_version: string;
  etag: string;
  generated_at: string;
  valid_from: string;
  valid_to: string;
};

type OfflineSnapshot = {
  schemaVersion: number;
  dataVersion: string;
  generatedAt: string;
  validFrom: string;
  validTo: string;
  services: Array<ServiceRow & { scheduled_departures_available: number }>;
  locations: LocationRow[];
  organisations: OrganisationRow[];
  serviceLocations: ServiceLocationRow[];
  departures: OfflineDeparture[];
};

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

function hashJson(value: unknown): string {
  return `sha256-${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function quotedEtag(value: string): string {
  return `"${value}"`;
}

function utcSeconds(timestamp: string): string {
  return timestamp.replace(/\.\d{3}Z$/, "Z");
}

function readServices(db: SourceDatabase.Database): ServiceRow[] {
  return db.prepare(`
    SELECT service_id, area, route, organisation_id
    FROM services
    WHERE visible = 1
    ORDER BY service_id
  `).all() as ServiceRow[];
}

function readLocations(db: SourceDatabase.Database): LocationRow[] {
  return db.prepare(`
    SELECT location_id, name, latitude, longitude
    FROM locations
    ORDER BY location_id
  `).all() as LocationRow[];
}

function readOrganisations(db: SourceDatabase.Database, services: ServiceRow[]): OrganisationRow[] {
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

function readServiceLocations(db: SourceDatabase.Database, services: ServiceRow[]): ServiceLocationRow[] {
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

function readDepartures(db: SourceDatabase.Database, services: ServiceRow[], validFrom: string, validTo: string): OfflineDeparture[] {
  const servicesWithDepartures = listServicesWithScheduledDepartures(db);
  const serviceIds = services.map((service) => service.service_id).filter((serviceId) => servicesWithDepartures.has(serviceId));
  const days = dateRange(validFrom, validTo);
  const departures: OfflineDeparture[] = [];

  console.log(`Offline snapshot departure generation service count: ${serviceIds.length}, days: ${days.length}`);
  serviceIds.forEach((serviceId, index) => {
    if (index === 0 || index === serviceIds.length - 1 || (index + 1) % 5 === 0) {
      console.log(`Offline snapshot departure progress ${index + 1}/${serviceIds.length} service_id=${serviceId}`);
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
    console.log(`Offline snapshot departures for service ${serviceId}: ${serviceDepartureCount}`);
  });

  return departures;
}

function createSnapshot(db: SourceDatabase.Database, now = new Date()): OfflineSnapshot {
  const generatedAt = now.toISOString();
  const validFrom = dateString(now);
  const validTo = addDays(validFrom, 59);
  console.log(`Generating offline SQLite snapshot for ${validFrom} to ${validTo} ...`);

  const services = readServices(db);
  console.log(`Offline snapshot visible services: ${services.length}`);
  const locations = readLocations(db);
  console.log(`Offline snapshot locations: ${locations.length}`);
  const serviceLocations = readServiceLocations(db, services);
  console.log(`Offline snapshot service-location links: ${serviceLocations.length}`);
  const organisations = readOrganisations(db, services);
  console.log(`Offline snapshot service organisations: ${organisations.length}`);
  const servicesWithDepartures = listServicesWithScheduledDepartures(db);
  console.log(`Offline snapshot services with scheduled departures: ${servicesWithDepartures.size}`);
  const departures = readDepartures(db, services, validFrom, validTo);
  console.log(`Offline snapshot generated departures: ${departures.length}`);

  const snapshotWithoutVersion: OfflineSnapshot = {
    schemaVersion: 1,
    dataVersion: "",
    generatedAt,
    validFrom,
    validTo,
    services: services.map((service) => ({
      ...service,
      scheduled_departures_available: servicesWithDepartures.has(service.service_id) ? 1 : 0
    })),
    locations,
    organisations,
    serviceLocations,
    departures
  };
  const dataVersion = hashJson({ ...snapshotWithoutVersion, dataVersion: "", generatedAt: `${validFrom}T00:00:00.000Z` });
  return { ...snapshotWithoutVersion, dataVersion };
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

function writeSnapshotDatabase(snapshotPath: string, snapshot: OfflineSnapshot): void {
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

export function readOfflineSnapshotMetadata(metadataPath = defaultSnapshotMetadataPath): OfflineSnapshotMetadata | null {
  if (!fs.existsSync(metadataPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(metadataPath, "utf8")) as OfflineSnapshotMetadata;
}

export function generateAndWriteOfflineSnapshot(
  sourceDb: SourceDatabase.Database,
  snapshotPath = defaultSnapshotPath,
  metadataPath = defaultSnapshotMetadataPath
): OfflineSnapshotMetadata {
  const snapshot = createSnapshot(sourceDb);
  const metadata: OfflineSnapshotMetadata = {
    data_version: snapshot.dataVersion,
    etag: quotedEtag(snapshot.dataVersion),
    generated_at: snapshot.generatedAt,
    valid_from: snapshot.validFrom,
    valid_to: snapshot.validTo
  };
  const existingMetadata = readOfflineSnapshotMetadata(metadataPath);

  if (existingMetadata?.data_version === snapshot.dataVersion && fs.existsSync(snapshotPath)) {
    console.log(`Offline snapshot artifact unchanged: ${snapshot.dataVersion}`);
    return existingMetadata;
  }

  writeSnapshotDatabase(snapshotPath, snapshot);
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(`${metadataPath}.tmp`, `${JSON.stringify(metadata, null, 2)}\n`);
  fs.renameSync(`${metadataPath}.tmp`, metadataPath);
  console.log(`Offline snapshot artifact updated: ${snapshot.dataVersion}`);
  return metadata;
}
