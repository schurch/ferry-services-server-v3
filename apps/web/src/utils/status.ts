import type { ServiceStatus } from "../types";

export function statusLabel(status: ServiceStatus): string {
  switch (status) {
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

export function disruptionText(status: ServiceStatus): string {
  switch (status) {
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
