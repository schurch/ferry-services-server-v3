import { Type, type Static } from "@sinclair/typebox";
export const UTCTimeSchema = Type.Unsafe<string>({
  $id: "UTCTime",
  type: "string",
  format: "date-time"
});

export const ServiceStatusSchema = Type.Unsafe<0 | 1 | 2 | -99>({
  $id: "ServiceStatus",
  type: "integer",
  enum: [0, 1, 2, -99]
});

export const DeviceTypeSchema = Type.Unsafe<"IOS" | "Android">({
  $id: "DeviceType",
  type: "string",
  enum: ["IOS", "Android"]
});

export const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.String()
}, { $id: "ErrorResponse" });

export const PushStatusSchema = Type.Object({
  enabled: Type.Boolean()
}, { $id: "PushStatus" });

export const CreateInstallationRequestSchema = Type.Object({
  device_token: Type.String({ minLength: 32, maxLength: 512 }),
  device_type: Type.Ref(DeviceTypeSchema)
}, { $id: "CreateInstallationRequest" });

export const AddServiceRequestSchema = Type.Object({
  service_id: Type.Integer()
}, { $id: "AddServiceRequest" });

export const ServiceIDParams = Type.Object({
  serviceID: Type.Integer()
});

export const ServiceDetailQuery = Type.Object({
  departuresDate: Type.Optional(Type.String({ format: "date" }))
});

export const OrganisationResponseSchema = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  website: Type.Optional(Type.String()),
  local_number: Type.Optional(Type.String()),
  international_number: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  x: Type.Optional(Type.String()),
  facebook: Type.Optional(Type.String())
}, { $id: "OrganisationResponse" });

export const LocationWeatherResponseSchema = Type.Object({
  icon: Type.String(),
  description: Type.String(),
  temperature_celsius: Type.Integer(),
  wind_speed_mph: Type.Integer(),
  wind_direction: Type.Number(),
  wind_direction_cardinal: Type.String()
}, { $id: "LocationWeatherResponse" });

export const RailDepartureResponseSchema = Type.Object({
  from: Type.String(),
  to: Type.String(),
  departure: Type.Ref(UTCTimeSchema),
  departure_info: Type.String(),
  platform: Type.Optional(Type.String()),
  is_cancelled: Type.Boolean()
}, { $id: "RailDepartureResponse" });

export const DepartureDestinationSchema = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  latitude: Type.Number(),
  longitude: Type.Number()
}, { $id: "DepartureDestination" });

export const DepartureResponseSchema = Type.Object({
  destination: Type.Ref(DepartureDestinationSchema),
  departure: Type.Ref(UTCTimeSchema),
  arrival: Type.Ref(UTCTimeSchema),
  notes: Type.Optional(Type.String())
}, { $id: "DepartureResponse" });

export const LocationResponseSchema = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  latitude: Type.Number(),
  longitude: Type.Number(),
  scheduled_departures: Type.Optional(Type.Array(Type.Ref(DepartureResponseSchema))),
  next_departure: Type.Optional(Type.Ref(DepartureResponseSchema)),
  next_rail_departure: Type.Optional(Type.Ref(RailDepartureResponseSchema)),
  weather: Type.Optional(Type.Ref(LocationWeatherResponseSchema))
}, { $id: "LocationResponse" });

export const LocationSummaryResponseSchema = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  latitude: Type.Number(),
  longitude: Type.Number()
}, { $id: "LocationSummaryResponse" });

export const VesselVoyageResponseSchema = Type.Object({
  origin_location: Type.Ref(DepartureDestinationSchema),
  destination_location: Type.Ref(DepartureDestinationSchema),
  departed_at: Type.Ref(UTCTimeSchema),
  estimated_arrival: Type.Optional(Type.Ref(UTCTimeSchema)),
  progress: Type.Optional(Type.Number({ minimum: 0, maximum: 1 }))
}, { $id: "VesselVoyageResponse" });

export const VesselResponseSchema = Type.Object({
  mmsi: Type.Integer(),
  name: Type.String(),
  speed: Type.Optional(Type.Number()),
  course: Type.Optional(Type.Number()),
  latitude: Type.Number(),
  longitude: Type.Number(),
  last_received: Type.Ref(UTCTimeSchema),
  voyage: Type.Optional(Type.Ref(VesselVoyageResponseSchema))
}, { $id: "VesselResponse" });

export const TimetableDocumentResponseSchema = Type.Object({
  id: Type.Integer(),
  organisation_id: Type.Integer(),
  organisation_name: Type.String(),
  service_ids: Type.Array(Type.Integer()),
  title: Type.String(),
  source_url: Type.String(),
  content_hash: Type.Optional(Type.String()),
  content_type: Type.Optional(Type.String()),
  content_length: Type.Optional(Type.Integer()),
  last_seen_at: Type.Ref(UTCTimeSchema),
  updated: Type.Ref(UTCTimeSchema)
}, { $id: "TimetableDocumentResponse" });

export const ReliabilityStatusBreakdownEntrySchema = Type.Object({
  days: Type.Integer({
    minimum: 0,
    description: "Number of observed operating days whose worst observed service status matched this category."
  }),
  percentage: Type.Number({
    minimum: 0,
    maximum: 100,
    description: "Percentage of observed operating days in the period represented by this status category, rounded to one decimal place."
  })
}, { $id: "ReliabilityStatusBreakdownEntry" });

export const ReliabilityPeriodResponseSchema = Type.Object({
  start: Type.Ref(UTCTimeSchema, { description: "Inclusive UTC start of the reliability window." }),
  end: Type.Ref(UTCTimeSchema, { description: "Exclusive UTC end of the reliability window." }),
  observed_operating_days: Type.Integer({
    minimum: 0,
    description: "Total operating days in the period that had an observed service status."
  }),
  scheduled_sailings: Type.Integer({
    minimum: 0,
    description: "Total scheduled sailings captured at scrape time across the observed operating days in the period. Reliability percentages are based on days, not this sailing count."
  }),
  day_statuses: Type.Object({
    normal: Type.Ref(ReliabilityStatusBreakdownEntrySchema),
    disrupted: Type.Ref(ReliabilityStatusBreakdownEntrySchema),
    cancelled: Type.Ref(ReliabilityStatusBreakdownEntrySchema)
  }, { description: "Breakdown of observed operating days by worst observed daily service status." })
}, { $id: "ReliabilityPeriodResponse" });

export const ReliabilityResponseSchema = Type.Object({
  status_breakdown: Type.Object({
    last_7_days: Type.Ref(ReliabilityPeriodResponseSchema),
    last_30_days: Type.Ref(ReliabilityPeriodResponseSchema)
  }, { description: "Rolling reliability breakdowns for this service, keyed by period to prevent duplicate ranges." })
}, { $id: "ReliabilityResponse" });

export const ServiceResponseSchema = Type.Object({
  service_id: Type.Integer(),
  area: Type.String(),
  route: Type.String(),
  status: Type.Ref(ServiceStatusSchema),
  locations: Type.Array(Type.Ref(LocationResponseSchema)),
  additional_info: Type.Optional(Type.String()),
  disruption_reason: Type.Optional(Type.String()),
  last_updated_date: Type.Optional(Type.Ref(UTCTimeSchema)),
  vessels: Type.Optional(Type.Array(Type.Ref(VesselResponseSchema))),
  operator: Type.Optional(Type.Ref(OrganisationResponseSchema)),
  scheduled_departures_available: Type.Boolean(),
  updated: Type.Ref(UTCTimeSchema),
  timetable_documents: Type.Optional(Type.Array(Type.Ref(TimetableDocumentResponseSchema))),
  reliability: Type.Optional(Type.Ref(ReliabilityResponseSchema, {
    description: "Rolling status reliability metrics for service detail responses."
  }))
}, { $id: "ServiceResponse" });

export const ServiceListResponseSchema = Type.Object({
  service_id: Type.Integer(),
  area: Type.String(),
  route: Type.String(),
  status: Type.Ref(ServiceStatusSchema),
  locations: Type.Array(Type.Ref(LocationSummaryResponseSchema)),
  disruption_reason: Type.Optional(Type.String()),
  last_updated_date: Type.Optional(Type.Ref(UTCTimeSchema)),
  vessels: Type.Optional(Type.Array(Type.Ref(VesselResponseSchema))),
  operator: Type.Optional(Type.Ref(OrganisationResponseSchema)),
  scheduled_departures_available: Type.Boolean(),
  updated: Type.Ref(UTCTimeSchema)
}, { $id: "ServiceListResponse" });

export const SnapshotBodySchema = Type.String({ format: "binary", $id: "SnapshotBody" });
export type OrganisationApiResponse = Static<typeof OrganisationResponseSchema>;
export type LocationWeatherApiResponse = Static<typeof LocationWeatherResponseSchema>;
export type RailDepartureApiResponse = Static<typeof RailDepartureResponseSchema>;
export type DepartureDestinationApiResponse = Static<typeof DepartureDestinationSchema>;
export type DepartureApiResponse = Static<typeof DepartureResponseSchema>;
export type LocationApiResponse = Static<typeof LocationResponseSchema>;
export type VesselVoyageApiResponse = Static<typeof VesselVoyageResponseSchema>;
export type VesselApiResponse = Static<typeof VesselResponseSchema>;
export type TimetableDocumentApiResponse = Static<typeof TimetableDocumentResponseSchema>;
export type ReliabilityPeriodApiResponse = Static<typeof ReliabilityPeriodResponseSchema>;
export type ReliabilityApiResponse = Static<typeof ReliabilityResponseSchema>;
export type ServiceApiResponse = Static<typeof ServiceResponseSchema>;
export type ServiceListApiResponse = Static<typeof ServiceListResponseSchema>;
