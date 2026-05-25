import type {
  LocationResponse,
  LocationWeatherResponse,
  OrganisationResponse,
  RailDepartureResponse,
  ReliabilityPeriodResponse,
  ReliabilityResponse,
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

function locationToApi(location: LocationResponse, options: { includeDetails?: boolean } = {}): Record<string, unknown> {
  return withoutUndefined({
    id: location.id,
    name: location.name,
    latitude: location.latitude,
    longitude: location.longitude,
    scheduled_departures: options.includeDetails === false ? undefined : location.scheduledDepartures?.map(departureToApi),
    next_departure: options.includeDetails === false || !location.nextDeparture ? undefined : departureToApi(location.nextDeparture),
    next_rail_departure: options.includeDetails === false || !location.nextRailDeparture ? undefined : railDepartureToApi(location.nextRailDeparture),
    weather: options.includeDetails === false || !location.weather ? undefined : weatherToApi(location.weather)
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

function locationReferenceToApi(location: { id: number; name: string; latitude: number; longitude: number }): Record<string, unknown> {
  return {
    id: location.id,
    name: location.name,
    latitude: location.latitude,
    longitude: location.longitude
  };
}

export function vesselToApi(vessel: VesselResponse): Record<string, unknown> {
  return withoutUndefined({
    mmsi: vessel.mmsi,
    name: vessel.name,
    speed: vessel.speed,
    course: vessel.course,
    latitude: vessel.latitude,
    longitude: vessel.longitude,
    last_received: vessel.lastReceived,
    voyage: vessel.voyage
      ? {
          origin_location: locationReferenceToApi(vessel.voyage.originLocation),
          destination_location: locationReferenceToApi(vessel.voyage.destinationLocation),
          departed_at: vessel.voyage.departedAt,
          eta: vessel.voyage.eta,
          progress: vessel.voyage.progress
        }
      : undefined
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

function reliabilityPeriodToApi(period: ReliabilityPeriodResponse): Record<string, unknown> {
  return {
    period: period.period,
    start: period.start,
    end: period.end,
    total_sailings: period.totalSailings,
    statuses: {
      normal: period.statuses.normal,
      disrupted: period.statuses.disrupted,
      cancelled: period.statuses.cancelled
    }
  };
}

function reliabilityToApi(reliability: ReliabilityResponse): Record<string, unknown> {
  return {
    status_breakdown: {
      last_7_days: reliabilityPeriodToApi(reliability.statusBreakdown.last7Days),
      last_30_days: reliabilityPeriodToApi(reliability.statusBreakdown.last30Days)
    }
  };
}

export function serviceToApi(
  service: ServiceResponse,
  options: { includeAdditionalInfo?: boolean; includeLocationDetails?: boolean; includeVessels?: boolean } = {}
): Record<string, unknown> {
  return withoutUndefined({
    service_id: service.serviceId,
    area: service.area,
    route: service.route,
    status: service.status,
    locations: service.locations.map((location) => locationToApi(location, { includeDetails: options.includeLocationDetails })),
    additional_info: options.includeAdditionalInfo === false ? undefined : service.additionalInfo,
    disruption_reason: service.disruptionReason,
    last_updated_date: service.lastUpdatedDate,
    vessels: options.includeVessels === false ? [] : service.vessels.map(vesselToApi),
    operator: service.operator ? organisationToApi(service.operator) : undefined,
    scheduled_departures_available: service.scheduledDeparturesAvailable,
    updated: service.updated,
    timetable_documents: service.timetableDocuments?.map(timetableDocumentToApi),
    reliability: service.reliability ? reliabilityToApi(service.reliability) : undefined
  });
}
