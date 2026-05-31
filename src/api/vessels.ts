import { optionalTimestampResponse, parseSqlTimestamp, timestampResponse } from "./time.js";
import type { LocationReferenceResponse, LocationResponse, VesselResponse, VesselVoyageResponse } from "./types.js";

export type VesselRow = {
  service_id?: number;
  mmsi: number;
  name: string;
  speed: number | null;
  course: number | null;
  latitude: number;
  longitude: number;
  last_received: string;
  destination_name: string | null;
  origin_name: string | null;
  origin_departed_at: string | null;
};

export function isRecentVesselPosition(timestamp: string, now = new Date()): boolean {
  return now.getTime() - parseSqlTimestamp(timestamp).getTime() < 30 * 60 * 1000;
}

export function serviceVesselResponse(row: VesselRow, serviceLocations: LocationResponse[], now: Date): VesselResponse | undefined {
  const voyage = vesselVoyageResponse(row, serviceLocations, now);
  if (voyage === undefined && hasMismatchedRouteIdentity(row, serviceLocations)) {
    return undefined;
  }
  return vesselResponse(row, voyage && !isCompletedVoyage(row, voyage, now) ? serviceLocations : undefined, now);
}

function value<T>(input: T | null): T | undefined {
  return input ?? undefined;
}

function vesselResponse(row: VesselRow, serviceLocations?: LocationResponse[], now = new Date()): VesselResponse {
  const voyage = serviceLocations ? vesselVoyageResponse(row, serviceLocations, now) : undefined;
  return {
    mmsi: row.mmsi,
    name: row.name,
    ...(row.speed !== null ? { speed: row.speed } : {}),
    ...(row.course !== null ? { course: row.course } : {}),
    latitude: row.latitude,
    longitude: row.longitude,
    lastReceived: timestampResponse(row.last_received),
    ...(voyage !== undefined ? { voyage } : {})
  };
}

function hasMismatchedRouteIdentity(row: VesselRow, serviceLocations: LocationResponse[]): boolean {
  const originName = value(row.origin_name);
  const destinationName = value(row.destination_name);
  if (originName === undefined || destinationName === undefined) {
    return false;
  }

  const originLocation = matchServiceLocation(serviceLocations, originName);
  const destinationLocation = matchServiceLocation(serviceLocations, destinationName)
    ?? routeShorthandDestination(serviceLocations, originLocation, destinationName);
  return originLocation === undefined || destinationLocation === undefined;
}

function vesselVoyageResponse(row: VesselRow, serviceLocations: LocationResponse[], now = new Date()): VesselVoyageResponse | undefined {
  const originName = value(row.origin_name);
  const departedAt = optionalTimestampResponse(row.origin_departed_at);
  const reportedDestinationName = value(row.destination_name);

  if (originName === undefined || departedAt === undefined) {
    return undefined;
  }

  const originLocation = matchServiceLocation(serviceLocations, originName);
  const destinationLocation = reportedDestinationName
    ? matchServiceLocation(serviceLocations, reportedDestinationName)
      ?? routeShorthandDestination(serviceLocations, originLocation, reportedDestinationName)
    : undefined;
  if (originLocation === undefined || destinationLocation === undefined || originLocation.id === destinationLocation.id) {
    return undefined;
  }

  const matchedVoyage = matchedScheduledVoyage(serviceLocations, originLocation, destinationLocation, row, now);
  if (!hasFreshVoyagePosition(row, originLocation, destinationLocation, matchedVoyage, now)) {
    return undefined;
  }

  const estimatedArrival = voyageEstimatedArrival(matchedVoyage, row);
  const progress = computeProgress(originLocation, destinationLocation, row.latitude, row.longitude);
  return {
    originLocation,
    destinationLocation,
    departedAt,
    ...(estimatedArrival !== undefined ? { estimatedArrival } : {}),
    ...(progress !== undefined ? { progress } : {})
  };
}

type ScheduledVoyage = {
  departure: string;
  arrival: string;
  durationMs: number;
};

function voyageEstimatedArrival(matched: ScheduledVoyage | undefined, row: VesselRow): string | undefined {
  if (matched === undefined || row.origin_departed_at === null) {
    return undefined;
  }
  return new Date(parseSqlTimestamp(row.origin_departed_at).getTime() + matched.durationMs).toISOString();
}

function matchedScheduledVoyage(
  serviceLocations: LocationResponse[],
  originLocation: LocationReferenceResponse,
  destinationLocation: LocationReferenceResponse,
  row: VesselRow,
  now: Date
): ScheduledVoyage | undefined {
  const origin = serviceLocations.find((location) => location.id === originLocation.id);
  if (!origin?.scheduledDepartures) {
    return undefined;
  }

  const departedAtMs = parseSqlTimestamp(row.origin_departed_at ?? row.last_received).getTime();
  const lastReceivedMs = parseSqlTimestamp(row.last_received).getTime();
  const minArrivalMs = now.getTime() - (10 * 60 * 1000);
  const candidate = origin.scheduledDepartures
    .filter((departure) => departure.destination.id === destinationLocation.id)
    .map((departure) => ({
      departure: departure.departure,
      arrival: departure.arrival,
      arrivalMs: new Date(departure.arrival).getTime(),
      departureMs: new Date(departure.departure).getTime()
    }))
    .map((departure) => ({ ...departure, durationMs: departure.arrivalMs - departure.departureMs }))
    .filter((departure) => Number.isFinite(departure.durationMs) && departure.durationMs > 0)
    .filter((departure) => (
      departure.departureMs <= Math.min(lastReceivedMs, departedAtMs) + scheduledDepartureFutureToleranceMs(departure.durationMs) &&
      departure.arrivalMs >= minArrivalMs
    ))
    .filter((departure) => Math.abs(departure.departureMs - departedAtMs) <= scheduledDepartureMatchToleranceMs(departure.durationMs))
    .sort((left, right) => Math.abs(left.departureMs - departedAtMs) - Math.abs(right.departureMs - departedAtMs))[0];

  return candidate
    ? { departure: candidate.departure, arrival: candidate.arrival, durationMs: candidate.durationMs }
    : undefined;
}

function scheduledDepartureFutureToleranceMs(durationMs: number): number {
  return Math.min(15 * 60 * 1000, Math.max(2 * 60 * 1000, durationMs * 0.2));
}

function scheduledDepartureMatchToleranceMs(durationMs: number): number {
  return Math.min(15 * 60 * 1000, Math.max(3 * 60 * 1000, durationMs * 0.5));
}

function hasFreshVoyagePosition(
  row: VesselRow,
  originLocation: LocationReferenceResponse,
  destinationLocation: LocationReferenceResponse,
  matchedVoyage: ScheduledVoyage | undefined,
  now: Date
): boolean {
  const ageMs = now.getTime() - parseSqlTimestamp(row.last_received).getTime();
  const maxAgeMs = matchedVoyage
    ? Math.min(30 * 60 * 1000, Math.max(5 * 60 * 1000, matchedVoyage.durationMs * 0.5))
    : routeDistanceFreshnessMs(distanceKm(originLocation, destinationLocation));
  return ageMs <= maxAgeMs;
}

function routeDistanceFreshnessMs(routeDistanceKm: number): number {
  if (routeDistanceKm <= 5) return 5 * 60 * 1000;
  if (routeDistanceKm <= 10) return 10 * 60 * 1000;
  return 30 * 60 * 1000;
}

function isCompletedVoyage(row: VesselRow, voyage: VesselVoyageResponse, now: Date): boolean {
  const graceMs = 10 * 60 * 1000;
  if (voyage.estimatedArrival && now.getTime() - new Date(voyage.estimatedArrival).getTime() > graceMs) return true;
  if (distanceKm(row, voyage.destinationLocation) <= completionRadiusKm(voyage)) return true;
  return voyage.progress === 1 && now.getTime() - parseSqlTimestamp(row.last_received).getTime() > graceMs;
}

function completionRadiusKm(voyage: VesselVoyageResponse): number {
  return Math.min(0.75, Math.max(0.1, distanceKm(voyage.originLocation, voyage.destinationLocation) * 0.15));
}

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const earthRadiusKm = 6371;
  const lat1 = a.latitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const deltaLatitude = (b.latitude - a.latitude) * Math.PI / 180;
  const deltaLongitude = (b.longitude - a.longitude) * Math.PI / 180;
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function computeProgress(
  origin: LocationReferenceResponse,
  destination: LocationReferenceResponse,
  vesselLatitude: number,
  vesselLongitude: number
): number | undefined {
  const meanLatitudeRadians = ((origin.latitude + destination.latitude) / 2) * (Math.PI / 180);
  const scaleX = 111_320 * Math.cos(meanLatitudeRadians);
  const scaleY = 110_540;
  const dx = (destination.longitude - origin.longitude) * scaleX;
  const dy = (destination.latitude - origin.latitude) * scaleY;
  const vx = (vesselLongitude - origin.longitude) * scaleX;
  const vy = (vesselLatitude - origin.latitude) * scaleY;
  const lengthSquared = (dx * dx) + (dy * dy);
  if (!Number.isFinite(lengthSquared) || lengthSquared <= 0) return undefined;

  const clamped = Math.max(0, Math.min(1, ((vx * dx) + (vy * dy)) / lengthSquared));
  if (clamped <= 0.02) return 0;
  if (clamped >= 0.98) return 1;
  return Math.round(clamped * 1000) / 1000;
}

function matchServiceLocation(serviceLocations: LocationResponse[], rawName: string): LocationReferenceResponse | undefined {
  const target = normalizeLocationName(rawName);
  const match = serviceLocations.find((location) => normalizeLocationName(location.name) === target);
  return match
    ? { id: match.id, name: match.name, latitude: match.latitude, longitude: match.longitude }
    : undefined;
}

function normalizeLocationName(value: string): string {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function routeShorthandDestination(
  serviceLocations: LocationResponse[],
  originLocation: LocationReferenceResponse | undefined,
  rawDestination: string
): LocationReferenceResponse | undefined {
  if (originLocation === undefined || serviceLocations.length !== 2 || !/[<>/:-]/.test(rawDestination)) return undefined;
  const other = serviceLocations.find((location) => location.id !== originLocation.id);
  return other ? { id: other.id, name: other.name, latitude: other.latitude, longitude: other.longitude } : undefined;
}
