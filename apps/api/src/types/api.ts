export type ServiceStatus = 0 | 1 | 2 | -99;

export type DeviceType = "IOS" | "Android";

export type PushStatus = {
  enabled: boolean;
};

export type CreateInstallationRequest = {
  deviceToken: string;
  deviceType: DeviceType;
};

export type AddServiceRequest = {
  serviceId: number;
};

export type OrganisationResponse = {
  id: number;
  name: string;
  website?: string;
  localNumber?: string;
  internationalNumber?: string;
  email?: string;
  x?: string;
  facebook?: string;
};

export type LocationWeatherResponse = {
  icon: string;
  description: string;
  temperatureCelsius: number;
  windSpeedMph: number;
  windDirection: number;
  windDirectionCardinal: string;
};

export type RailDepartureResponse = {
  from: string;
  to: string;
  departure: string;
  departureInfo: string;
  platform?: string;
  isCancelled: boolean;
};

export type LocationResponse = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  scheduledDepartures?: DepartureResponse[];
  nextDeparture?: DepartureResponse;
  nextRailDeparture?: RailDepartureResponse;
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
  lastReceived: string;
};

export type TimetableDocumentResponse = {
  id: number;
  organisationId: number;
  organisationName: string;
  serviceIds: number[];
  title: string;
  sourceUrl: string;
  contentHash?: string;
  contentType?: string;
  contentLength?: number;
  lastSeenAt: string;
  updated: string;
};

export type ServiceResponse = {
  serviceId: number;
  area: string;
  route: string;
  status: ServiceStatus;
  locations: LocationResponse[];
  additionalInfo?: string;
  disruptionReason?: string;
  lastUpdatedDate?: string;
  vessels: VesselResponse[];
  operator?: OrganisationResponse;
  scheduledDeparturesAvailable: boolean;
  updated: string;
  timetableDocuments?: TimetableDocumentResponse[];
};
