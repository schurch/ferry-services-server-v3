import type { Service } from "../types";

export type GoogleMapPoint = {
  latitude: number;
  longitude: number;
  label: string;
  type: "location" | "vessel";
  speed?: number | null;
  course?: number | null;
  lastReceived?: string | null;
};

export function getGoogleMapPoints(service: Service): GoogleMapPoint[] {
  const locationPoints = service.locations
    .filter((location) => Number.isFinite(location.latitude) && Number.isFinite(location.longitude))
    .map((location) => ({
      latitude: location.latitude,
      longitude: location.longitude,
      label: location.name,
      type: "location" as const
    }));

  const vesselPoints = service.vessels
    .filter((vessel) => Number.isFinite(vessel.latitude) && Number.isFinite(vessel.longitude))
    .map((vessel) => ({
      latitude: vessel.latitude,
      longitude: vessel.longitude,
      label: vessel.name || "Vessel",
      type: "vessel" as const,
      speed: vessel.speed,
      course: vessel.course,
      lastReceived: vessel.lastReceived
    }));

  return [...locationPoints, ...vesselPoints];
}
