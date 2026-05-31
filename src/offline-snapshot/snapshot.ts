import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type SourceDatabase from "better-sqlite3";
import { logger } from "../logger.js";
import { listServicesWithScheduledDepartures } from "../api/db.js";
import {
  readDepartures,
  readLocations,
  readOrganisations,
  readServiceLocations,
  readServices,
  writeSnapshotDatabase
} from "./db.js";
import type { OfflineSnapshot, OfflineSnapshotMetadata } from "./types.js";

export const defaultSnapshotPath = "offline/snapshot.sqlite3";

export const defaultSnapshotMetadataPath = "offline/snapshot.meta.json";

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
    logger.info({ dataVersion: snapshot.dataVersion }, "Offline snapshot artifact unchanged");
    return existingMetadata;
  }

  writeSnapshotDatabase(snapshotPath, snapshot);
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(`${metadataPath}.tmp`, `${JSON.stringify(metadata, null, 2)}\n`);
  fs.renameSync(`${metadataPath}.tmp`, metadataPath);
  logger.info({ dataVersion: snapshot.dataVersion }, "Offline snapshot artifact updated");
  return metadata;
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateString(date);
}

function hashJson(value: unknown): string {
  return `sha256-${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function quotedEtag(value: string): string {
  return `"${value}"`;
}

function createSnapshot(db: SourceDatabase.Database, now = new Date()): OfflineSnapshot {
  const generatedAt = now.toISOString();
  const validFrom = dateString(now);
  const validTo = addDays(validFrom, 59);
  logger.info({ validFrom, validTo }, "Generating offline SQLite snapshot");

  const services = readServices(db);
  logger.info({ serviceCount: services.length }, "Offline snapshot visible services loaded");
  const locations = readLocations(db);
  logger.info({ locationCount: locations.length }, "Offline snapshot locations loaded");
  const serviceLocations = readServiceLocations(db, services);
  logger.info({ serviceLocationCount: serviceLocations.length }, "Offline snapshot service-location links loaded");
  const organisations = readOrganisations(db, services);
  logger.info({ organisationCount: organisations.length }, "Offline snapshot service organisations loaded");
  const servicesWithDepartures = listServicesWithScheduledDepartures(db);
  logger.info({ serviceCount: servicesWithDepartures.size }, "Offline snapshot services with scheduled departures loaded");
  const departures = readDepartures(db, services, validFrom, validTo);
  logger.info({ departureCount: departures.length }, "Offline snapshot departures generated");

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
