import { API_BASE } from "../constants";
import type { ApiService, Service, ServiceStatus } from "../types";

function toStatus(value: number): ServiceStatus {
  if (value === 0) return "normal";
  if (value === 1) return "disrupted";
  if (value === 2) return "cancelled";
  return "unknown";
}

function toService(raw: ApiService): Service {
  return {
    serviceId: raw.service_id,
    status: toStatus(raw.status),
    area: raw.area,
    route: raw.route,
    disruptionReason: raw.disruption_reason,
    lastUpdatedDate: raw.last_updated_date,
    updated: raw.updated,
    additionalInfo: raw.additional_info,
    locations: (raw.locations ?? []).map((location) => ({
      id: location.id,
      name: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      weather: location.weather
        ? {
            description: location.weather.description,
            icon: location.weather.icon,
            temperatureCelsius: location.weather.temperature_celsius,
            windSpeedMph: location.weather.wind_speed_mph,
            windDirection: location.weather.wind_direction,
            windDirectionCardinal: location.weather.wind_direction_cardinal
          }
        : null,
      scheduledDepartures: (location.scheduled_departures ?? []).map((departure) => ({
        departure: departure.departure,
        arrival: departure.arrival,
        destination: departure.destination
      })),
      nextDeparture: location.next_departure
        ? {
            departure: location.next_departure.departure,
            arrival: location.next_departure.arrival,
            destination: location.next_departure.destination
          }
        : null,
      nextRailDeparture: location.next_rail_departure
        ? {
            from: location.next_rail_departure.from,
            to: location.next_rail_departure.to,
            departure: location.next_rail_departure.departure,
            departureInfo: location.next_rail_departure.departure_info,
            isCancelled: location.next_rail_departure.is_cancelled,
            platform: location.next_rail_departure.platform
          }
        : null
    })),
    vessels: (raw.vessels ?? []).map((vessel) => ({
      latitude: vessel.latitude,
      longitude: vessel.longitude,
      name: vessel.name,
      speed: vessel.speed,
      course: vessel.course,
      lastReceived: vessel.last_received ?? null
    })),
    operator: raw.operator
      ? {
          id: raw.operator.id,
          name: raw.operator.name,
          website: raw.operator.website,
          localNumber: raw.operator.local_number,
          internationalNumber: raw.operator.international_number,
          email: raw.operator.email,
          x: raw.operator.x,
          facebook: raw.operator.facebook
        }
      : null,
    scheduledDeparturesAvailable: Boolean(raw.scheduled_departures_available)
  };
}

export async function fetchServices(): Promise<Service[]> {
  const response = await fetch(`${API_BASE}/services/`);
  if (!response.ok) {
    throw new Error(`Failed services request: ${response.status}`);
  }

  const data = (await response.json()) as ApiService[];
  return data.map(toService);
}

export async function fetchService(id: number, dateIso: string): Promise<Service> {
  const url = new URL(`${API_BASE}/services/${id}`, window.location.origin);
  url.searchParams.set("departuresDate", dateIso);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed service request: ${response.status}`);
  }

  const data = (await response.json()) as ApiService;
  return toService(data);
}
