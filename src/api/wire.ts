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
import type {
  DepartureApiResponse,
  DepartureDestinationApiResponse,
  LocationApiResponse,
  LocationWeatherApiResponse,
  OrganisationApiResponse,
  RailDepartureApiResponse,
  ReliabilityApiResponse,
  ReliabilityPeriodApiResponse,
  ServiceApiResponse,
  ServiceListApiResponse,
  TimetableDocumentApiResponse,
  VesselApiResponse,
  VesselVoyageApiResponse
} from "./schema.js";

// #region Field mappers

function organisationToApi(organisation: OrganisationResponse): OrganisationApiResponse {
  return {
    id: organisation.id,
    name: organisation.name,
    ...(organisation.website !== undefined ? { website: organisation.website } : {}),
    ...(organisation.localNumber !== undefined ? { local_number: organisation.localNumber } : {}),
    ...(organisation.internationalNumber !== undefined ? { international_number: organisation.internationalNumber } : {}),
    ...(organisation.email !== undefined ? { email: organisation.email } : {}),
    ...(organisation.x !== undefined ? { x: organisation.x } : {}),
    ...(organisation.facebook !== undefined ? { facebook: organisation.facebook } : {})
  };
}

function weatherToApi(weather: LocationWeatherResponse): LocationWeatherApiResponse {
  return {
    icon: weather.icon,
    description: weather.description,
    temperature_celsius: weather.temperatureCelsius,
    wind_speed_mph: weather.windSpeedMph,
    wind_direction: weather.windDirection,
    wind_direction_cardinal: weather.windDirectionCardinal
  };
}

function railDepartureToApi(departure: RailDepartureResponse): RailDepartureApiResponse {
  return {
    from: departure.from,
    to: departure.to,
    departure: departure.departure,
    departure_info: departure.departureInfo,
    ...(departure.platform !== undefined ? { platform: departure.platform } : {}),
    is_cancelled: departure.isCancelled
  };
}

function locationToApi(location: LocationResponse, options: { includeDetails?: boolean } = {}): LocationApiResponse {
  return {
    id: location.id,
    name: location.name,
    latitude: location.latitude,
    longitude: location.longitude,
    ...(options.includeDetails !== false && location.scheduledDepartures !== undefined
      ? { scheduled_departures: location.scheduledDepartures.map(departureToApi) }
      : {}),
    ...(options.includeDetails !== false && location.nextDeparture !== undefined
      ? { next_departure: departureToApi(location.nextDeparture) }
      : {}),
    ...(options.includeDetails !== false && location.nextRailDeparture !== undefined
      ? { next_rail_departure: railDepartureToApi(location.nextRailDeparture) }
      : {}),
    ...(options.includeDetails !== false && location.weather !== undefined ? { weather: weatherToApi(location.weather) } : {})
  };
}

function departureToApi(departure: { destination: LocationResponse; departure: string; arrival: string; notes?: string }): DepartureApiResponse {
  return {
    destination: locationReferenceToApi(departure.destination),
    departure: departure.departure,
    arrival: departure.arrival,
    ...(departure.notes !== undefined ? { notes: departure.notes } : {})
  };
}

function locationReferenceToApi(location: { id: number; name: string; latitude: number; longitude: number }): DepartureDestinationApiResponse {
  return {
    id: location.id,
    name: location.name,
    latitude: location.latitude,
    longitude: location.longitude
  };
}

function vesselVoyageToApi(voyage: NonNullable<VesselResponse["voyage"]>): VesselVoyageApiResponse {
  return {
    origin_location: locationReferenceToApi(voyage.originLocation),
    destination_location: locationReferenceToApi(voyage.destinationLocation),
    departed_at: voyage.departedAt,
    ...(voyage.eta !== undefined ? { eta: voyage.eta } : {}),
    ...(voyage.progress !== undefined ? { progress: voyage.progress } : {})
  };
}

function reliabilityPeriodToApi(period: ReliabilityPeriodResponse): ReliabilityPeriodApiResponse {
  return {
    period: period.period,
    start: period.start,
    end: period.end,
    observed_operating_days: period.observedOperatingDays,
    scheduled_sailings: period.scheduledSailings,
    day_statuses: {
      normal: period.dayStatuses.normal,
      disrupted: period.dayStatuses.disrupted,
      cancelled: period.dayStatuses.cancelled
    }
  };
}

function reliabilityToApi(reliability: ReliabilityResponse): ReliabilityApiResponse {
  return {
    status_breakdown: {
      last_7_days: reliabilityPeriodToApi(reliability.statusBreakdown.last7Days),
      last_30_days: reliabilityPeriodToApi(reliability.statusBreakdown.last30Days)
    }
  };
}

// #endregion

// #region Public API

export function vesselToApi(vessel: VesselResponse): VesselApiResponse {
  return {
    mmsi: vessel.mmsi,
    name: vessel.name,
    ...(vessel.speed !== undefined ? { speed: vessel.speed } : {}),
    ...(vessel.course !== undefined ? { course: vessel.course } : {}),
    latitude: vessel.latitude,
    longitude: vessel.longitude,
    last_received: vessel.lastReceived,
    ...(vessel.voyage !== undefined ? { voyage: vesselVoyageToApi(vessel.voyage) } : {})
  };
}

export function timetableDocumentToApi(document: TimetableDocumentResponse): TimetableDocumentApiResponse {
  return {
    id: document.id,
    organisation_id: document.organisationId,
    organisation_name: document.organisationName,
    service_ids: document.serviceIds,
    title: document.title,
    source_url: document.sourceUrl,
    ...(document.contentHash !== undefined ? { content_hash: document.contentHash } : {}),
    ...(document.contentType !== undefined ? { content_type: document.contentType } : {}),
    ...(document.contentLength !== undefined ? { content_length: document.contentLength } : {}),
    last_seen_at: document.lastSeenAt,
    updated: document.updated
  };
}

export function serviceToApi(
  service: ServiceResponse,
  options: { includeAdditionalInfo?: boolean; includeLocationDetails?: boolean; includeVessels?: boolean } = {}
): ServiceApiResponse | ServiceListApiResponse {
  return {
    service_id: service.serviceId,
    area: service.area,
    route: service.route,
    status: service.status,
    locations: service.locations.map((location) => locationToApi(location, options.includeLocationDetails === undefined ? {} : { includeDetails: options.includeLocationDetails })),
    ...(options.includeAdditionalInfo !== false && service.additionalInfo !== undefined ? { additional_info: service.additionalInfo } : {}),
    ...(service.disruptionReason !== undefined ? { disruption_reason: service.disruptionReason } : {}),
    ...(service.lastUpdatedDate !== undefined ? { last_updated_date: service.lastUpdatedDate } : {}),
    ...(options.includeVessels === false ? { vessels: [] } : { vessels: service.vessels.map(vesselToApi) }),
    ...(service.operator !== undefined ? { operator: organisationToApi(service.operator) } : {}),
    scheduled_departures_available: service.scheduledDeparturesAvailable,
    updated: service.updated,
    ...(service.timetableDocuments !== undefined ? { timetable_documents: service.timetableDocuments.map(timetableDocumentToApi) } : {}),
    ...(service.reliability !== undefined ? { reliability: reliabilityToApi(service.reliability) } : {})
  };
}

// #endregion
