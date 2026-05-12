import type {
  LocationResponse,
  LocationWeatherResponse,
  OrganisationResponse,
  RailDepartureResponse,
  ServiceResponse,
  TimetableDocumentResponse,
  VesselResponse
} from "../types/api.js";

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key];
    }
  }
  return value;
}

function organisationToApi(organisation: OrganisationResponse): Record<string, unknown> {
  return withoutUndefined({
    id: organisation.id,
    name: organisation.name,
    website: organisation.website,
    local_number: organisation.localNumber,
    international_number: organisation.internationalNumber,
    email: organisation.email,
    x: organisation.x,
    facebook: organisation.facebook
  });
}

function weatherToApi(weather: LocationWeatherResponse): Record<string, unknown> {
  return {
    icon: weather.icon,
    description: weather.description,
    temperature_celsius: weather.temperatureCelsius,
    wind_speed_mph: weather.windSpeedMph,
    wind_direction: weather.windDirection,
    wind_direction_cardinal: weather.windDirectionCardinal
  };
}

function railDepartureToApi(departure: RailDepartureResponse): Record<string, unknown> {
  return withoutUndefined({
    from: departure.from,
    to: departure.to,
    departure: departure.departure,
    departure_info: departure.departureInfo,
    platform: departure.platform,
    is_cancelled: departure.isCancelled
  });
}

function locationToApi(location: LocationResponse): Record<string, unknown> {
  return withoutUndefined({
    id: location.id,
    name: location.name,
    latitude: location.latitude,
    longitude: location.longitude,
    scheduled_departures: location.scheduledDepartures?.map(departureToApi),
    next_departure: location.nextDeparture ? departureToApi(location.nextDeparture) : undefined,
    next_rail_departure: location.nextRailDeparture ? railDepartureToApi(location.nextRailDeparture) : undefined,
    weather: location.weather ? weatherToApi(location.weather) : undefined
  });
}

function departureToApi(departure: { destination: LocationResponse; departure: string; arrival: string; notes?: string }): Record<string, unknown> {
  return withoutUndefined({
    destination: locationToApi(departure.destination),
    departure: departure.departure,
    arrival: departure.arrival,
    notes: departure.notes
  });
}

export function vesselToApi(vessel: VesselResponse): Record<string, unknown> {
  return withoutUndefined({
    mmsi: vessel.mmsi,
    name: vessel.name,
    speed: vessel.speed,
    course: vessel.course,
    latitude: vessel.latitude,
    longitude: vessel.longitude,
    last_received: vessel.lastReceived
  });
}

export function timetableDocumentToApi(document: TimetableDocumentResponse): Record<string, unknown> {
  return withoutUndefined({
    id: document.id,
    organisation_id: document.organisationId,
    organisation_name: document.organisationName,
    service_ids: document.serviceIds,
    title: document.title,
    source_url: document.sourceUrl,
    content_hash: document.contentHash,
    content_type: document.contentType,
    content_length: document.contentLength,
    last_seen_at: document.lastSeenAt,
    updated: document.updated
  });
}

export function serviceToApi(service: ServiceResponse): Record<string, unknown> {
  return withoutUndefined({
    service_id: service.serviceId,
    area: service.area,
    route: service.route,
    status: service.status,
    locations: service.locations.map(locationToApi),
    additional_info: service.additionalInfo,
    disruption_reason: service.disruptionReason,
    last_updated_date: service.lastUpdatedDate,
    vessels: service.vessels.map(vesselToApi),
    operator: service.operator ? organisationToApi(service.operator) : undefined,
    scheduled_departures_available: service.scheduledDeparturesAvailable,
    updated: service.updated,
    timetable_documents: service.timetableDocuments?.map(timetableDocumentToApi)
  });
}
