import type Database from "better-sqlite3";
import type { Location, RailDeparture, ScrapedService, VesselPosition, WeatherObservation } from "../types/fetchers.js";
import type { ServiceStatus } from "../types/api.js";

// #region Helpers

function nowSql(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function dateString(value: string): string {
  return value.slice(0, 10);
}

// #endregion

// #region Public API

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

export function listServiceIdsForOrganisation(db: Database.Database, organisationId: number): number[] {
  return (db.prepare(`
    SELECT service_id
    FROM services
    WHERE organisation_id = ?
    ORDER BY service_id
  `).all(organisationId) as Array<{ service_id: number }>).map((row) => row.service_id);
}

export function listServicesById(db: Database.Database, serviceIds: number[]): Map<number, ScrapedService> {
  if (serviceIds.length === 0) {
    return new Map();
  }

  const rows = db.prepare(`
    SELECT service_id, area, route, status, additional_info, disruption_reason, organisation_id, last_updated_date, updated
    FROM services
    WHERE service_id = ?
  `);

  return new Map(serviceIds.flatMap((serviceId) => {
    const row = rows.get(serviceId) as {
      service_id: number;
      area: string;
      route: string;
      status: ServiceStatus;
      additional_info: string | null;
      disruption_reason: string | null;
      organisation_id: number;
      last_updated_date: string | null;
      updated: string;
    } | undefined;

    return row
      ? [[row.service_id, {
        serviceId: row.service_id,
        area: row.area,
        route: row.route,
        status: row.status,
        additionalInfo: row.additional_info ?? undefined,
        disruptionReason: row.disruption_reason ?? undefined,
        organisationId: row.organisation_id,
        lastUpdatedDate: row.last_updated_date ?? undefined,
        updated: row.updated
      }]]
      : [];
  }));
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

export function startServiceScrapeRun(
  db: Database.Database,
  input: {
    operatorName: string;
    organisationId?: number;
    sourceName: string;
    startedAt?: string;
  }
): number {
  const result = db.prepare(`
    INSERT INTO service_scrape_runs (operator_name, organisation_id, source_name, started_at)
    VALUES (?, ?, ?, ?)
  `).run(input.operatorName, input.organisationId ?? null, input.sourceName, input.startedAt ?? nowSql());

  return Number(result.lastInsertRowid);
}

export function finishServiceScrapeRun(
  db: Database.Database,
  scrapeRunId: number,
  input: {
    success: boolean;
    error?: string;
    completedAt?: string;
  }
): void {
  db.prepare(`
    UPDATE service_scrape_runs
    SET success = ?,
        error = ?,
        completed_at = ?
    WHERE scrape_run_id = ?
  `).run(input.success ? 1 : 0, input.error ?? null, input.completedAt ?? nowSql(), scrapeRunId);
}

export function saveServiceStatusObservations(
  db: Database.Database,
  scrapeRunId: number,
  services: ScrapedService[],
  observedAt = nowSql()
): void {
  const saveObservation = db.prepare(`
    INSERT INTO service_status_observations (
      scrape_run_id,
      service_id,
      observed_at,
      source_service_id,
      source_service_code,
      source_area_id,
      source_area_name,
      source_area_latitude,
      source_area_longitude,
      status,
      source_status,
      disruption_reason,
      last_updated_date
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const saveNotice = db.prepare(`
    INSERT INTO service_status_observation_notices (
      observation_id,
      source_notice_key,
      source_notice_type,
      title,
      disruption_reason,
      payload_id,
      display_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const savePayload = db.prepare(`
    INSERT OR IGNORE INTO service_status_notice_payloads (
      detail_text,
      detail_markdown
    )
    VALUES (?, ?)
  `);
  const findPayload = db.prepare(`
    SELECT payload_id
    FROM service_status_notice_payloads
    WHERE coalesce(detail_text, '') = coalesce(?, '')
      AND coalesce(detail_markdown, '') = coalesce(?, '')
  `);

  const transaction = db.transaction((items: ScrapedService[]) => {
    for (const service of items) {
      const notices = service.notices ?? [];
      const result = saveObservation.run(
        scrapeRunId,
        service.serviceId,
        observedAt,
        service.sourceServiceId ?? null,
        service.sourceServiceCode ?? null,
        service.sourceAreaId ?? null,
        service.sourceAreaName ?? null,
        service.sourceAreaLatitude ?? null,
        service.sourceAreaLongitude ?? null,
        service.status,
        service.sourceStatus ?? null,
        service.disruptionReason ?? null,
        service.lastUpdatedDate ?? null
      );
      const observationId = Number(result.lastInsertRowid);

      notices.forEach((notice, index) => {
        const detailText = notice.detailText ?? null;
        const detailMarkdown = notice.detailMarkdown ?? null;
        let payloadId: number | null = null;
        if (detailText !== null || detailMarkdown !== null) {
          savePayload.run(detailText, detailMarkdown);
          const payload = findPayload.get(detailText, detailMarkdown) as { payload_id: number };
          payloadId = payload.payload_id;
        }

        saveNotice.run(
          observationId,
          notice.sourceNoticeKey ?? `${service.serviceId}:${index}`,
          notice.sourceNoticeType ?? null,
          notice.title,
          notice.disruptionReason ?? null,
          payloadId,
          index
        );
      });
    }
  });

  transaction(services);
}

export function saveServiceReliabilityDays(
  db: Database.Database,
  services: Array<{
    serviceId: number;
    status: ServiceStatus;
    scheduledSailings: number;
  }>,
  observedAt = nowSql()
): void {
  const observedDate = dateString(observedAt);
  const save = db.prepare(`
    INSERT INTO service_reliability_days (
      service_id,
      observed_date,
      status,
      scheduled_sailings,
      first_observed_at,
      last_observed_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (service_id, observed_date) DO UPDATE
      SET status = max(service_reliability_days.status, excluded.status),
          scheduled_sailings = max(service_reliability_days.scheduled_sailings, excluded.scheduled_sailings),
          first_observed_at = min(service_reliability_days.first_observed_at, excluded.first_observed_at),
          last_observed_at = max(service_reliability_days.last_observed_at, excluded.last_observed_at),
          updated_at = CURRENT_TIMESTAMP
  `);

  const transaction = db.transaction((items: typeof services) => {
    for (const service of items) {
      if (service.status !== 0 && service.status !== 1 && service.status !== 2) {
        continue;
      }

      save.run(
        service.serviceId,
        observedDate,
        service.status,
        service.scheduledSailings,
        observedAt,
        observedAt
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

// #endregion
