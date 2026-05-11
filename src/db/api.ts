import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type {
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

function value<T>(input: Nullable<T>): T | undefined {
  return input ?? undefined;
}

function parseSqlTimestamp(timestamp: string): Date {
  return new Date(`${timestamp.replace(" ", "T")}Z`);
}

function timestampResponse(timestamp: string): string {
  return parseSqlTimestamp(timestamp).toISOString();
}

function optionalTimestampResponse(timestamp: Nullable<string>): string | undefined {
  return timestamp ? timestampResponse(timestamp) : undefined;
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
    temperature_celsius: Math.round(row.temperature - 273.15),
    wind_speed_mph: Math.round(row.wind_speed * 2.236936284),
    wind_direction: row.wind_direction,
    wind_direction_cardinal: cardinalDirection(row.wind_direction)
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
    last_received: timestampResponse(row.last_received)
  };
}

function isRecent(timestamp: string, now = new Date()): boolean {
  return now.getTime() - parseSqlTimestamp(timestamp).getTime() < 30 * 60 * 1000;
}

function createLocationLookup(db: Database.Database): Map<number, LocationResponse[]> {
  const weatherByLocation = new Map(
    db.prepare("SELECT location_id, description, icon, temperature, wind_speed, wind_direction FROM location_weather").all().map((row) => {
      const weather = row as WeatherRow;
      return [weather.location_id, weatherResponse(weather)] as const;
    })
  );

  const nextRailByLocation = new Map<number, RailDepartureResponse>();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  for (const row of db.prepare(`
    SELECT location_id, departure_name, destination_name, scheduled_departure_time, estimated_departure_time, cancelled, platform
    FROM rail_departures
    WHERE datetime(created) > datetime('now', '-5 minutes')
    ORDER BY scheduled_departure_time
  `).all() as RailDepartureRow[]) {
    const departure = `${today}T${row.scheduled_departure_time.replace(" ", "T").split("T").pop()}Z`;
    if (!nextRailByLocation.has(row.location_id) && new Date(departure) > now) {
      nextRailByLocation.set(row.location_id, {
        from: row.departure_name,
        to: row.destination_name,
        departure,
        departure_info: row.estimated_departure_time,
        platform: value(row.platform),
        is_cancelled: row.cancelled !== 0
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
      weather: weatherByLocation.get(row.location_id),
      next_rail_departure: nextRailByLocation.get(row.location_id)
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
    local_number: value(row.local_phone),
    international_number: value(row.international_phone),
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
    locations: Map<number, LocationResponse[]>;
    organisations: Map<number, OrganisationResponse>;
    vessels: Map<number, VesselResponse[]>;
    timetableDocuments?: Map<number, TimetableDocumentResponse[]>;
  },
  now = new Date()
): ServiceResponse {
  return {
    service_id: row.service_id,
    area: row.area,
    route: row.route,
    status: staleStatus(row.status, row.updated, now),
    locations: lookups.locations.get(row.service_id) ?? [],
    additional_info: value(row.additional_info),
    disruption_reason: value(row.disruption_reason),
    last_updated_date: optionalTimestampResponse(row.last_updated_date),
    vessels: lookups.vessels.get(row.service_id) ?? [],
    operator: lookups.organisations.get(row.service_id),
    scheduled_departures_available: false,
    updated: timestampResponse(row.updated),
    timetable_documents: lookups.timetableDocuments === undefined ? undefined : lookups.timetableDocuments.get(row.service_id) ?? []
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
    organisation_id: row.organisation_id,
    organisation_name: row.organisation_name,
    service_ids: serviceIdsByDocument.get(row.timetable_document_id) ?? [],
    title: row.title,
    source_url: row.source_url,
    content_hash: value(row.content_hash),
    content_type: value(row.content_type),
    content_length: value(row.content_length),
    last_seen_at: timestampResponse(row.last_seen_at),
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

export function listServices(db: Database.Database): ServiceResponse[] {
  const now = new Date();
  const rows = db.prepare(`
    SELECT service_id, area, route, status, additional_info, disruption_reason, organisation_id, last_updated_date, updated
    FROM services
    WHERE visible = 1
    ORDER BY area, route
  `).all() as ServiceRow[];

  const lookups = {
    locations: createLocationLookup(db),
    organisations: createOrganisationLookup(db),
    vessels: createServiceVesselLookup(db, now)
  };

  return rows.map((row) => serviceResponse(row, lookups, now));
}

export function getService(db: Database.Database, serviceId: number): ServiceResponse | null {
  const row = db.prepare(`
    SELECT service_id, area, route, status, additional_info, disruption_reason, organisation_id, last_updated_date, updated
    FROM services
    WHERE service_id = ? AND visible = 1
  `).get(serviceId) as ServiceRow | undefined;

  if (!row) {
    return null;
  }

  const now = new Date();
  return serviceResponse(row, {
    locations: createLocationLookup(db),
    organisations: createOrganisationLookup(db),
    vessels: createServiceVesselLookup(db, now),
    timetableDocuments: createTimetableDocumentLookup(db)
  }, now);
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
