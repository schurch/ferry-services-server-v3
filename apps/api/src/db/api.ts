import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type {
  DepartureResponse,
  LocationResponse,
  LocationWeatherResponse,
  OrganisationResponse,
  RailDepartureResponse,
  ServiceResponse,
  ServiceStatus,
  TimetableDocumentResponse,
  VesselResponse
} from "../types/api.js";

type Nullable<T> = T | null;

type ServiceRow = {
  service_id: number;
  area: string;
  route: string;
  status: ServiceStatus;
  additional_info: Nullable<string>;
  disruption_reason: Nullable<string>;
  organisation_id: number;
  last_updated_date: Nullable<string>;
  updated: string;
};

type LocationRow = {
  service_id: number;
  location_id: number;
  name: string;
  latitude: number;
  longitude: number;
};

type WeatherRow = {
  location_id: number;
  description: string;
  icon: string;
  temperature: number;
  wind_speed: number;
  wind_direction: number;
};

type OrganisationRow = {
  service_id: number;
  organisation_id: number;
  name: string;
  website: Nullable<string>;
  local_phone: Nullable<string>;
  international_phone: Nullable<string>;
  email: Nullable<string>;
  x: Nullable<string>;
  facebook: Nullable<string>;
};

type VesselRow = {
  service_id?: number;
  mmsi: number;
  name: string;
  speed: Nullable<number>;
  course: Nullable<number>;
  latitude: number;
  longitude: number;
  last_received: string;
};

type RailDepartureRow = {
  location_id: number;
  departure_name: string;
  destination_name: string;
  scheduled_departure_time: string;
  estimated_departure_time: string;
  cancelled: number;
  platform: Nullable<string>;
};

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

function value<T>(input: Nullable<T>): T | undefined {
  return input ?? undefined;
}

function parseSqlTimestamp(timestamp: string): Date {
  return new Date(`${timestamp.replace(" ", "T")}Z`);
}

function sqlTimestamp(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function timeWithSeconds(time: string): string {
  return /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
}

function utcIsoResponse(datePart: string, timePart: string): string {
  return new Date(`${datePart}T${timePart}Z`).toISOString();
}

function timestampResponse(timestamp: string): string {
  return parseSqlTimestamp(timestamp).toISOString();
}

function optionalTimestampResponse(timestamp: Nullable<string>): string | undefined {
  return timestamp ? timestampResponse(timestamp) : undefined;
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDateString(value: string | undefined, fallback = new Date()): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : dateString(fallback);
}

function staleStatus(status: ServiceStatus, updated: string, now = new Date()): ServiceStatus {
  return now.getTime() - parseSqlTimestamp(updated).getTime() > 30 * 60 * 1000 ? -99 : status;
}

function cardinalDirection(degrees: number): string {
  const cardinals = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return cardinals[Math.floor((degrees + 11.25) / 22.5) % cardinals.length] ?? "N";
}

function weatherResponse(row: WeatherRow): LocationWeatherResponse {
  return {
    icon: row.icon,
    description: row.description.charAt(0).toUpperCase() + row.description.slice(1).toLowerCase(),
    temperatureCelsius: Math.round(row.temperature - 273.15),
    windSpeedMph: Math.round(row.wind_speed * 2.236936284),
    windDirection: row.wind_direction,
    windDirectionCardinal: cardinalDirection(row.wind_direction)
  };
}

function vesselResponse(row: VesselRow): VesselResponse {
  return {
    mmsi: row.mmsi,
    name: row.name,
    speed: value(row.speed),
    course: value(row.course),
    latitude: row.latitude,
    longitude: row.longitude,
    lastReceived: timestampResponse(row.last_received)
  };
}

function isRecent(timestamp: string, now = new Date()): boolean {
  return now.getTime() - parseSqlTimestamp(timestamp).getTime() < 30 * 60 * 1000;
}

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

function weekday(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

function dateUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function firstMondayOfMonth(year: number, month: number): Date {
  for (let day = 1; day <= 7; day += 1) {
    const candidate = dateUtc(year, month, day);
    if (weekday(candidate) === 1) return candidate;
  }
  return dateUtc(year, month, 1);
}

function lastMondayOfMonth(year: number, month: number): Date {
  const monthEnd = addDays(month === 12 ? dateUtc(year + 1, 1, 1) : dateUtc(year, month + 1, 1), -1);
  for (let offset = 0; offset <= 6; offset += 1) {
    const candidate = addDays(monthEnd, -offset);
    if (weekday(candidate) === 1) return candidate;
  }
  return monthEnd;
}

function gregorianEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = ((19 * a) + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + (2 * e) + (2 * i) - h - k) % 7;
  const m = Math.floor((a + (11 * h) + (22 * l)) / 451);
  const month = Math.floor((h + l - (7 * m) + 114) / 31);
  const day = ((h + l - (7 * m) + 114) % 31) + 1;
  return dateUtc(year, month, day);
}

function observedNewYearsDay(year: number): Date {
  const day = dateUtc(year, 1, 1);
  if (weekday(day) === 6) return dateUtc(year, 1, 3);
  if (weekday(day) === 7) return dateUtc(year, 1, 2);
  return day;
}

function observedJan2ndScotland(year: number): Date {
  const day = dateUtc(year, 1, 2);
  if (weekday(day) === 6) return dateUtc(year, 1, 4);
  if (weekday(day) === 7) return dateUtc(year, 1, 3);
  return day;
}

function observedChristmasDay(year: number): Date {
  const day = dateUtc(year, 12, 25);
  return weekday(day) === 6 || weekday(day) === 7 ? dateUtc(year, 12, 27) : day;
}

function observedBoxingDay(year: number): Date {
  const day = dateUtc(year, 12, 26);
  if (weekday(day) === 6 || weekday(day) === 7) return dateUtc(year, 12, 28);
  return dateString(observedChristmasDay(year)) === dateString(day) ? dateUtc(year, 12, 27) : day;
}

function observedStAndrewsDay(year: number): Date {
  const day = dateUtc(year, 11, 30);
  if (weekday(day) === 6) return dateUtc(year, 12, 2);
  if (weekday(day) === 7) return dateUtc(year, 12, 1);
  return day;
}

function specificScottishBankHolidays(year: number): Array<[string, Date]> {
  const easterSunday = gregorianEasterSunday(year);
  return [
    ["new_years_day", dateUtc(year, 1, 1)],
    ["new_years_day_holiday", observedNewYearsDay(year)],
    ["jan2nd_scotland", observedJan2ndScotland(year)],
    ["good_friday", addDays(easterSunday, -2)],
    ["easter_monday", addDays(easterSunday, 1)],
    ["may_day", firstMondayOfMonth(year, 5)],
    ["spring_bank", lastMondayOfMonth(year, 5)],
    ["august_bank_holiday_scotland", firstMondayOfMonth(year, 8)],
    ["late_summer_bank_holiday_not_scotland", lastMondayOfMonth(year, 8)],
    ["st_andrews_day", observedStAndrewsDay(year)],
    ["christmas_day", dateUtc(year, 12, 25)],
    ["christmas_day_holiday", observedChristmasDay(year)],
    ["boxing_day", dateUtc(year, 12, 26)],
    ["boxing_day_holiday", observedBoxingDay(year)]
  ];
}

function isAnyScottishBankHoliday(date: Date): boolean {
  const year = date.getUTCFullYear();
  return specificScottishBankHolidays(year).some(([, day]) => dateString(day) === dateString(date));
}

function isDisplacementHoliday(date: Date): boolean {
  const year = date.getUTCFullYear();
  const observed = [
    [observedNewYearsDay(year), dateUtc(year, 1, 1)],
    [observedJan2ndScotland(year), dateUtc(year, 1, 2)],
    [observedStAndrewsDay(year), dateUtc(year, 11, 30)],
    [observedChristmasDay(year), dateUtc(year, 12, 25)],
    [observedBoxingDay(year), dateUtc(year, 12, 26)]
  ];
  return observed.some(([holiday, base]) => dateString(date) === dateString(holiday) && dateString(holiday) !== dateString(base));
}

function matchedWeekOfMonthRulesForDate(queryDate: string): string[] {
  const date = new Date(`${queryDate}T00:00:00Z`);
  const dayOfMonth = date.getUTCDate();
  const ordinal = ["first", "second", "third", "fourth"][Math.floor((dayOfMonth - 1) / 7)] ?? "fifth";
  const nextWeek = addDays(date, 7);
  const last = date.getUTCFullYear() !== nextWeek.getUTCFullYear() || date.getUTCMonth() !== nextWeek.getUTCMonth();
  return last ? ["every_week", ordinal, "last"] : ["every_week", ordinal];
}

function matchedBankHolidayRulesForDate(queryDate: string): string[] {
  const date = new Date(`${queryDate}T00:00:00Z`);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const anyBankHoliday = isAnyScottishBankHoliday(date);
  return [...new Set([
    ...(anyBankHoliday ? ["all_bank_holidays", "other_public_holiday"] : []),
    ...specificScottishBankHolidays(year).filter(([, holiday]) => dateString(holiday) === queryDate).map(([rule]) => rule),
    ...(isDisplacementHoliday(date) ? ["displacement_holidays"] : []),
    ...(weekday(date) === 1 && anyBankHoliday ? ["holiday_mondays"] : []),
    ...(anyBankHoliday && !(month === 12 && (day === 25 || dateString(observedChristmasDay(year)) === queryDate)) ? ["all_holidays_except_christmas"] : []),
    ...(!anyBankHoliday ? ["no_holidays"] : []),
    ...(month === 12 && day === 24 ? ["christmas_eve"] : []),
    ...(month === 12 && day === 31 ? ["new_years_eve"] : []),
    ...((month === 12 && (day === 24 || day === 31)) ? ["early_run_off_days"] : [])
  ])];
}

function padTo<T>(size: number, filler: T, values: T[]): T[] {
  return [...values, ...Array(size).fill(filler)].slice(0, size);
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
      nextRailByLocation.set(row.location_id, {
        from: row.departure_name,
        to: row.destination_name,
        departure,
        departureInfo: row.estimated_departure_time,
        platform: value(row.platform),
        isCancelled: row.cancelled !== 0
      });
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
    locations.push({
      id: row.location_id,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      scheduledDepartures: scheduledDepartures.has(row.location_id) ? scheduledDepartures.get(row.location_id) ?? [] : undefined,
      nextDeparture: nextDepartures.get(row.location_id),
      weather: weatherByLocation.get(row.location_id),
      nextRailDeparture: nextRailByLocation.get(row.location_id)
    });
    lookup.set(row.service_id, locations);
  }
  return lookup;
}

function createOrganisationLookup(db: Database.Database): Map<number, OrganisationResponse> {
  const rows = db.prepare(`
    SELECT s.service_id, o.organisation_id, o.name, o.website, o.local_phone, o.international_phone, o.email, o.x, o.facebook
    FROM services s
    JOIN organisations o ON o.organisation_id = s.organisation_id
  `).all() as OrganisationRow[];

  return new Map(rows.map((row) => [row.service_id, {
    id: row.organisation_id,
    name: row.name,
    website: value(row.website),
    localNumber: value(row.local_phone),
    internationalNumber: value(row.international_phone),
    email: value(row.email),
    x: value(row.x),
    facebook: value(row.facebook)
  }]));
}

function createServiceVesselLookup(db: Database.Database, now = new Date()): Map<number, VesselResponse[]> {
  const rows = db.prepare(`
    WITH bounding_box AS (
      SELECT
        sl.service_id,
        MIN(l.latitude) - 0.02 AS min_latitude,
        MAX(l.latitude) + 0.02 AS max_latitude,
        MIN(l.longitude) - 0.02 AS min_longitude,
        MAX(l.longitude) + 0.02 AS max_longitude
      FROM locations l
      JOIN service_locations sl ON l.location_id = sl.location_id
      GROUP BY sl.service_id
    )
    SELECT s.service_id, v.mmsi, v.name, v.speed, v.course, v.latitude, v.longitude, v.last_received
    FROM vessels v
    JOIN bounding_box b
    JOIN services s ON s.service_id = b.service_id
    WHERE v.latitude BETWEEN b.min_latitude AND b.max_latitude
      AND v.longitude BETWEEN b.min_longitude AND b.max_longitude
      AND s.organisation_id = v.organisation_id
  `).all() as VesselRow[];

  const lookup = new Map<number, VesselResponse[]>();
  for (const row of rows) {
    if (row.service_id === undefined || !isRecent(row.last_received, now)) {
      continue;
    }
    const vessels = lookup.get(row.service_id) ?? [];
    vessels.push(vesselResponse(row));
    lookup.set(row.service_id, vessels);
  }
  return lookup;
}

function serviceResponse(
  row: ServiceRow,
  lookups: {
    scheduledServices: Set<number>;
    locations: Map<number, LocationResponse[]>;
    organisations: Map<number, OrganisationResponse>;
    vessels: Map<number, VesselResponse[]>;
    timetableDocuments?: Map<number, TimetableDocumentResponse[]>;
  },
  now = new Date()
): ServiceResponse {
  return {
    serviceId: row.service_id,
    area: row.area,
    route: row.route,
    status: staleStatus(row.status, row.updated, now),
    locations: lookups.locations.get(row.service_id) ?? [],
    additionalInfo: value(row.additional_info),
    disruptionReason: value(row.disruption_reason),
    lastUpdatedDate: optionalTimestampResponse(row.last_updated_date),
    vessels: lookups.vessels.get(row.service_id) ?? [],
    operator: lookups.organisations.get(row.service_id),
    scheduledDeparturesAvailable: lookups.scheduledServices.has(row.service_id),
    updated: timestampResponse(row.updated),
    timetableDocuments: lookups.timetableDocuments === undefined ? undefined : lookups.timetableDocuments.get(row.service_id) ?? []
  };
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

  const links = db.prepare(`
    SELECT timetable_document_id, service_id
    FROM timetable_document_services
    ORDER BY timetable_document_id, service_id
  `).all() as TimetableDocumentServiceLinkRow[];

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
    contentHash: value(row.content_hash),
    contentType: value(row.content_type),
    contentLength: value(row.content_length),
    lastSeenAt: timestampResponse(row.last_seen_at),
    updated: timestampResponse(row.updated)
  }));
}

function createTimetableDocumentLookup(db: Database.Database): Map<number, TimetableDocumentResponse[]> {
  const documents = new Map(createTimetableDocumentResponses(db).map((document) => [document.id, document]));
  const links = db.prepare(`
    SELECT timetable_document_id, service_id
    FROM timetable_document_services
    ORDER BY timetable_document_id, service_id
  `).all() as TimetableDocumentServiceLinkRow[];

  const lookup = new Map<number, TimetableDocumentResponse[]>();
  for (const link of links) {
    const document = documents.get(link.timetable_document_id);
    if (!document) {
      continue;
    }
    const serviceDocuments = lookup.get(link.service_id) ?? [];
    serviceDocuments.push(document);
    lookup.set(link.service_id, serviceDocuments);
  }
  return lookup;
}

function departureQueryParams(queryDate: string, serviceId: number): Array<string | number> {
  const weekOfMonthRules = matchedWeekOfMonthRulesForDate(queryDate);
  const bankHolidayRules = matchedBankHolidayRulesForDate(queryDate);
  const paddedBankHolidayRules = padTo(12, "__no_matching_bank_holiday__", bankHolidayRules);
  return [
    queryDate,
    serviceId,
    serviceId,
    serviceId,
    ...padTo(4, "__no_matching_week_of_month__", weekOfMonthRules),
    bankHolidayRules.length > 0 ? 1 : 0,
    ...paddedBankHolidayRules,
    ...paddedBankHolidayRules
  ];
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
    notes: value(row.notes)
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

export function listLocationDepartures(db: Database.Database, serviceId: number, queryDate: string): DepartureResponse[] {
  return listLocationDepartureRows(db, serviceId, queryDate).map(departureResponseFromRow);
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
    vessels: createServiceVesselLookup(db, now)
  };

  return rows.map((row) => serviceResponse(row, lookups, now));
}

export function getService(db: Database.Database, serviceId: number, departuresDate?: string): ServiceResponse | null {
  const row = db.prepare(`
    SELECT service_id, area, route, status, additional_info, disruption_reason, organisation_id, last_updated_date, updated
    FROM services
    WHERE service_id = ? AND visible = 1
  `).get(serviceId) as ServiceRow | undefined;

  if (!row) {
    return null;
  }

  const now = new Date();
  const queryDate = parseDateString(departuresDate, now);
  const locationDepartures = createLocationDepartureLookup(db, serviceId, queryDate);
  const nextDepartures = createLocationDepartureLookup(db, serviceId, dateString(now));
  const nextDepartureLookup = new Map([...nextDepartures].map(([locationId, departures]) => [
    locationId,
    [...departures]
      .sort((left, right) => new Date(left.departure).getTime() - new Date(right.departure).getTime())
      .find((departure) => new Date(departure.departure) > now)
  ]).filter((entry): entry is [number, DepartureResponse] => entry[1] !== undefined));
  const scheduledServices = listServicesWithScheduledDepartures(db);
  return serviceResponse(row, {
    scheduledServices,
    locations: createLocationLookup(db, locationDepartures, nextDepartureLookup),
    organisations: createOrganisationLookup(db),
    vessels: createServiceVesselLookup(db, now),
    timetableDocuments: createTimetableDocumentLookup(db)
  }, now);
}

export function listInstallationServices(db: Database.Database, installationId: string): ServiceResponse[] {
  const now = new Date();
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
    vessels: createServiceVesselLookup(db, now)
  };

  return rows.map((row) => serviceResponse(row, lookups, now));
}

export function listVessels(db: Database.Database): VesselResponse[] {
  const now = new Date();
  const rows = db.prepare(`
    SELECT mmsi, name, speed, course, latitude, longitude, last_received
    FROM vessels
  `).all() as VesselRow[];

  return rows.filter((row) => isRecent(row.last_received, now)).map(vesselResponse);
}

export function listTimetableDocuments(db: Database.Database, serviceId?: number): TimetableDocumentResponse[] {
  return createTimetableDocumentResponses(db, serviceId);
}

export function etagForJson(value: unknown): string {
  return `"sha256-${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`;
}
