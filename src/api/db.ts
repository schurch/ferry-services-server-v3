import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { departureQueryParams } from "./departure-rules.js";
import {
  locationResponse,
  organisationResponse,
  railDepartureResponse,
  serviceResponse,
  weatherResponse,
  type LocationRow,
  type OrganisationRow,
  type RailDepartureRow,
  type ServiceRow,
  type WeatherRow
} from "./read-model.js";
import { dateString, parseDateString, sqlTimestamp, timeWithSeconds, timestampResponse, utcIsoResponse } from "./time.js";
import type {
  CreateInstallationRequest,
  DepartureResponse,
  LocationResponse,
  LocationWeatherResponse,
  OrganisationResponse,
  PushStatus,
  RailDepartureResponse,
  ReliabilityPeriodResponse,
  ReliabilityResponse,
  ReliabilityStatusKey,
  ServiceResponse,
  ServiceStatus,
  TimetableDocumentResponse
} from "./types.js";
import { isRecentVesselPosition, type VesselRow } from "./vessels.js";

export type LocationDepartureRow = {
  from_location_id: number;
  to_location_id: number;
  to_location_name: string;
  to_location_latitude: number;
  to_location_longitude: number;
  departure: string;
  arrival: string;
  notes: Nullable<string>;
};

export function londonLocalTimestampResponse(timestamp: string): string {
  const localUtcGuess = new Date(`${timestamp.replace(" ", "T")}Z`);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(localUtcGuess).map((part) => [part.type, part.value]));
  const asLondonUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return new Date(localUtcGuess.getTime() - (asLondonUtc - localUtcGuess.getTime())).toISOString();
}

export function listLocationDepartureRows(db: Database.Database, serviceId: number, queryDate: string): LocationDepartureRow[] {
  const rows = db.prepare(`
    WITH constants(query_date) AS (
        SELECT ? AS query_date
    ),
    day_of_week(derived_day_of_week) AS (
        SELECT
            CASE strftime('%w', query_date)
                WHEN '0' THEN 'sunday'
                WHEN '1' THEN 'monday'
                WHEN '2' THEN 'tuesday'
                WHEN '3' THEN 'wednesday'
                WHEN '4' THEN 'thursday'
                WHEN '5' THEN 'friday'
                WHEN '6' THEN 'saturday'
            END
        FROM constants
    ),
    mapped_service_codes AS (
        SELECT DISTINCT service_code
        FROM transxchange_service_mappings
        WHERE service_id = ?
    ),
    selected_service AS (
        SELECT route
        FROM services
        WHERE service_id = ?
    ),
    service_stop_points AS (
        SELECT l.location_id, l.name, l.latitude, l.longitude, l.stop_point_id
        FROM service_locations sl
        JOIN locations l ON l.location_id = sl.location_id
        WHERE sl.service_id = ?
          AND l.stop_point_id IS NOT NULL
    ),
    heuristic_service_codes AS (
        SELECT DISTINCT s.service_code
        FROM selected_service ss
        JOIN service_stop_points sp_from ON TRUE
        JOIN service_stop_points sp_to
          ON sp_to.stop_point_id <> sp_from.stop_point_id
        JOIN transxchange_journey_pattern_timing_links jptl
          ON jptl.from_stop_point_ref = sp_from.stop_point_id
         AND jptl.to_stop_point_ref = sp_to.stop_point_id
        JOIN transxchange_journey_pattern_sections jps
          ON jps.document_id = jptl.document_id
         AND jps.section_ref = jptl.journey_pattern_section_ref
        JOIN transxchange_journey_patterns jp
          ON jp.document_id = jps.document_id
         AND jp.journey_pattern_id = jps.journey_pattern_id
        JOIN transxchange_services s
          ON s.document_id = jp.document_id
         AND s.service_code = jp.service_code
        WHERE s.mode = 'ferry'
          AND lower(ss.route) NOT LIKE '%freight%'
    ),
    effective_service_codes AS (
        SELECT service_code
        FROM mapped_service_codes
        UNION
        SELECT service_code
        FROM heuristic_service_codes
        WHERE NOT EXISTS (SELECT 1 FROM mapped_service_codes)
    ),
    effective_services AS (
        SELECT s.document_id, s.service_code
        FROM transxchange_services s
        JOIN effective_service_codes esc
          ON esc.service_code = s.service_code
        CROSS JOIN constants
        WHERE s.mode = 'ferry'
          AND (s.start_date IS NULL OR query_date >= s.start_date)
          AND (s.end_date IS NULL OR query_date <= s.end_date)
    ),
    relevant_vehicle_journeys AS (
        SELECT vj.*
        FROM transxchange_vehicle_journeys vj
        JOIN effective_services es
          ON es.document_id = vj.document_id
         AND es.service_code = vj.service_code
    ),
    relevant_journey_patterns AS (
        SELECT DISTINCT vj.document_id, vj.journey_pattern_id
        FROM relevant_vehicle_journeys vj
    ),
    timings AS (
        SELECT
          document_id,
          journey_pattern_timing_link_id,
          journey_pattern_section_ref,
          sort_order,
          from_stop_point_ref,
          from_activity,
          from_timing_status,
          to_stop_point_ref,
          to_activity,
          to_timing_status,
          from_wait_seconds AS wait_seconds,
          run_seconds AS run_seconds
        FROM transxchange_journey_pattern_timing_links
        WHERE document_id IN (
            SELECT DISTINCT document_id
            FROM effective_services
        )
    ),
    pattern_links AS (
        SELECT
            jps.document_id,
            jps.journey_pattern_id,
            jps.section_order,
            t.sort_order,
            ((jps.section_order - 1) * 1000) + t.sort_order AS global_sort_order,
            jptl.from_stop_point_ref,
            t.from_activity,
            t.from_timing_status,
            jptl.to_stop_point_ref,
            t.to_activity,
            t.to_timing_status,
            t.wait_seconds,
            t.run_seconds
        FROM transxchange_journey_pattern_sections jps
        JOIN relevant_journey_patterns rjp
          ON rjp.document_id = jps.document_id
         AND rjp.journey_pattern_id = jps.journey_pattern_id
        JOIN transxchange_journey_pattern_timing_links jptl
          ON jptl.document_id = jps.document_id
         AND jptl.journey_pattern_section_ref = jps.section_ref
        JOIN timings t
          ON t.document_id = jptl.document_id
         AND t.journey_pattern_timing_link_id = jptl.journey_pattern_timing_link_id
    ),
    vehicle_journey_links AS (
        SELECT
            vjtl.document_id,
            vjtl.vehicle_journey_code,
            vj.journey_pattern_id,
            vjtl.sort_order AS global_sort_order,
            t.from_stop_point_ref,
            t.from_activity,
            t.from_timing_status,
            t.to_stop_point_ref,
            t.to_activity,
            t.to_timing_status,
            t.wait_seconds,
            t.run_seconds
        FROM transxchange_vehicle_journey_timing_links vjtl
        JOIN relevant_vehicle_journeys vj
          ON vj.document_id = vjtl.document_id
         AND vj.vehicle_journey_code = vjtl.vehicle_journey_code
        JOIN timings t
          ON t.document_id = vjtl.document_id
         AND t.journey_pattern_timing_link_id = vjtl.journey_pattern_timing_link_id
    ),
    effective_journey_links AS (
        SELECT
            vjl.document_id,
            vjl.vehicle_journey_code,
            vjl.journey_pattern_id,
            vjl.global_sort_order,
            vjl.from_stop_point_ref,
            vjl.from_activity,
            vjl.from_timing_status,
            vjl.to_stop_point_ref,
            vjl.to_activity,
            vjl.to_timing_status,
            vjl.wait_seconds,
            vjl.run_seconds
        FROM vehicle_journey_links vjl
        UNION ALL
        SELECT
            vj.document_id,
            vj.vehicle_journey_code,
            pl.journey_pattern_id,
            pl.global_sort_order,
            pl.from_stop_point_ref,
            pl.from_activity,
            pl.from_timing_status,
            pl.to_stop_point_ref,
            pl.to_activity,
            pl.to_timing_status,
            pl.wait_seconds,
            pl.run_seconds
        FROM relevant_vehicle_journeys vj
        JOIN pattern_links pl
          ON pl.document_id = vj.document_id
         AND pl.journey_pattern_id = vj.journey_pattern_id
        WHERE NOT EXISTS (
            SELECT 1
            FROM transxchange_vehicle_journey_timing_links vjtl
            WHERE vjtl.document_id = vj.document_id
              AND vjtl.vehicle_journey_code = vj.vehicle_journey_code
        )
    ),
    multi_journey_time AS (
        SELECT
            ejl.document_id,
            ejl.vehicle_journey_code,
            ejl.global_sort_order,
            LAG(ejl.run_seconds) OVER (
                PARTITION BY ejl.document_id, ejl.vehicle_journey_code
                ORDER BY ejl.global_sort_order
            ) + ejl.wait_seconds AS seconds
        FROM effective_journey_links ejl
    ),
    journey_legs AS (
        SELECT
            vj.document_id,
            vj.journey_pattern_id,
            vj.vehicle_journey_code,
            ejl.global_sort_order,
            ejl.from_stop_point_ref,
            ejl.from_activity,
            ejl.to_stop_point_ref,
            ejl.to_activity,
            datetime(
                query_date || ' ' || vj.departure_time,
                '+' || COALESCE(
                    SUM(mjt.seconds) OVER (
                        PARTITION BY vj.document_id, vj.vehicle_journey_code
                        ORDER BY ejl.global_sort_order
                    ),
                    0
                ) || ' seconds'
            ) AS departure,
            datetime(
                query_date || ' ' || vj.departure_time,
                '+' || (
                    COALESCE(
                        SUM(mjt.seconds) OVER (
                            PARTITION BY vj.document_id, vj.vehicle_journey_code
                            ORDER BY ejl.global_sort_order
                        ),
                        0
                    ) + ejl.run_seconds
                ) || ' seconds'
            ) AS arrival,
            NULLIF(vj.note, '') AS notes,
            d.source_modification_datetime
        FROM relevant_vehicle_journeys vj
        CROSS JOIN constants
        CROSS JOIN day_of_week
        INNER JOIN effective_journey_links ejl
            ON ejl.document_id = vj.document_id
           AND ejl.vehicle_journey_code = vj.vehicle_journey_code
        INNER JOIN multi_journey_time mjt
            ON mjt.document_id = ejl.document_id
           AND mjt.vehicle_journey_code = ejl.vehicle_journey_code
           AND mjt.global_sort_order = ejl.global_sort_order
        INNER JOIN transxchange_documents d
            ON d.document_id = vj.document_id
        WHERE ejl.from_activity IN ('', 'pickUp', 'pickUpAndSetDown')
          AND ejl.to_activity IN ('', 'setDown', 'pickUpAndSetDown')
          AND (
              NOT EXISTS (
                  SELECT 1
                  FROM transxchange_vehicle_journey_week_of_month_rules vjwmr
                  WHERE vjwmr.document_id = vj.document_id
                    AND vjwmr.vehicle_journey_code = vj.vehicle_journey_code
              )
              OR EXISTS (
                  SELECT 1
                  FROM transxchange_vehicle_journey_week_of_month_rules vjwmr
                  WHERE vjwmr.document_id = vj.document_id
                    AND vjwmr.vehicle_journey_code = vj.vehicle_journey_code
                    AND vjwmr.week_of_month_rule IN (?, ?, ?, ?)
              )
          )
          AND (
              NOT EXISTS (
                  SELECT 1
                  FROM transxchange_vehicle_journey_date_ranges vjsodo
                  WHERE vjsodo.document_id = vj.document_id
                    AND vjsodo.vehicle_journey_code = vj.vehicle_journey_code
                    AND vjsodo.range_type = 'serviced_organisation_days_of_operation'
              )
              OR EXISTS (
                  SELECT 1
                  FROM transxchange_vehicle_journey_date_ranges vjsodo
                  WHERE vjsodo.document_id = vj.document_id
                    AND vjsodo.vehicle_journey_code = vj.vehicle_journey_code
                    AND vjsodo.range_type = 'serviced_organisation_days_of_operation'
                    AND query_date BETWEEN vjsodo.start_date AND vjsodo.end_date
              )
          )
          AND (
              EXISTS (
                  SELECT 1
                  FROM transxchange_vehicle_journey_date_ranges vjdo
                  WHERE vjdo.document_id = vj.document_id
                    AND vjdo.vehicle_journey_code = vj.vehicle_journey_code
                    AND vjdo.range_type = 'days_of_operation'
                    AND query_date BETWEEN vjdo.start_date AND vjdo.end_date
              )
              OR EXISTS (
                  SELECT 1
                  FROM transxchange_vehicle_journey_days vjd
                  WHERE vjd.document_id = vj.document_id
                    AND vjd.vehicle_journey_code = vj.vehicle_journey_code
                    AND (
                        (vjd.day_rule = 'holidays_only' AND EXISTS (
                            SELECT 1
                            WHERE ?
                        ))
                        OR vjd.day_rule = derived_day_of_week
                        OR (derived_day_of_week IN ('monday','tuesday','wednesday','thursday','friday') AND vjd.day_rule = 'monday_to_friday')
                        OR (derived_day_of_week IN ('monday','tuesday','wednesday','thursday','friday','saturday') AND vjd.day_rule = 'monday_to_saturday')
                        OR vjd.day_rule = 'monday_to_sunday'
                        OR (derived_day_of_week IN ('saturday','sunday') AND vjd.day_rule = 'weekend')
                    )
              )
              OR EXISTS (
                  SELECT 1
                  FROM transxchange_vehicle_journey_bank_holiday_rules vjbhor
                  WHERE vjbhor.document_id = vj.document_id
                    AND vjbhor.vehicle_journey_code = vj.vehicle_journey_code
                    AND vjbhor.rule_type = 'operation'
                    AND vjbhor.bank_holiday_rule IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              )
          )
          AND NOT EXISTS (
              SELECT 1
              FROM transxchange_vehicle_journey_date_ranges vjsodno
              WHERE vjsodno.document_id = vj.document_id
                AND vjsodno.vehicle_journey_code = vj.vehicle_journey_code
                AND vjsodno.range_type = 'serviced_organisation_days_of_non_operation'
                AND query_date BETWEEN vjsodno.start_date AND vjsodno.end_date
          )
          AND NOT EXISTS (
              SELECT 1
              FROM transxchange_vehicle_journey_date_ranges vjdno
              WHERE vjdno.document_id = vj.document_id
                AND vjdno.vehicle_journey_code = vj.vehicle_journey_code
                AND vjdno.range_type = 'days_of_non_operation'
                AND query_date BETWEEN vjdno.start_date AND vjdno.end_date
          )
          AND NOT EXISTS (
              SELECT 1
              FROM transxchange_vehicle_journey_bank_holiday_rules vjbhnor
              WHERE vjbhnor.document_id = vj.document_id
                AND vjbhnor.vehicle_journey_code = vj.vehicle_journey_code
                AND vjbhnor.rule_type = 'non_operation'
                AND vjbhnor.bank_holiday_rule IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          )
    ),
    candidate_departures AS (
        SELECT
            fl.location_id AS from_location_id,
            tl.location_id AS to_location_id,
            tl.name AS to_location_name,
            tl.latitude AS to_location_latitude,
            tl.longitude AS to_location_longitude,
            jl.departure,
            jl.arrival,
            jl.notes,
            jl.source_modification_datetime,
            ROW_NUMBER() OVER (
                PARTITION BY fl.location_id, tl.location_id, jl.departure, jl.arrival, jl.notes
                ORDER BY jl.source_modification_datetime DESC
            ) AS candidate_rank
        FROM journey_legs jl
        INNER JOIN service_stop_points fl
            ON fl.stop_point_id = jl.from_stop_point_ref
        INNER JOIN service_stop_points tl
            ON tl.stop_point_id = jl.to_stop_point_ref
        WHERE fl.location_id <> tl.location_id
    )
    SELECT
        from_location_id,
        to_location_id,
        to_location_name,
        to_location_latitude,
        to_location_longitude,
        departure,
        arrival,
        notes
    FROM candidate_departures
    WHERE candidate_rank = 1
    ORDER BY from_location_id, to_location_id, departure, arrival, notes
  `).all(...departureQueryParams(queryDate, serviceId)) as LocationDepartureRow[];

  return rows;
}

export function listServicesWithScheduledDepartures(db: Database.Database): Set<number> {
  const rows = db.prepare(`
    WITH mapped_services AS (
        SELECT DISTINCT sm.service_id
        FROM transxchange_service_mappings sm
        JOIN transxchange_services s
          ON s.service_code = sm.service_code
        JOIN service_locations sl_from
          ON sl_from.service_id = sm.service_id
        JOIN locations sp_from
          ON sp_from.location_id = sl_from.location_id
        JOIN service_locations sl_to
          ON sl_to.service_id = sm.service_id
        JOIN locations sp_to
          ON sp_to.location_id = sl_to.location_id
         AND sp_to.stop_point_id <> sp_from.stop_point_id
        JOIN transxchange_journey_pattern_timing_links jptl
          ON jptl.document_id = s.document_id
         AND jptl.from_stop_point_ref = sp_from.stop_point_id
         AND jptl.to_stop_point_ref = sp_to.stop_point_id
        JOIN transxchange_journey_pattern_sections jps
          ON jps.document_id = jptl.document_id
         AND jps.section_ref = jptl.journey_pattern_section_ref
        JOIN transxchange_journey_patterns jp
          ON jp.document_id = jps.document_id
         AND jp.journey_pattern_id = jps.journey_pattern_id
         AND jp.service_code = s.service_code
        WHERE s.mode = 'ferry'
          AND sp_from.stop_point_id IS NOT NULL
          AND sp_to.stop_point_id IS NOT NULL
    ),
    service_stop_points AS (
        SELECT sl.service_id, s.route, l.stop_point_id
        FROM service_locations sl
        JOIN services s ON s.service_id = sl.service_id
        JOIN locations l ON l.location_id = sl.location_id
        WHERE l.stop_point_id IS NOT NULL
    ),
    heuristic_services AS (
        SELECT DISTINCT sp_from.service_id
        FROM service_stop_points sp_from
        JOIN service_stop_points sp_to
          ON sp_to.service_id = sp_from.service_id
         AND sp_to.stop_point_id <> sp_from.stop_point_id
        JOIN transxchange_journey_pattern_timing_links jptl
          ON jptl.from_stop_point_ref = sp_from.stop_point_id
         AND jptl.to_stop_point_ref = sp_to.stop_point_id
        JOIN transxchange_journey_pattern_sections jps
          ON jps.document_id = jptl.document_id
         AND jps.section_ref = jptl.journey_pattern_section_ref
        JOIN transxchange_journey_patterns jp
          ON jp.document_id = jps.document_id
         AND jp.journey_pattern_id = jps.journey_pattern_id
        JOIN transxchange_services s
          ON s.document_id = jp.document_id
         AND s.service_code = jp.service_code
        WHERE s.mode = 'ferry'
          AND lower(sp_from.route) NOT LIKE '%freight%'
    )
    SELECT service_id
    FROM mapped_services
    UNION
    SELECT hs.service_id
    FROM heuristic_services hs
    WHERE NOT EXISTS (
        SELECT 1
        FROM transxchange_service_mappings sm
        WHERE sm.service_id = hs.service_id
    )
  `).all() as Array<{ service_id: number }>;
  return new Set(rows.map((row) => row.service_id));
}

export function listServices(db: Database.Database): ServiceResponse[] {
  const now = new Date();
  const rows = db.prepare(`
    SELECT service_id, area, route, status, additional_info, disruption_reason, organisation_id, last_updated_date, updated
    FROM services
    WHERE visible = 1
    ORDER BY area, route
  `).all() as ServiceRow[];

  const lookups = {
    scheduledServices: listServicesWithScheduledDepartures(db),
    locations: createLocationLookup(db),
    organisations: createOrganisationLookup(db),
    vessels: new Map<number, VesselRow[]>()
  };

  return rows.map((row) => serviceResponse(row, lookups, now));
}

export function getService(
  db: Database.Database,
  serviceId: number,
  departuresDate?: string,
  now = new Date()
): ServiceResponse | null {
  const row = db.prepare(`
    SELECT service_id, area, route, status, additional_info, disruption_reason, organisation_id, last_updated_date, updated
    FROM services
    WHERE service_id = ? AND visible = 1
  `).get(serviceId) as ServiceRow | undefined;

  if (!row) {
    return null;
  }

  const queryDate = parseDateString(departuresDate, now);
  const locationDepartures = createLocationDepartureLookup(db, serviceId, queryDate);
  const nextDepartures = createLocationDepartureLookup(db, serviceId, dateString(now));
  const nextDepartureLookup = new Map([...nextDepartures].map(([locationId, departures]) => [
    locationId,
    [...departures]
      .sort((left, right) => new Date(left.departure).getTime() - new Date(right.departure).getTime())
      .find((departure) => new Date(departure.departure) > now)
  ]).filter((entry): entry is [number, DepartureResponse] => entry[1] !== undefined));
  return serviceResponse(row, {
    scheduledServices: hasScheduledDepartures(db, serviceId) ? new Set([serviceId]) : new Set(),
    locations: createServiceLocationLookup(db, serviceId, locationDepartures, nextDepartureLookup),
    organisations: createServiceOrganisationLookup(db, serviceId),
    vessels: createSingleServiceVesselLookup(db, serviceId, now),
    timetableDocuments: createServiceTimetableDocumentLookup(db, serviceId),
    reliability: new Map([[serviceId, createServiceReliability(db, serviceId, now)]])
  }, now);
}

export function listInstallationServices(db: Database.Database, installationId: string): ServiceResponse[] {
  const rows = db.prepare(`
    SELECT s.service_id, s.area, s.route, s.status, s.additional_info, s.disruption_reason, s.organisation_id, s.last_updated_date, s.updated
    FROM services s
    JOIN installation_services i ON s.service_id = i.service_id
    WHERE i.installation_id = ? AND s.visible = 1
    ORDER BY s.area, s.route
  `).all(installationId) as ServiceRow[];

  const lookups = {
    scheduledServices: listServicesWithScheduledDepartures(db),
    locations: createLocationLookup(db),
    organisations: createOrganisationLookup(db),
    vessels: new Map<number, VesselRow[]>()
  };

  return rows.map((row) => serviceResponse(row, lookups));
}

export function listTimetableDocuments(db: Database.Database, serviceId?: number): TimetableDocumentResponse[] {
  return createTimetableDocumentResponses(db, serviceId);
}

export type RegistrationAttemptResult =
  | { allowed: true }
  | { allowed: false; reason: "duplicate-churn" | "ip-rate-limit" };

export function hashDeviceToken(deviceToken: string): string {
  return crypto.createHash("sha256").update(deviceToken).digest("hex");
}

export function upsertInstallation(
  db: Database.Database,
  installationId: string,
  request: CreateInstallationRequest,
  now = new Date()
): void {
  db.prepare(`
    INSERT INTO installations (installation_id, device_token, device_type, updated)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (installation_id) DO UPDATE
      SET device_token = excluded.device_token,
          device_type = excluded.device_type,
          updated = excluded.updated
  `).run(installationId, request.deviceToken, request.deviceType, now.toISOString());
}

export function getPushStatus(db: Database.Database, installationId: string): PushStatus | null {
  const row = db.prepare(`
    SELECT push_enabled
    FROM installations
    WHERE installation_id = ?
  `).get(installationId) as InstallationRow | undefined;

  return row ? { enabled: row.push_enabled !== 0 } : null;
}

export function updatePushStatus(db: Database.Database, installationId: string, status: PushStatus): PushStatus | null {
  const result = db.prepare(`
    UPDATE installations
    SET push_enabled = ?, updated = ?
    WHERE installation_id = ?
  `).run(status.enabled ? 1 : 0, new Date().toISOString(), installationId);

  return result.changes > 0 ? status : null;
}

export function addInstallationService(db: Database.Database, installationId: string, serviceId: number): void {
  db.prepare(`
    INSERT INTO installation_services (installation_id, service_id)
    VALUES (?, ?)
    ON CONFLICT DO NOTHING
  `).run(installationId, serviceId);
}

export function deleteInstallationService(db: Database.Database, installationId: string, serviceId: number): void {
  db.prepare(`
    DELETE FROM installation_services
    WHERE installation_id = ? AND service_id = ?
  `).run(installationId, serviceId);
}

export function checkAndRecordInstallationRegistrationAttempt(
  db: Database.Database,
  installationId: string,
  clientIp: string,
  deviceToken: string,
  now = new Date()
): RegistrationAttemptResult {
  const deviceTokenHash = hashDeviceToken(deviceToken);
  const duplicateWindowStart = shiftedIsoTimestamp(now, -24 * 60 * 60 * 1000);
  const ipWindowStart = shiftedIsoTimestamp(now, -60 * 60 * 1000);
  const currentTimestamp = isoTimestamp(now);

  const duplicateAttempt = db.prepare(`
    SELECT 1
    FROM installation_registration_attempts
    WHERE client_ip = ?
      AND device_token_sha256 = ?
      AND installation_id != ?
      AND created >= ?
    LIMIT 1
  `).get(clientIp, deviceTokenHash, installationId, duplicateWindowStart);

  if (duplicateAttempt) {
    return { allowed: false, reason: "duplicate-churn" };
  }

  const recentAttempts = db.prepare(`
    SELECT COUNT(*) AS count
    FROM installation_registration_attempts
    WHERE client_ip = ?
      AND created >= ?
  `).get(clientIp, ipWindowStart) as CountRow;

  if (recentAttempts.count >= 30) {
    return { allowed: false, reason: "ip-rate-limit" };
  }

  db.prepare(`
    INSERT INTO installation_registration_attempts (
      client_ip,
      device_token_sha256,
      installation_id,
      created
    )
    VALUES (?, ?, ?, ?)
  `).run(clientIp, deviceTokenHash, installationId, currentTimestamp);

  return { allowed: true };
}

export function deleteStaleInstallations(
  db: Database.Database,
  now = new Date(),
  maxInstallationAgeDays = 90,
  maxAttemptAgeDays = 7
): { deletedInstallations: number; deletedAttempts: number } {
  const staleInstallationCutoff = shiftedIsoTimestamp(now, -(maxInstallationAgeDays * 24 * 60 * 60 * 1000));
  const staleAttemptCutoff = shiftedIsoTimestamp(now, -(maxAttemptAgeDays * 24 * 60 * 60 * 1000));

  const deletedInstallations = db.prepare(`
    DELETE FROM installations
    WHERE updated < ?
  `).run(staleInstallationCutoff).changes;

  const deletedAttempts = db.prepare(`
    DELETE FROM installation_registration_attempts
    WHERE created < ?
  `).run(staleAttemptCutoff).changes;

  return {
    deletedInstallations: deletedInstallations ?? 0,
    deletedAttempts: deletedAttempts ?? 0
  };
}

type Nullable<T> = T | null;

type TimetableDocumentRow = {
  timetable_document_id: number;
  organisation_id: number;
  organisation_name: string;
  title: string;
  source_url: string;
  content_hash: Nullable<string>;
  content_type: Nullable<string>;
  content_length: Nullable<number>;
  last_seen_at: string;
  updated: string;
};

type TimetableDocumentServiceLinkRow = {
  timetable_document_id: number;
  service_id: number;
};

type ReliabilityStatusCounts = Record<ReliabilityStatusKey, number>;

type ReliabilityDailyStatus = {
  date: string;
  status: ReliabilityStatusKey;
  scheduledSailings: number;
};

type ReliabilityDayRow = {
  observed_date: string;
  status: ServiceStatus;
  scheduled_sailings: number;
};

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function reliabilityStatusKey(status: ServiceStatus): ReliabilityStatusKey | undefined {
  if (status === 0) return "normal";
  if (status === 1) return "disrupted";
  if (status === 2) return "cancelled";
  return undefined;
}

function emptyReliabilityCounts(): ReliabilityStatusCounts {
  return {
    normal: 0,
    disrupted: 0,
    cancelled: 0
  };
}

function roundedPercentage(count: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return Math.round(((count / total) * 100) * 10) / 10;
}

function createLocationLookup(
  db: Database.Database,
  scheduledDepartures = new Map<number, DepartureResponse[]>(),
  nextDepartures = new Map<number, DepartureResponse>()
): Map<number, LocationResponse[]> {
  const weatherByLocation = new Map(
    db.prepare("SELECT location_id, description, icon, temperature, wind_speed, wind_direction FROM location_weather").all().map((row) => {
      const weather = row as WeatherRow;
      return [weather.location_id, weatherResponse(weather)] as const;
    })
  );

  const nextRailByLocation = new Map<number, RailDepartureResponse>();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const railFreshnessCutoff = sqlTimestamp(new Date(now.getTime() - (5 * 60 * 1000)));
  for (const row of db.prepare(`
    SELECT location_id, departure_name, destination_name, scheduled_departure_time, estimated_departure_time, cancelled, platform
    FROM rail_departures
    WHERE datetime(created) > datetime(?)
    ORDER BY scheduled_departure_time
  `).all(railFreshnessCutoff) as RailDepartureRow[]) {
    const departureTime = timeWithSeconds(row.scheduled_departure_time.replace(" ", "T").split("T").pop() ?? "");
    const departure = utcIsoResponse(today, departureTime);
    if (!nextRailByLocation.has(row.location_id) && new Date(departure) > now) {
      nextRailByLocation.set(row.location_id, railDepartureResponse(row, departure));
    }
  }

  const rows = db.prepare(`
    SELECT sl.service_id, l.location_id, l.name, l.latitude, l.longitude
    FROM service_locations sl
    JOIN locations l ON l.location_id = sl.location_id
    ORDER BY sl.service_id, l.location_id
  `).all() as LocationRow[];

  const lookup = new Map<number, LocationResponse[]>();
  for (const row of rows) {
    const locations = lookup.get(row.service_id) ?? [];
    locations.push(locationResponse(row, { scheduledDepartures, nextDepartures, weatherByLocation, nextRailByLocation }));
    lookup.set(row.service_id, locations);
  }
  return lookup;
}

function createServiceLocationLookup(
  db: Database.Database,
  serviceId: number,
  scheduledDepartures = new Map<number, DepartureResponse[]>(),
  nextDepartures = new Map<number, DepartureResponse>()
): Map<number, LocationResponse[]> {
  const rows = db.prepare(`
    SELECT sl.service_id, l.location_id, l.name, l.latitude, l.longitude
    FROM service_locations sl
    JOIN locations l ON l.location_id = sl.location_id
    WHERE sl.service_id = ?
    ORDER BY l.location_id
  `).all(serviceId) as LocationRow[];

  const locationIds = rows.map((row) => row.location_id);
  const weatherByLocation = new Map<number, LocationWeatherResponse>();
  const nextRailByLocation = new Map<number, RailDepartureResponse>();

  if (locationIds.length > 0) {
    const placeholders = locationIds.map(() => "?").join(", ");
    for (const row of db.prepare(`
      SELECT location_id, description, icon, temperature, wind_speed, wind_direction
      FROM location_weather
      WHERE location_id IN (${placeholders})
    `).all(...locationIds) as WeatherRow[]) {
      weatherByLocation.set(row.location_id, weatherResponse(row));
    }

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const railFreshnessCutoff = sqlTimestamp(new Date(now.getTime() - (5 * 60 * 1000)));
    for (const row of db.prepare(`
      SELECT location_id, departure_name, destination_name, scheduled_departure_time, estimated_departure_time, cancelled, platform
      FROM rail_departures
      WHERE datetime(created) > datetime(?)
        AND location_id IN (${placeholders})
      ORDER BY scheduled_departure_time
    `).all(railFreshnessCutoff, ...locationIds) as RailDepartureRow[]) {
      const departureTime = timeWithSeconds(row.scheduled_departure_time.replace(" ", "T").split("T").pop() ?? "");
      const departure = utcIsoResponse(today, departureTime);
      if (!nextRailByLocation.has(row.location_id) && new Date(departure) > now) {
        nextRailByLocation.set(row.location_id, railDepartureResponse(row, departure));
      }
    }
  }

  return new Map([[serviceId, rows.map((row) => locationResponse(row, { scheduledDepartures, nextDepartures, weatherByLocation, nextRailByLocation }))]]);
}

function createOrganisationLookup(db: Database.Database): Map<number, OrganisationResponse> {
  const rows = db.prepare(`
    SELECT s.service_id, o.organisation_id, o.name, o.website, o.local_phone, o.international_phone, o.email, o.x, o.facebook
    FROM services s
    JOIN organisations o ON o.organisation_id = s.organisation_id
  `).all() as OrganisationRow[];

  return new Map(rows.map((row) => [row.service_id, organisationResponse(row)]));
}

function createServiceOrganisationLookup(db: Database.Database, serviceId: number): Map<number, OrganisationResponse> {
  const row = db.prepare(`
    SELECT s.service_id, o.organisation_id, o.name, o.website, o.local_phone, o.international_phone, o.email, o.x, o.facebook
    FROM services s
    JOIN organisations o ON o.organisation_id = s.organisation_id
    WHERE s.service_id = ?
  `).get(serviceId) as OrganisationRow | undefined;

  if (!row) {
    return new Map();
  }

  return new Map([[row.service_id, organisationResponse(row)]]);
}

function createSingleServiceVesselLookup(db: Database.Database, serviceId: number, now = new Date()): Map<number, VesselRow[]> {
  const rows = db.prepare(`
    WITH bounding_box AS (
      SELECT
        MIN(l.latitude) - 0.02 AS min_latitude,
        MAX(l.latitude) + 0.02 AS max_latitude,
        MIN(l.longitude) - 0.02 AS min_longitude,
        MAX(l.longitude) + 0.02 AS max_longitude
      FROM locations l
      JOIN service_locations sl ON l.location_id = sl.location_id
      WHERE sl.service_id = ?
    )
    SELECT
      ? AS service_id,
      v.mmsi,
      v.name,
      v.speed,
      v.course,
      v.latitude,
      v.longitude,
      v.last_received,
      v.destination_name,
      v.origin_name,
      v.origin_departed_at
    FROM vessels v
    JOIN services s ON s.service_id = ?
    JOIN bounding_box b
    WHERE v.latitude BETWEEN b.min_latitude AND b.max_latitude
      AND v.longitude BETWEEN b.min_longitude AND b.max_longitude
      AND s.organisation_id = v.organisation_id
  `).all(serviceId, serviceId, serviceId) as VesselRow[];

  const vessels = rows.filter((row) => isRecentVesselPosition(row.last_received, now));
  return vessels.length > 0 ? new Map([[serviceId, vessels]]) : new Map();
}

function createTimetableDocumentResponses(db: Database.Database, serviceId?: number): TimetableDocumentResponse[] {
  const rows = serviceId === undefined
    ? db.prepare(`
        SELECT td.timetable_document_id, td.organisation_id, o.name AS organisation_name, td.title, td.source_url,
          td.content_hash, td.content_type, td.content_length, td.last_seen_at, td.updated
        FROM timetable_documents td
        JOIN organisations o ON o.organisation_id = td.organisation_id
        ORDER BY o.name, td.title
      `).all() as TimetableDocumentRow[]
    : db.prepare(`
        SELECT td.timetable_document_id, td.organisation_id, o.name AS organisation_name, td.title, td.source_url,
          td.content_hash, td.content_type, td.content_length, td.last_seen_at, td.updated
        FROM timetable_documents td
        JOIN organisations o ON o.organisation_id = td.organisation_id
        JOIN timetable_document_services tds ON tds.timetable_document_id = td.timetable_document_id
        WHERE tds.service_id = ?
        ORDER BY o.name, td.title
      `).all(serviceId) as TimetableDocumentRow[];

  const links = serviceId === undefined
    ? db.prepare(`
        SELECT timetable_document_id, service_id
        FROM timetable_document_services
        ORDER BY timetable_document_id, service_id
      `).all() as TimetableDocumentServiceLinkRow[]
    : db.prepare(`
        SELECT related.timetable_document_id, related.service_id
        FROM timetable_document_services requested
        JOIN timetable_document_services related
          ON related.timetable_document_id = requested.timetable_document_id
        WHERE requested.service_id = ?
        ORDER BY related.timetable_document_id, related.service_id
      `).all(serviceId) as TimetableDocumentServiceLinkRow[];

  const serviceIdsByDocument = new Map<number, number[]>();
  for (const link of links) {
    const serviceIds = serviceIdsByDocument.get(link.timetable_document_id) ?? [];
    serviceIds.push(link.service_id);
    serviceIdsByDocument.set(link.timetable_document_id, serviceIds);
  }

  return rows.map((row) => ({
    id: row.timetable_document_id,
    organisationId: row.organisation_id,
    organisationName: row.organisation_name,
    serviceIds: serviceIdsByDocument.get(row.timetable_document_id) ?? [],
    title: row.title,
    sourceUrl: row.source_url,
    ...(row.content_hash !== null ? { contentHash: row.content_hash } : {}),
    ...(row.content_type !== null ? { contentType: row.content_type } : {}),
    ...(row.content_length !== null ? { contentLength: row.content_length } : {}),
    lastSeenAt: timestampResponse(row.last_seen_at),
    updated: timestampResponse(row.updated)
  }));
}

function createServiceTimetableDocumentLookup(db: Database.Database, serviceId: number): Map<number, TimetableDocumentResponse[]> {
  const documents = createTimetableDocumentResponses(db, serviceId);
  return documents.length > 0 ? new Map([[serviceId, documents]]) : new Map();
}

function reliabilityDaysByDate(
  db: Database.Database,
  serviceId: number,
  start: string,
  end: string
): Map<string, ReliabilityDayRow> {
  const rows = db.prepare(`
    SELECT
      observed_date,
      status,
      scheduled_sailings
    FROM service_reliability_days
    WHERE service_id = ?
      AND observed_date >= date(?)
      AND observed_date < date(?)
  `).all(serviceId, start, end) as ReliabilityDayRow[];

  return new Map(rows.map((row) => [row.observed_date, row]));
}

function reliabilityDailyStatuses(
  db: Database.Database,
  serviceId: number,
  start: Date,
  end: Date
): ReliabilityDailyStatus[] {
  const startTimestamp = sqlTimestamp(start);
  const endTimestamp = sqlTimestamp(end);
  const reliabilityDayByDate = reliabilityDaysByDate(db, serviceId, startTimestamp, endTimestamp);
  const statuses: ReliabilityDailyStatus[] = [];

  for (let current = new Date(start); current < end; current = addUtcDays(current, 1)) {
    const queryDate = dateString(current);
    const reliabilityDay = reliabilityDayByDate.get(queryDate);
    if (reliabilityDay === undefined) {
      continue;
    }
    const status = reliabilityStatusKey(reliabilityDay.status);
    if (status === undefined) {
      continue;
    }

    statuses.push({
      date: queryDate,
      status,
      scheduledSailings: reliabilityDay.scheduled_sailings
    });
  }

  return statuses;
}

function reliabilityPeriodResponse(
  startDate: Date,
  endDate: Date,
  dailyStatuses: ReliabilityDailyStatus[]
): ReliabilityPeriodResponse {
  const counts = emptyReliabilityCounts();
  let totalDays = 0;
  let scheduledSailings = 0;
  const startDay = dateString(startDate);
  const endDay = dateString(endDate);

  for (const dailyStatus of dailyStatuses) {
    if (dailyStatus.date < startDay || dailyStatus.date >= endDay) {
      continue;
    }
    if (dailyStatus.scheduledSailings === 0) {
      continue;
    }

    counts[dailyStatus.status] += 1;
    totalDays += 1;
    scheduledSailings += dailyStatus.scheduledSailings;
  }

  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    observedOperatingDays: totalDays,
    scheduledSailings,
    dayStatuses: {
      normal: {
        days: counts.normal,
        percentage: roundedPercentage(counts.normal, totalDays)
      },
      disrupted: {
        days: counts.disrupted,
        percentage: roundedPercentage(counts.disrupted, totalDays)
      },
      cancelled: {
        days: counts.cancelled,
        percentage: roundedPercentage(counts.cancelled, totalDays)
      }
    }
  };
}

function createServiceReliability(db: Database.Database, serviceId: number, now: Date): ReliabilityResponse {
  const endDate = addUtcDays(startOfUtcDay(now), 1);
  const thirtyDayStartDate = addUtcDays(endDate, -30);
  const sevenDayStartDate = addUtcDays(endDate, -7);
  const dailyStatuses = reliabilityDailyStatuses(db, serviceId, thirtyDayStartDate, endDate);

  return {
    statusBreakdown: {
      last7Days: reliabilityPeriodResponse(sevenDayStartDate, endDate, dailyStatuses),
      last30Days: reliabilityPeriodResponse(thirtyDayStartDate, endDate, dailyStatuses)
    }
  };
}

function departureResponseFromRow(row: LocationDepartureRow): DepartureResponse {
  return {
    destination: {
      id: row.to_location_id,
      name: row.to_location_name,
      latitude: row.to_location_latitude,
      longitude: row.to_location_longitude
    },
    departure: londonLocalTimestampResponse(row.departure),
    arrival: londonLocalTimestampResponse(row.arrival),
    ...(row.notes !== null ? { notes: row.notes } : {})
  };
}

function createLocationDepartureLookup(db: Database.Database, serviceId: number, queryDate: string): Map<number, DepartureResponse[]> {
  const lookup = new Map<number, DepartureResponse[]>();
  for (const row of listLocationDepartureRows(db, serviceId, queryDate)) {
    const locationDepartures = lookup.get(row.from_location_id) ?? [];
    locationDepartures.push(departureResponseFromRow(row));
    lookup.set(row.from_location_id, locationDepartures);
  }
  return lookup;
}

function hasScheduledDepartures(db: Database.Database, serviceId: number): boolean {
  const row = db.prepare(`
    WITH mapped_service AS (
        SELECT 1
        FROM transxchange_service_mappings sm
        JOIN transxchange_services s
          ON s.service_code = sm.service_code
        JOIN service_locations sl_from
          ON sl_from.service_id = sm.service_id
        JOIN locations sp_from
          ON sp_from.location_id = sl_from.location_id
        JOIN service_locations sl_to
          ON sl_to.service_id = sm.service_id
        JOIN locations sp_to
          ON sp_to.location_id = sl_to.location_id
         AND sp_to.stop_point_id <> sp_from.stop_point_id
        JOIN transxchange_journey_pattern_timing_links jptl
          ON jptl.document_id = s.document_id
         AND jptl.from_stop_point_ref = sp_from.stop_point_id
         AND jptl.to_stop_point_ref = sp_to.stop_point_id
        JOIN transxchange_journey_pattern_sections jps
          ON jps.document_id = jptl.document_id
         AND jps.section_ref = jptl.journey_pattern_section_ref
        JOIN transxchange_journey_patterns jp
          ON jp.document_id = jps.document_id
         AND jp.journey_pattern_id = jps.journey_pattern_id
         AND jp.service_code = s.service_code
        WHERE sm.service_id = ?
          AND s.mode = 'ferry'
          AND sp_from.stop_point_id IS NOT NULL
          AND sp_to.stop_point_id IS NOT NULL
        LIMIT 1
    ),
    heuristic_service AS (
        SELECT 1
        FROM services selected_service
        JOIN service_locations sl_from
          ON sl_from.service_id = selected_service.service_id
        JOIN locations sp_from
          ON sp_from.location_id = sl_from.location_id
        JOIN service_locations sl_to
          ON sl_to.service_id = selected_service.service_id
        JOIN locations sp_to
          ON sp_to.location_id = sl_to.location_id
         AND sp_to.stop_point_id <> sp_from.stop_point_id
        JOIN transxchange_journey_pattern_timing_links jptl
          ON jptl.from_stop_point_ref = sp_from.stop_point_id
         AND jptl.to_stop_point_ref = sp_to.stop_point_id
        JOIN transxchange_journey_pattern_sections jps
          ON jps.document_id = jptl.document_id
         AND jps.section_ref = jptl.journey_pattern_section_ref
        JOIN transxchange_journey_patterns jp
          ON jp.document_id = jps.document_id
         AND jp.journey_pattern_id = jps.journey_pattern_id
        JOIN transxchange_services s
          ON s.document_id = jp.document_id
         AND s.service_code = jp.service_code
        WHERE selected_service.service_id = ?
          AND s.mode = 'ferry'
          AND sp_from.stop_point_id IS NOT NULL
          AND sp_to.stop_point_id IS NOT NULL
          AND lower(selected_service.route) NOT LIKE '%freight%'
          AND NOT EXISTS (
              SELECT 1
              FROM transxchange_service_mappings sm
              WHERE sm.service_id = selected_service.service_id
          )
        LIMIT 1
    )
    SELECT EXISTS(SELECT 1 FROM mapped_service)
        OR EXISTS(SELECT 1 FROM heuristic_service) AS available
  `).get(serviceId, serviceId) as { available: number };

  return row.available !== 0;
}

type InstallationRow = {
  push_enabled: number;
};

type CountRow = {
  count: number;
};

function isoTimestamp(date: Date): string {
  return date.toISOString();
}

function shiftedIsoTimestamp(now: Date, deltaMs: number): string {
  return new Date(now.getTime() + deltaMs).toISOString();
}
