import { parseSqlTimestamp, timestampResponse } from "./time.js";
import { serviceVesselResponse, type VesselRow } from "./vessels.js";
import type {
  DepartureResponse,
  LocationResponse,
  LocationWeatherResponse,
  OrganisationResponse,
  RailDepartureResponse,
  ReliabilityResponse,
  ServiceResponse,
  ServiceStatus,
  TimetableDocumentResponse
} from "./types.js";

export type ServiceRow = {
  service_id: number;
  area: string;
  route: string;
  status: ServiceStatus;
  additional_info: string | null;
  disruption_reason: string | null;
  organisation_id: number;
  last_updated_date: string | null;
  updated: string;
};

export type LocationRow = {
  service_id: number;
  location_id: number;
  name: string;
  latitude: number;
  longitude: number;
};

export type WeatherRow = {
  location_id: number;
  description: string;
  icon: string;
  temperature: number;
  wind_speed: number;
  wind_direction: number;
};

export type OrganisationRow = {
  service_id: number;
  organisation_id: number;
  name: string;
  website: string | null;
  local_phone: string | null;
  international_phone: string | null;
  email: string | null;
  x: string | null;
  facebook: string | null;
};

export type RailDepartureRow = {
  location_id: number;
  departure_name: string;
  destination_name: string;
  scheduled_departure_time: string;
  estimated_departure_time: string;
  cancelled: number;
  platform: string | null;
};

export function weatherResponse(row: WeatherRow): LocationWeatherResponse {
  return {
    icon: row.icon,
    description: row.description.charAt(0).toUpperCase() + row.description.slice(1).toLowerCase(),
    temperatureCelsius: Math.round(row.temperature - 273.15),
    windSpeedMph: Math.round(row.wind_speed * 2.236936284),
    windDirection: row.wind_direction,
    windDirectionCardinal: cardinalDirection(row.wind_direction)
  };
}

export function railDepartureResponse(row: RailDepartureRow, departure: string): RailDepartureResponse {
  return {
    from: row.departure_name,
    to: row.destination_name,
    departure,
    departureInfo: row.estimated_departure_time,
    ...(row.platform !== null ? { platform: row.platform } : {}),
    isCancelled: row.cancelled !== 0
  };
}

export function locationResponse(
  row: LocationRow,
  lookups: {
    scheduledDepartures: Map<number, DepartureResponse[]>;
    nextDepartures: Map<number, DepartureResponse>;
    weatherByLocation: Map<number, LocationWeatherResponse>;
    nextRailByLocation: Map<number, RailDepartureResponse>;
  }
): LocationResponse {
  const nextDeparture = lookups.nextDepartures.get(row.location_id);
  const weather = lookups.weatherByLocation.get(row.location_id);
  const nextRailDeparture = lookups.nextRailByLocation.get(row.location_id);
  return {
    id: row.location_id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    ...(lookups.scheduledDepartures.has(row.location_id) ? { scheduledDepartures: lookups.scheduledDepartures.get(row.location_id) ?? [] } : {}),
    ...(nextDeparture !== undefined ? { nextDeparture } : {}),
    ...(weather !== undefined ? { weather } : {}),
    ...(nextRailDeparture !== undefined ? { nextRailDeparture } : {})
  };
}

export function organisationResponse(row: OrganisationRow): OrganisationResponse {
  return {
    id: row.organisation_id,
    name: row.name,
    ...(row.website !== null ? { website: row.website } : {}),
    ...(row.local_phone !== null ? { localNumber: row.local_phone } : {}),
    ...(row.international_phone !== null ? { internationalNumber: row.international_phone } : {}),
    ...(row.email !== null ? { email: row.email } : {}),
    ...(row.x !== null ? { x: row.x } : {}),
    ...(row.facebook !== null ? { facebook: row.facebook } : {})
  };
}

export function serviceResponse(
  row: ServiceRow,
  lookups: {
    scheduledServices: Set<number>;
    locations: Map<number, LocationResponse[]>;
    vesselLocations?: Map<number, LocationResponse[]>;
    organisations: Map<number, OrganisationResponse>;
    vessels: Map<number, VesselRow[]>;
    timetableDocuments?: Map<number, TimetableDocumentResponse[]>;
    reliability?: Map<number, ReliabilityResponse>;
  },
  now = new Date()
): ServiceResponse {
  const locations = lookups.locations.get(row.service_id) ?? [];
  const vesselLocations = lookups.vesselLocations?.get(row.service_id) ?? locations;
  const operator = lookups.organisations.get(row.service_id);
  const reliability = lookups.reliability?.get(row.service_id);
  return {
    serviceId: row.service_id,
    area: row.area,
    route: row.route,
    status: staleStatus(row.status, row.updated, now),
    locations,
    ...(row.additional_info !== null ? { additionalInfo: row.additional_info } : {}),
    ...(row.disruption_reason !== null ? { disruptionReason: row.disruption_reason } : {}),
    ...(row.last_updated_date !== null ? { lastUpdatedDate: timestampResponse(row.last_updated_date) } : {}),
    vessels: (lookups.vessels.get(row.service_id) ?? []).flatMap((vessel) => {
      const response = serviceVesselResponse(vessel, vesselLocations, now);
      return response ? [response] : [];
    }),
    ...(operator !== undefined ? { operator } : {}),
    scheduledDeparturesAvailable: lookups.scheduledServices.has(row.service_id),
    updated: timestampResponse(row.updated),
    ...(lookups.timetableDocuments !== undefined ? { timetableDocuments: lookups.timetableDocuments.get(row.service_id) ?? [] } : {}),
    ...(reliability !== undefined ? { reliability } : {})
  };
}

function staleStatus(status: ServiceStatus, updated: string, now = new Date()): ServiceStatus {
  return now.getTime() - parseSqlTimestamp(updated).getTime() > 30 * 60 * 1000 ? -99 : status;
}

function cardinalDirection(degrees: number): string {
  const cardinals = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return cardinals[Math.floor((degrees + 11.25) / 22.5) % cardinals.length] ?? "N";
}
