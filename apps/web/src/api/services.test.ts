import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchService, fetchServices } from "./services";

describe("services api", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: { origin: "https://example.test" }
    } as unknown as Window & typeof globalThis);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("maps list response into app service shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          service_id: 123,
          status: 1,
          area: "Area",
          route: "Route",
          disruption_reason: "Weather",
          last_updated_date: "2026-03-05T10:00:00Z",
          updated: "2026-03-05T10:00:00Z",
          additional_info: "<p>Info</p>",
          locations: [
            {
              id: 1,
              name: "Port A",
              latitude: 56,
              longitude: -4,
              weather: null,
              scheduled_departures: [],
              next_departure: null,
              next_rail_departure: null
            }
          ],
          vessels: [
            {
              latitude: 56.1,
              longitude: -4.1,
              name: "Vessel",
              speed: 12,
              course: 90,
              last_received: "2026-03-05T09:59:00Z"
            }
          ],
          operator: {
            id: 9,
            name: "Operator",
            website: "https://operator.test",
            local_number: "01234 567890",
            international_number: null,
            email: "info@operator.test",
            x: null,
            facebook: null
          },
          scheduled_departures_available: true
        }
      ]
    });

    vi.stubGlobal("fetch", fetchMock);

    const services = await fetchServices();

    expect(fetchMock).toHaveBeenCalledWith("/api/services/");
    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({
      serviceId: 123,
      status: "disrupted",
      disruptionReason: "Weather",
      scheduledDeparturesAvailable: true
    });
    expect(services[0].operator?.localNumber).toBe("01234 567890");
    expect(services[0].vessels[0].lastReceived).toBe("2026-03-05T09:59:00Z");
  });

  it("builds detail URL with departuresDate query param", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        service_id: 42,
        status: 0,
        area: "Area",
        route: "Route",
        disruption_reason: null,
        last_updated_date: null,
        updated: null,
        additional_info: null,
        locations: [],
        vessels: [],
        operator: null,
        scheduled_departures_available: false
      })
    });

    vi.stubGlobal("fetch", fetchMock);

    await fetchService(42, "2026-03-05");

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("/api/services/42");
    expect(calledUrl).toContain("departuresDate=2026-03-05");
  });

  it("throws when upstream response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503
      })
    );

    await expect(fetchServices()).rejects.toThrow("Failed services request: 503");
  });
});
