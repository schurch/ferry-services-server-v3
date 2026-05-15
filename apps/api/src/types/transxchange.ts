export type TransxchangeDateRange = {
  startDate: string;
  endDate: string;
};

export type TransxchangeStopPoint = {
  stopPointRef: string;
  commonName: string;
};

export type TransxchangeService = {
  serviceCode: string;
  operatorRef: string;
  mode: string;
  description: string;
  origin: string;
  destination: string;
  startDate?: string;
  endDate?: string;
};

export type TransxchangeLine = {
  lineId: string;
  serviceCode: string;
  lineName: string;
};

export type TransxchangeJourneyPattern = {
  journeyPatternId: string;
  serviceCode: string;
  direction: string;
};

export type TransxchangeJourneyPatternSection = {
  journeyPatternId: string;
  sectionRef: string;
  sectionOrder: number;
};

export type TransxchangeJourneyPatternTimingLink = {
  journeyPatternTimingLinkId: string;
  journeyPatternSectionRef: string;
  sortOrder: number;
  fromStopPointRef: string;
  fromActivity: string;
  fromTimingStatus: string;
  toStopPointRef: string;
  toActivity: string;
  toTimingStatus: string;
  routeLinkRef: string;
  direction: string;
  runSeconds: number;
  fromWaitSeconds: number;
};

export type TransxchangeVehicleJourney = {
  vehicleJourneyCode: string;
  serviceCode: string;
  lineId: string;
  journeyPatternId: string;
  timingLinkRefs: string[];
  operatorRef: string;
  departureTime: string;
  dayRules: string[];
  weekOfMonthRules: string[];
  servicedOrganisationDaysOfOperation: TransxchangeDateRange[];
  servicedOrganisationDaysOfNonOperation: TransxchangeDateRange[];
  daysOfOperation: TransxchangeDateRange[];
  daysOfNonOperation: TransxchangeDateRange[];
  bankHolidayOperationRules: string[];
  bankHolidayNonOperationRules: string[];
  note: string;
  noteCode: string;
};

export type TransxchangeDocument = {
  sourcePath: string;
  sourceFileName: string;
  sourceVersionKey: string;
  sourceCreationDateTime?: string;
  sourceModificationDateTime?: string;
  stopPoints: TransxchangeStopPoint[];
  services: TransxchangeService[];
  lines: TransxchangeLine[];
  journeyPatterns: TransxchangeJourneyPattern[];
  journeyPatternSections: TransxchangeJourneyPatternSection[];
  journeyPatternTimingLinks: TransxchangeJourneyPatternTimingLink[];
  vehicleJourneys: TransxchangeVehicleJourney[];
};
