import { describe, expect, it } from "vitest";
import { getGoogleMapPoints } from "./points";
import type { Service } from "../types";

const service: Service = {
  serviceId: 1,
  status: "normal",
  area: "Test area",
  route: "A to B",
  disruptionReason: null,
  lastUpdatedDate: null,
  updated: null,
  additionalInfo: null,
  scheduledDeparturesAvailable: false,
  operator: null,
  locations: [
    {
      id: 1,
      name: "Port A",
      latitude: 56.0,
      longitude: -4.0,
      weather: null,
      scheduledDepartures: [],
      nextDeparture: null,
      nextRailDeparture: null
    },
    {
      id: 2,
      name: "Bad Port",
      latitude: Number.NaN,
      longitude: -4.1,
      weather: null,
      scheduledDepartures: [],
      nextDeparture: null,
      nextRailDeparture: null
    }
  ],
  vessels: [
    {
      name: "Vessel 1",
      latitude: 56.2,
      longitude: -4.2,
      speed: 10,
      course: 90,
      lastReceived: "2026-03-05T11:50:00Z"
    },
    {
      name: "Bad Vessel",
      latitude: Number.POSITIVE_INFINITY,
      longitude: -4.3,
      speed: null,
      course: null,
      lastReceived: null
    }
  ]
};

describe("getGoogleMapPoints", () => {
  it("filters invalid coordinates and combines locations and vessels", () => {
    const points = getGoogleMapPoints(service);

    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ label: "Port A", type: "location" });
    expect(points[1]).toMatchObject({ label: "Vessel 1", type: "vessel", speed: 10, course: 90 });
  });
});
