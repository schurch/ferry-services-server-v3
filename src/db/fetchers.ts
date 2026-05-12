import type Database from "better-sqlite3";
import type { Location, VesselPosition, WeatherObservation } from "../types/fetchers.js";

export function listLocations(db: Database.Database): Location[] {
  return db.prepare(`
    SELECT location_id, name, latitude, longitude
    FROM locations
    ORDER BY location_id
  `).all() as Location[];
}

export function saveLocationWeather(db: Database.Database, locationId: number, weather: WeatherObservation): void {
  db.prepare(`
    INSERT INTO location_weather (location_id, description, icon, temperature, wind_speed, wind_direction)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (location_id) DO UPDATE
      SET description = excluded.description,
          icon = excluded.icon,
          temperature = excluded.temperature,
          wind_speed = excluded.wind_speed,
          wind_direction = excluded.wind_direction,
          updated = CURRENT_TIMESTAMP
  `).run(locationId, weather.description, weather.icon, weather.temperature, weather.windSpeed, weather.windDirection);
}

export function saveVessel(db: Database.Database, vessel: VesselPosition): void {
  db.prepare(`
    INSERT INTO vessels (mmsi, name, speed, course, latitude, longitude, last_received, updated, organisation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT (mmsi) DO UPDATE
      SET name = excluded.name,
          speed = excluded.speed,
          course = excluded.course,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          last_received = excluded.last_received,
          updated = excluded.updated,
          organisation_id = excluded.organisation_id
  `).run(
    vessel.mmsi,
    vessel.name,
    vessel.speed ?? null,
    vessel.course ?? null,
    vessel.latitude,
    vessel.longitude,
    vessel.lastReceived,
    vessel.organisationId
  );
}
