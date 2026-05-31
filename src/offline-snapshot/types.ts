export type ServiceRow = {
  service_id: number;
  area: string;
  route: string;
  organisation_id: number;
};

export type LocationRow = {
  location_id: number;
  name: string;
  latitude: number;
  longitude: number;
};

export type OrganisationRow = {
  organisation_id: number;
  name: string;
  website: string | null;
  local_phone: string | null;
  international_phone: string | null;
  email: string | null;
  x: string | null;
  facebook: string | null;
};

export type ServiceLocationRow = {
  service_id: number;
  location_id: number;
  display_order: number;
};

export type OfflineDeparture = {
  service_id: number;
  service_date: string;
  from_location_id: number;
  to_location_id: number;
  departure_time_utc: string;
  arrival_time_utc: string;
  notes: string | null;
};

export type OfflineSnapshotMetadata = {
  data_version: string;
  etag: string;
  generated_at: string;
  valid_from: string;
  valid_to: string;
};

export type OfflineSnapshot = {
  schemaVersion: number;
  dataVersion: string;
  generatedAt: string;
  validFrom: string;
  validTo: string;
  services: Array<ServiceRow & { scheduled_departures_available: number }>;
  locations: LocationRow[];
  organisations: OrganisationRow[];
  serviceLocations: ServiceLocationRow[];
  departures: OfflineDeparture[];
};
