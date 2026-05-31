import type Database from "better-sqlite3";
import type { RailDeparture } from "./types.js";

export function replaceRailDepartures(db: Database.Database, departureCrs: string, departures: RailDeparture[]): void {
  const deleteExisting = db.prepare("DELETE FROM rail_departures WHERE departure_crs = ?");
  const insert = db.prepare(`
    INSERT INTO rail_departures (
      departure_crs,
      departure_name,
      destination_crs,
      destination_name,
      scheduled_departure_time,
      estimated_departure_time,
      cancelled,
      platform,
      location_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction((items: RailDeparture[]) => {
    deleteExisting.run(departureCrs);
    for (const departure of items) {
      insert.run(
        departure.departureCrs,
        departure.departureName,
        departure.destinationCrs,
        departure.destinationName,
        departure.scheduledDepartureTime,
        departure.estimatedDepartureTime,
        departure.cancelled ? 1 : 0,
        departure.platform ?? null,
        departure.locationId
      );
    }
  });

  transaction(departures);
}
