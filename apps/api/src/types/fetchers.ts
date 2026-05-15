export type Location = {
  location_id: number;
  name: string;
  latitude: number;
  longitude: number;
};

export type WeatherObservation = {
  description: string;
  icon: string;
  temperature: number;
  windSpeed: number;
  windDirection: number;
};

export type VesselPosition = {
  mmsi: number;
  name: string;
  speed?: number;
  course?: number;
  latitude: number;
  longitude: number;
  lastReceived: string;
  organisationId: number;
};

export type RailDeparture = {
  departureCrs: string;
  departureName: string;
  destinationCrs: string;
  destinationName: string;
  scheduledDepartureTime: string;
  estimatedDepartureTime: string;
  cancelled: boolean;
  platform?: string;
  locationId: number;
};

export type ScrapedTimetableDocument = {
  organisationId: number;
  serviceIds: number[];
  title: string;
  sourceUrl: string;
  contentHash?: string;
  contentType?: string;
  contentLength?: number;
  lastSeenAt: string;
};

export type ScrapedService = {
  serviceId: number;
  area: string;
  route: string;
  status: 0 | 1 | 2 | -99;
  additionalInfo?: string;
  disruptionReason?: string;
  organisationId: number;
  lastUpdatedDate?: string;
  updated: string;
};
