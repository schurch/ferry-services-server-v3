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
  speed?: number | undefined;
  course?: number | undefined;
  latitude: number;
  longitude: number;
  lastReceived: string;
  destinationName?: string | undefined;
  originName?: string | undefined;
  originDepartedAt?: string | undefined;
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
  platform?: string | undefined;
  locationId: number;
};

export type ScrapedTimetableDocument = {
  organisationId: number;
  serviceIds: number[];
  title: string;
  sourceUrl: string;
  contentHash?: string | undefined;
  contentType?: string | undefined;
  contentLength?: number | undefined;
  lastSeenAt: string;
};

export type ScrapedService = {
  serviceId: number;
  area: string;
  route: string;
  status: 0 | 1 | 2 | -99;
  sourceStatus?: string | undefined;
  sourceServiceId?: string | undefined;
  sourceServiceCode?: string | undefined;
  sourceAreaId?: string | undefined;
  sourceAreaName?: string | undefined;
  sourceAreaLatitude?: number | undefined;
  sourceAreaLongitude?: number | undefined;
  additionalInfo?: string | undefined;
  disruptionReason?: string | undefined;
  organisationId: number;
  lastUpdatedDate?: string | undefined;
  updated: string;
  notices?: ScrapedServiceNotice[] | undefined;
};

export type ScrapedServiceNotice = {
  sourceNoticeKey?: string | undefined;
  sourceNoticeType?: string | undefined;
  title: string;
  disruptionReason?: string | undefined;
  detailText?: string | undefined;
  detailMarkdown?: string | undefined;
};
