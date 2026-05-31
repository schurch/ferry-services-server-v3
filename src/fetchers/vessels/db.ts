import type Database from "better-sqlite3";
import type { PreviousVesselPosition, TerminalReference, VesselPosition } from "./types.js";

export function loadTerminals(db: Database.Database): TerminalReference[] {
  return db.prepare(`
    SELECT DISTINCT
      s.organisation_id AS organisationId,
      sl.service_id AS serviceId,
      l.name,
      l.latitude,
      l.longitude
    FROM service_locations sl
    JOIN services s ON s.service_id = sl.service_id
    JOIN locations l ON l.location_id = sl.location_id
  `).all() as TerminalReference[];
}

export function loadVesselNames(db: Database.Database): Map<number, string> {
  const rows = db.prepare(`
    SELECT mmsi, name
    FROM vessels
  `).all() as Array<{ mmsi: number; name: string }>;

  return new Map(rows.map((row) => [row.mmsi, row.name]));
}

export function previousVesselPosition(db: Database.Database, mmsi: number): PreviousVesselPosition | undefined {
  const row = db.prepare(`
    SELECT name, latitude, longitude, destination_name, origin_name, origin_departed_at
    FROM vessels
    WHERE mmsi = ?
  `).get(mmsi) as {
    name: string;
    latitude: number;
    longitude: number;
    destination_name: string | null;
    origin_name: string | null;
    origin_departed_at: string | null;
  } | undefined;

  return row
    ? {
        name: row.name,
        latitude: row.latitude,
        longitude: row.longitude,
        destinationName: row.destination_name ?? undefined,
        originName: row.origin_name ?? undefined,
        originDepartedAt: row.origin_departed_at ?? undefined
      }
    : undefined;
}

export function saveVessel(db: Database.Database, vessel: VesselPosition): void {
  db.prepare(`
    INSERT INTO vessels (
      mmsi,
      name,
      speed,
      course,
      latitude,
      longitude,
      last_received,
      destination_name,
      origin_name,
      origin_departed_at,
      updated,
      organisation_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT (mmsi) DO UPDATE
      SET name = excluded.name,
          speed = excluded.speed,
          course = excluded.course,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          last_received = excluded.last_received,
          destination_name = excluded.destination_name,
          origin_name = excluded.origin_name,
          origin_departed_at = excluded.origin_departed_at,
          updated = excluded.updated,
          organisation_id = excluded.organisation_id
      WHERE excluded.last_received > vessels.last_received
  `).run(
    vessel.mmsi,
    vessel.name,
    vessel.speed ?? null,
    vessel.course ?? null,
    vessel.latitude,
    vessel.longitude,
    vessel.lastReceived,
    vessel.destinationName ?? null,
    vessel.originName ?? null,
    vessel.originDepartedAt ?? null,
    vessel.organisationId
  );
}
