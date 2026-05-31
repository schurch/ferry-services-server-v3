import type Database from "better-sqlite3";
import type { Location, WeatherObservation } from "./types.js";

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
