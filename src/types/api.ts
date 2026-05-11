export type ServiceStatus = 0 | 1 | 2 | -99;

export type DeviceType = "IOS" | "Android";

export type PushStatus = {
  enabled: boolean;
};

export type OrganisationResponse = {
  id: number;
  name: string;
  website?: string;
  local_number?: string;
  international_number?: string;
  email?: string;
  x?: string;
  facebook?: string;
};

export type LocationWeatherResponse = {
  icon: string;
  description: string;
  temperature_celsius: number;
  wind_speed_mph: number;
  wind_direction: number;
  wind_direction_cardinal: string;
};

export type RailDepartureResponse = {
  from: string;
  to: string;
  departure: string;
  departure_info: string;
  platform?: string;
  is_cancelled: boolean;
};

export type LocationResponse = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  scheduled_departures?: DepartureResponse[];
  next_departure?: DepartureResponse;
  next_rail_departure?: RailDepartureResponse;
  weather?: LocationWeatherResponse;
};

export type DepartureResponse = {
  destination: LocationResponse;
  departure: string;
  arrival: string;
  notes?: string;
};

export type VesselResponse = {
  mmsi: number;
  name: string;
  speed?: number;
  course?: number;
  latitude: number;
  longitude: number;
  last_received: string;
};

export type TimetableDocumentResponse = {
  id: number;
  organisation_id: number;
  organisation_name: string;
  service_ids: number[];
  title: string;
  source_url: string;
  content_hash?: string;
  content_type?: string;
  content_length?: number;
  last_seen_at: string;
  updated: string;
};

export type ServiceResponse = {
  service_id: number;
  area: string;
  route: string;
  status: ServiceStatus;
  locations: LocationResponse[];
  additional_info?: string;
  disruption_reason?: string;
  last_updated_date?: string;
  vessels: VesselResponse[];
  operator?: OrganisationResponse;
  scheduled_departures_available: boolean;
  updated: string;
  timetable_documents?: TimetableDocumentResponse[];
};
