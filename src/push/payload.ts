import type { ServiceStatus } from "../types/api.js";

export type PushService = {
  serviceId: number;
  area: string;
  route: string;
  status: ServiceStatus;
};

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

export function shouldNotifyForServiceStatusChange(newService: PushService, oldService: PushService | null): boolean {
  return oldService !== null && newService.status !== oldService.status && newService.status !== -99;
}

export function defaultNotificationMessage(service: PushService): string {
  if (service.status === 0) {
    return `Normal services have resumed for ${service.route}`;
  }
  if (service.status === 1) {
    return `There is a disruption to the service ${service.route}`;
  }
  if (service.status === 2) {
    return `Sailings have been cancelled for ${service.route}`;
  }
  throw new Error("Do not message for unknown service");
}

export function applePushPayload(service: PushService): ApplePushPayload {
  return {
    aps: {
      alert: {
        title: service.area,
        body: defaultNotificationMessage(service)
      },
      sound: "default"
    },
    service_id: service.serviceId
  };
}

export function googlePushPayload(service: PushService): GooglePushPayload {
  const title = service.status === 0
    ? `${service.area} sailings resumed`
    : service.status === 1
      ? `${service.area} sailings disrupted`
      : `${service.area} sailings cancelled`;

  return {
    data: {
      service_id: String(service.serviceId),
      title,
      body: service.route
    },
    priority: "high",
    android: {
      priority: "HIGH"
    }
  };
}
