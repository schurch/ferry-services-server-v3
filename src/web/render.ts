import { Eta } from "eta";
import path from "node:path";
import { config } from "../config.js";
import type {
  DepartureApiResponse,
  LocationApiResponse,
  OrganisationApiResponse,
  ServiceApiResponse,
  ServiceListApiResponse
} from "../api/schema.js";
import type { WebsiteStats } from "./db.js";

export function dateInput(value: Date): string {
  return formatDateInput(value);
}

export function isDateInput(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function renderServicesPage(services: Array<ServiceApiResponse | ServiceListApiResponse>): string {
  const groups = new Map<string, Array<ServiceApiResponse | ServiceListApiResponse>>();
  for (const service of services) {
    const key = String(service.operator?.name ?? "Services");
    groups.set(key, [...(groups.get(key) ?? []), service]);
  }

  const renderedGroups = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, groupServices]) => ({
      name,
      hasLogo: hasCalmacBrand(name),
      services: groupServices.map((service) => ({
        area: service.area,
        route: service.route,
        href: `/service/${encodeURIComponent(String(service.service_id))}`,
        search: `${service.area} ${service.route}`.toLowerCase(),
        status: statusName(service.status),
        statusLabel: statusLabel(service.status)
      }))
    }));

  return page("Scottish Ferries", "services", { groups: renderedGroups });
}

export function renderServicePage(service: PageService, departuresDate: string, now: Date): string {
  const status = statusName(service.status);
  const hasAdditionalInfo = Boolean(String(service.additional_info ?? "").trim());
  return page(`${service.area} - Scottish Ferries`, "service", {
    service,
    status,
    statusLabel: statusLabel(service.status),
    disruptionText: disruptionText(service.status),
    lastUpdated: formatDateTime(service.last_updated_date ?? service.updated),
    reliability: reliabilityForTemplate(service),
    detailsHref: hasAdditionalInfo ? `/service/${encodeURIComponent(String(service.service_id))}/info` : undefined,
    map: mapForTemplate(service),
    locations: locationsForTemplate(service),
    scheduledDepartures: scheduledDeparturesForTemplate(service, departuresDate, now),
    operator: operatorForTemplate(service.operator)
  });
}

export function renderAdditionalInfoPage(service: PageService): string {
  return page(`${service.area} Info - Scottish Ferries`, "additional-info", {
    area: service.area,
    additionalInfo: String(service.additional_info ?? "")
  });
}

export function renderNotFoundPage(message = "Page not found"): string {
  return page("Not Found - Scottish Ferries", "not-found", { message });
}

export function renderPrivacyPolicyPage(): string {
  return page("Privacy Policy - Scottish Ferries", "privacy-policy", {});
}

export function renderStatsPage(stats: WebsiteStats): string {
  const deviceTotal = stats.deviceBreakdown.reduce((sum, row) => sum + row.count, 0);

  return page("Website Stats - Scottish Ferries", "stats", {
    generatedAt: formatDateTime(stats.generatedAt),
    metrics: [
      metric("Installations", stats.overview.totalInstallations),
      metric("Subscribed", stats.overview.subscribedInstallations),
      metric("Tracked services", stats.overview.totalServices, `${formatNumber(stats.overview.normalServices)} normal right now`),
      metric("Live disruption count", stats.overview.disruptedServices + stats.overview.cancelledServices, `${formatNumber(stats.overview.cancelledServices)} cancelled, ${formatNumber(stats.overview.disruptedServices)} disrupted`)
    ],
    deviceMix: stats.deviceBreakdown.map((row) => ({
      deviceType: row.deviceType.toLowerCase(),
      label: row.deviceType === "IOS" ? "iOS" : "Android",
      count: formatNumber(row.count),
      percentage: percentage(row.count, deviceTotal)
    })),
    mostSubscribed: horizontalBarRows(
      stats.topSubscribedServices.map((row) => ({
        label: row.area,
        sublabel: row.route,
        value: row.subscriberCount
      }))
    ),
    mostDisrupted: disruptionBarRows(stats),
    dailyStatus: dailyTrendDays(stats),
    currentStatus: horizontalBarRows([
      {
        label: "Normal services",
        value: stats.overview.normalServices,
        tone: "default"
      },
      {
        label: "Disrupted services",
        value: stats.overview.disruptedServices,
        tone: "warning"
      },
      {
        label: "Cancelled services",
        value: stats.overview.cancelledServices,
        tone: "danger"
      }
    ])
  });
}

type PageService = Omit<ServiceApiResponse, "locations"> & {
  locations: LocationApiResponse[];
};

type MapPoint = {
  latitude: number;
  longitude: number;
  label: string;
  type: "location" | "vessel";
  speed?: number | null;
  course?: number | null;
  lastReceived?: string | null;
};

type LocationWithScheduledDepartures = LocationApiResponse & {
  scheduled_departures: DepartureApiResponse[];
};

const statusNames = ["normal", "disrupted", "cancelled"] as const;

const eta = new Eta({
  views: path.resolve("src/web/templates")
});

function hasScheduledDepartures(location: LocationApiResponse): location is LocationWithScheduledDepartures {
  return Array.isArray(location.scheduled_departures) && location.scheduled_departures.length > 0;
}

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function statusName(status: unknown): string {
  return statusNames[Number(status)] ?? "unknown";
}

function statusLabel(status: unknown): string {
  switch (statusName(status)) {
    case "normal":
      return "Normal operations";
    case "disrupted":
      return "Sailings disrupted";
    case "cancelled":
      return "Sailings cancelled";
    default:
      return "Unknown status";
  }
}

function disruptionText(status: unknown): string {
  switch (statusName(status)) {
    case "normal":
      return "There are currently no disruptions with this service.";
    case "disrupted":
      return "There are disruptions with this service.";
    case "cancelled":
      return "Sailings have been cancelled for this service.";
    default:
      return "There was a problem fetching the service status.";
  }
}

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateTime(value: unknown): string {
  if (!value) return "Unknown";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London"
  }).format(date);
}

function formatTime(value: unknown): string {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Europe/London"
  }).format(date);
}

function formatShortDate(value: unknown): string {
  if (!value) return "Unknown";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC"
  }).format(date);
}

function hasCalmacBrand(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized.includes("calmac") || normalized.includes("caledonian macbrayne");
}

function page(title: string, template: string, data: Record<string, unknown>): string {
  const content = eta.render(template, data);
  return eta.render("layout", {
    title,
    content,
    ferryConfig: escapeJsonForScript({
      googleMapsApiKey: config.googleMapsApiKey
    })
  });
}

function locationsForTemplate(service: PageService) {
  const locations = [...(service.locations ?? [])].sort((left, right) => String(left.name).localeCompare(String(right.name)));
  return locations.map((location) => ({
    name: location.name,
    ...(location.next_departure
      ? {
          nextFerry: {
            departure: formatTime(location.next_departure.departure),
            destination: location.next_departure.destination?.name
          }
        }
      : {}),
    ...(location.next_rail_departure
      ? {
          nextRail: {
            departure: formatTime(location.next_rail_departure.departure),
            destination: location.next_rail_departure.to,
            platform: location.next_rail_departure.platform,
            isCancelled: location.next_rail_departure.is_cancelled,
            departureInfo: location.next_rail_departure.departure_info
          }
        }
      : {}),
    ...(location.weather
      ? {
          weather: {
            temperatureCelsius: location.weather.temperature_celsius,
            description: location.weather.description,
            windSpeedMph: location.weather.wind_speed_mph,
            windDirectionCardinal: location.weather.wind_direction_cardinal
          }
        }
      : {})
  }));
}

function mapForTemplate(service: PageService) {
  const locationPoints: MapPoint[] = service.locations
    .filter((location) => Number.isFinite(location.latitude) && Number.isFinite(location.longitude))
    .map((location) => ({
      latitude: location.latitude,
      longitude: location.longitude,
      label: String(location.name ?? "Location"),
      type: "location"
    }));
  const vesselPoints: MapPoint[] = (service.vessels ?? [])
    .filter((vessel) => Number.isFinite(vessel.latitude) && Number.isFinite(vessel.longitude))
    .map((vessel) => ({
      latitude: vessel.latitude,
      longitude: vessel.longitude,
      label: String(vessel.name ?? "Vessel"),
      type: "vessel",
      speed: typeof vessel.speed === "number" && Number.isFinite(vessel.speed) ? vessel.speed : null,
      course: typeof vessel.course === "number" && Number.isFinite(vessel.course) ? vessel.course : null,
      lastReceived: vessel.last_received ?? null
    }));
  const points = [...locationPoints, ...vesselPoints];
  const serviceArea = String(service.area ?? "service");

  return {
    serviceArea,
    ...(config.googleMapsApiKey ? { pointsJson: escapeJsonForScript(points) } : {})
  };
}

function scheduledDeparturesForTemplate(service: PageService, departuresDate: string, now: Date) {
  if (!service.scheduled_departures_available) return undefined;

  const locations = service.locations
    .filter(hasScheduledDepartures)
    .sort((left, right) => String(left.name).localeCompare(String(right.name)));
  if (locations.length === 0) return undefined;

  return {
    serviceId: service.service_id,
    departuresDate,
    routes: locations.flatMap((location) => {
      const byDestination = new Map<number, DepartureApiResponse[]>();
      for (const departure of location.scheduled_departures) {
        const destinationId = departure.destination.id;
        byDestination.set(destinationId, [...(byDestination.get(destinationId) ?? []), departure]);
      }

      return [...byDestination.entries()].map(([destinationId, departures]) => {
        const destinationName = departures[0]?.destination.name ?? "Destination";
        return {
          destinationId,
          originName: location.name,
          destinationName,
          departures: departures
            .sort((left, right) => String(left.departure).localeCompare(String(right.departure)))
            .map((departure) => ({
              departure: formatTime(departure.departure),
              arrival: formatTime(departure.arrival),
              hasDeparted: new Date(String(departure.departure)).getTime() < now.getTime()
            }))
        };
      });
    })
  };
}

function operatorForTemplate(operator: OrganisationApiResponse | undefined) {
  if (!operator) return undefined;
  const links = [
    ...(operator.local_number ? [{ href: `tel:${String(operator.local_number).split(" ").join("-")}`, label: "Phone", external: false }] : []),
    ...(operator.website ? [{ href: operator.website, label: "Website", external: true }] : []),
    ...(operator.email ? [{ href: `mailto:${operator.email}`, label: "Email", external: false }] : []),
    ...(operator.x ? [{ href: operator.x, label: "X", external: true }] : []),
    ...(operator.facebook ? [{ href: operator.facebook, label: "Facebook", external: true }] : [])
  ];

  return {
    name: operator.name,
    hasLogo: hasCalmacBrand(String(operator.name)),
    links
  };
}

function reliabilityForTemplate(service: PageService) {
  const period = service.reliability?.status_breakdown?.last_30_days;
  if (!period || Number(period.observed_operating_days) === 0) return undefined;
  const disrupted = Number(period.day_statuses?.disrupted?.days ?? 0);
  const cancelled = Number(period.day_statuses?.cancelled?.days ?? 0);
  return {
    disrupted,
    cancelled,
    scheduledSailings: Number(period.scheduled_sailings)
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

function percentage(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function metric(label: string, value: number, detail = "") {
  return { label, value: formatNumber(value), detail };
}

function horizontalBarRows(
  rows: Array<{
    label: string;
    value: number;
    sublabel?: string;
    tone?: "default" | "warning" | "danger";
  }>
) {
  const maxValue = Math.max(...rows.map((row) => row.value), 1);
  return rows.map((row) => ({
    label: row.label,
    ...(row.sublabel ? { sublabel: row.sublabel } : {}),
    tone: row.tone ?? "default",
    width: Math.max((row.value / maxValue) * 100, row.value > 0 ? 10 : 0),
    value: formatNumber(row.value)
  }));
}

function disruptionBarRows(stats: WebsiteStats) {
  const maxValue = Math.max(...stats.disruptionLeaders.map((row) => row.affectedDays), 1);
  return stats.disruptionLeaders.map((row) => {
    const disruptedWidth = row.affectedDays > 0 ? (row.disruptedDays / maxValue) * 100 : 0;
    const cancelledWidth = row.affectedDays > 0 ? (row.cancelledDays / maxValue) * 100 : 0;
    return {
      area: row.area,
      route: row.route,
      disruptedWidth,
      cancelledWidth,
      affectedDays: formatNumber(row.affectedDays)
    };
  });
}

function dailyTrendDays(stats: WebsiteStats) {
  if (stats.dailyStatusTrend.every((day) => day.observedServices === 0)) {
    return [];
  }

  return stats.dailyStatusTrend.map((day) => {
    const total = Math.max(day.observedServices, 1);
    const normalHeight = (day.normalServices / total) * 100;
    const disruptedHeight = (day.disruptedServices / total) * 100;
    const cancelledHeight = (day.cancelledServices / total) * 100;
    return {
      title: `${day.observedDate}: ${day.normalServices} normal, ${day.disruptedServices} disrupted, ${day.cancelledServices} cancelled`,
      normalHeight,
      disruptedHeight,
      cancelledHeight,
      date: formatShortDate(`${day.observedDate}T00:00:00Z`),
      count: formatNumber(day.observedServices)
    };
  });
}
