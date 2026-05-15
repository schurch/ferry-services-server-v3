export type ServiceStatus = "normal" | "disrupted" | "cancelled" | "unknown";

export type Service = {
  serviceId: number;
  status: ServiceStatus;
  area: string;
  route: string;
  disruptionReason: string | null;
  lastUpdatedDate: string | null;
  updated: string | null;
  additionalInfo: string | null;
  locations: Location[];
  vessels: Vessel[];
  operator: ServiceOperator | null;
  scheduledDeparturesAvailable: boolean;
};

export type Location = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  weather: Weather | null;
  scheduledDepartures: ScheduledDeparture[];
  nextDeparture: ScheduledDeparture | null;
  nextRailDeparture: RailDeparture | null;
};

export type Weather = {
  description: string;
  icon: string;
  temperatureCelsius: number;
  windSpeedMph: number;
  windDirection: number;
  windDirectionCardinal: string;
};

export type ScheduledDeparture = {
  departure: string;
  arrival: string;
  destination: {
    id: number;
    name: string;
    latitude: number;
    longitude: number;
  };
};

export type RailDeparture = {
  from: string;
  to: string;
  departure: string;
  departureInfo: string;
  isCancelled: boolean;
  platform: string | null;
};

export type Vessel = {
  latitude: number;
  longitude: number;
  name: string;
  speed: number | null;
  course: number | null;
  lastReceived: string | null;
};

export type ServiceOperator = {
  id: number;
  name: string;
  website: string | null;
  localNumber: string | null;
  internationalNumber: string | null;
  email: string | null;
  x: string | null;
  facebook: string | null;
};

export type ApiService = {
  service_id: number;
  status: number;
  area: string;
  route: string;
  disruption_reason: string | null;
  last_updated_date: string | null;
  updated: string | null;
  additional_info: string | null;
  locations: ApiLocation[];
  vessels: ApiVessel[] | null;
  operator: ApiOperator | null;
  scheduled_departures_available?: boolean | null;
};

export type ApiLocation = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  weather: ApiWeather | null;
  scheduled_departures?: ApiScheduledDeparture[] | null;
  next_departure?: ApiScheduledDeparture | null;
  next_rail_departure?: ApiRailDeparture | null;
};

export type ApiWeather = {
  description: string;
  icon: string;
  temperature_celsius: number;
  wind_speed_mph: number;
  wind_direction: number;
  wind_direction_cardinal: string;
};

export type ApiScheduledDeparture = {
  departure: string;
  arrival: string;
  destination: {
    id: number;
    name: string;
    latitude: number;
    longitude: number;
  };
};

export type ApiRailDeparture = {
  from: string;
  to: string;
  departure: string;
  departure_info: string;
  is_cancelled: boolean;
  platform: string | null;
};

export type ApiVessel = {
  latitude: number;
  longitude: number;
  name: string;
  speed: number | null;
  course: number | null;
  last_received?: string | null;
};

export type ApiOperator = {
  id: number;
  name: string;
  website: string | null;
  local_number: string | null;
  international_number: string | null;
  email: string | null;
  x: string | null;
  facebook: string | null;
};
