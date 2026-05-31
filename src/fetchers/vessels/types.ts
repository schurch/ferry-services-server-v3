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

export type OrganisationId = number;

export type Mmsi = number;

export type OrganisationVessels = {
  organisationId: OrganisationId;
  organisationName: string;
  mmsis: Mmsi[];
};

export type PositionUpdate = {
  mmsi: number;
  latitude: number;
  longitude: number;
  speed?: number | undefined;
  course?: number | undefined;
  destinationName?: string | undefined;
  receivedAt: string;
};

export type SourceVesselUpdate = {
  position: PositionUpdate;
  name?: string | undefined;
};

export type SourceVesselUpdateHandler = (update: SourceVesselUpdate) => void | Promise<void>;

export type TerminalReference = {
  organisationId: number;
  serviceId: number;
  name: string;
  latitude: number;
  longitude: number;
};

export type PreviousVesselPosition = {
  name: string;
  latitude: number;
  longitude: number;
  destinationName?: string | undefined;
  originName?: string | undefined;
  originDepartedAt?: string | undefined;
};
