import { Type } from "@sinclair/typebox";

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
  device_token: Type.String(),
  device_type: Type.Ref(DeviceTypeSchema)
}, { $id: "CreateInstallationRequest" });

export const AddServiceRequestSchema = Type.Object({
  service_id: Type.Integer()
}, { $id: "AddServiceRequest" });

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

export const VesselResponseSchema = Type.Object({
  mmsi: Type.Integer(),
  name: Type.String(),
  speed: Type.Optional(Type.Number()),
  course: Type.Optional(Type.Number()),
  latitude: Type.Number(),
  longitude: Type.Number(),
  last_received: Type.Ref(UTCTimeSchema)
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

export const ServiceResponseSchema = Type.Object({
  service_id: Type.Integer(),
  area: Type.String(),
  route: Type.String(),
  status: Type.Ref(ServiceStatusSchema),
  locations: Type.Array(Type.Ref(LocationResponseSchema)),
  additional_info: Type.Optional(Type.String()),
  disruption_reason: Type.Optional(Type.String()),
  last_updated_date: Type.Optional(Type.Ref(UTCTimeSchema)),
  vessels: Type.Array(Type.Ref(VesselResponseSchema)),
  operator: Type.Optional(Type.Ref(OrganisationResponseSchema)),
  scheduled_departures_available: Type.Boolean(),
  updated: Type.Ref(UTCTimeSchema),
  timetable_documents: Type.Optional(Type.Array(Type.Ref(TimetableDocumentResponseSchema)))
}, { $id: "ServiceResponse" });

export const SnapshotBodySchema = Type.String({ format: "binary", $id: "SnapshotBody" });
