import type { ServiceStatus } from "../api/types.js";
export type PushService = {
  serviceId: number;
  area: string;
  route: string;
  status: ServiceStatus;
  notificationInfo?: string | undefined;
};

export type PushNotificationReason = "status-change" | "information-change";

export type ApplePushPayload = {
  aps: {
    alert: {
      title: string;
      body: string;
    };
    sound: "default";
  };
  service_id: number;
};

export type GooglePushPayload = {
  data: {
    service_id: string;
    title: string;
    body: string;
  };
  priority: "high";
  android: {
    priority: "HIGH";
  };
};
const MAX_NOTIFICATION_TITLE_LENGTH = 50;

export function shouldNotifyForServiceUpdate(newService: PushService, oldService: PushService | null): boolean {
  if (oldService === null || newService.status === -99) {
    return false;
  }

  return newService.status !== oldService.status
    || (oldService.notificationInfo !== undefined && newService.notificationInfo !== oldService.notificationInfo);
}

export function defaultNotificationMessage(service: PushService, reason: PushNotificationReason = "status-change"): string {
  if (reason === "information-change") {
    return "Sailing information has been updated.";
  }
  if (service.status === 0) {
    return "Services are operating normally.";
  }
  if (service.status === 1) {
    return "There is a disruption affecting this service.";
  }
  if (service.status === 2) {
    return "Sailings on this service have been cancelled.";
  }
  throw new Error("Do not message for unknown service");
}

export function applePushPayload(
  service: PushService,
  reason: PushNotificationReason = "status-change",
  body = defaultNotificationMessage(service, reason)
): ApplePushPayload {
  return {
    aps: {
      alert: {
        title: notificationTitle(service, reason),
        body
      },
      sound: "default"
    },
    service_id: service.serviceId
  };
}

export function googlePushPayload(
  service: PushService,
  reason: PushNotificationReason = "status-change",
  body = defaultNotificationMessage(service, reason)
): GooglePushPayload {
  return {
    data: {
      service_id: String(service.serviceId),
      title: notificationTitle(service, reason),
      body
    },
    priority: "high",
    android: {
      priority: "HIGH"
    }
  };
}

export function notificationTitle(service: PushService, reason: PushNotificationReason = "status-change"): string {
  const suffix = reason === "information-change"
    ? "updated"
    : service.status === 0
      ? "resumed"
      : service.status === 1
        ? "disrupted"
        : "cancelled";
  const route = service.route.replace(/\s*\([A-Z0-9]+\)/g, "").replace(/\s+/g, " ").trim();
  const maxRouteLength = MAX_NOTIFICATION_TITLE_LENGTH - suffix.length - 1;
  if (route.length <= maxRouteLength) {
    return `${route} ${suffix}`;
  }

  const shortened = route.slice(0, maxRouteLength - 3).replace(/\s+\S*$/, "").replace(/[\s/,-]+$/, "");
  return `${shortened || route.slice(0, maxRouteLength - 3)}... ${suffix}`;
}
