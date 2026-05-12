import type Database from "better-sqlite3";
import type { Location, ScrapedService, VesselPosition, WeatherObservation } from "../types/fetchers.js";

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

export function listServiceIdsForOrganisation(db: Database.Database, organisationId: number): number[] {
  return (db.prepare(`
    SELECT service_id
    FROM services
    WHERE organisation_id = ?
    ORDER BY service_id
  `).all(organisationId) as Array<{ service_id: number }>).map((row) => row.service_id);
}

export function saveServices(db: Database.Database, services: ScrapedService[]): void {
  const save = db.prepare(`
    INSERT INTO services (service_id, area, route, status, additional_info, disruption_reason, organisation_id, last_updated_date, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (service_id) DO UPDATE
      SET area = excluded.area,
          route = excluded.route,
          status = excluded.status,
          additional_info = excluded.additional_info,
          disruption_reason = excluded.disruption_reason,
          organisation_id = excluded.organisation_id,
          last_updated_date = excluded.last_updated_date,
          updated = excluded.updated,
          visible = 1
  `);

  const transaction = db.transaction((items: ScrapedService[]) => {
    for (const service of items) {
      save.run(
        service.serviceId,
        service.area,
        service.route,
        service.status,
        service.additionalInfo ?? null,
        service.disruptionReason ?? null,
        service.organisationId,
        service.lastUpdatedDate ?? null,
        service.updated
      );
    }
  });

  transaction(services);
}

export function hideServices(db: Database.Database, serviceIds: number[]): void {
  const hide = db.prepare("UPDATE services SET visible = 0 WHERE service_id = ?");
  const transaction = db.transaction((ids: number[]) => {
    for (const serviceId of ids) {
      hide.run(serviceId);
    }
  });
  transaction(serviceIds);
}
