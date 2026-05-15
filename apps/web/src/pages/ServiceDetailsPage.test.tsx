import type React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceDetailsPage } from "./ServiceDetailsPage";
import type { Service } from "../types";

vi.mock("../api/services", () => ({
  fetchService: vi.fn()
}));

vi.mock("../components/GoogleServiceMap", () => ({
  GoogleServiceMap: ({ serviceArea }: { serviceArea: string }): React.JSX.Element => (
    <div data-testid="google-map">Map for {serviceArea}</div>
  )
}));

import { fetchService } from "../api/services";

const mockFetchService = vi.mocked(fetchService);

const baseService: Service = {
  serviceId: 7,
  status: "disrupted",
  area: "Hebrides",
  route: "Port A to Port B",
  disruptionReason: "High winds",
  lastUpdatedDate: "2026-03-05T10:00:00Z",
  updated: "2026-03-05T10:00:00Z",
  additionalInfo: "<p>Heavy swell expected.</p>",
  scheduledDeparturesAvailable: true,
  operator: {
    id: 1,
    name: "CalMac",
    website: "https://example.com",
    localNumber: "01234 567890",
    internationalNumber: null,
    email: "help@example.com",
    x: null,
    facebook: null
  },
  locations: [
    {
      id: 1,
      name: "Port A",
      latitude: 56,
      longitude: -4,
      weather: {
        description: "Cloudy",
        icon: "",
        temperatureCelsius: 8,
        windSpeedMph: 25,
        windDirection: 180,
        windDirectionCardinal: "S"
      },
      scheduledDepartures: [
        {
          departure: "2099-03-05T12:00:00Z",
          arrival: "2099-03-05T13:00:00Z",
          destination: {
            id: 2,
            name: "Port B",
            latitude: 56.2,
            longitude: -4.2
          }
        }
      ],
      nextDeparture: {
        departure: "2099-03-05T12:00:00Z",
        arrival: "2099-03-05T13:00:00Z",
        destination: {
          id: 2,
          name: "Port B",
          latitude: 56.2,
          longitude: -4.2
        }
      },
      nextRailDeparture: {
        from: "Station A",
        to: "Station B",
        departure: "2099-03-05T11:30:00Z",
        departureInfo: "On time",
        isCancelled: false,
        platform: "2"
      }
    }
  ],
  vessels: [
    {
      latitude: 56.1,
      longitude: -4.1,
      name: "MV Test",
      speed: 11,
      course: 90,
      lastReceived: "2026-03-05T09:58:00Z"
    }
  ]
};

function renderPage({
  path,
  state
}: {
  path: string;
  state?: Record<string, unknown>;
}): ReturnType<typeof render> {
  const entries = state ? [{ pathname: path, state }] : [path];

  return render(
    <MemoryRouter initialEntries={entries}>
      <Routes>
        <Route path="/" element={<div>Home page</div>} />
        <Route path="/service/:id" element={<ServiceDetailsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ServiceDetailsPage", () => {
  beforeEach(() => {
    mockFetchService.mockReset();
    mockFetchService.mockResolvedValue(baseService);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads and renders service details from API", async () => {
    renderPage({ path: "/service/7?departuresDate=2026-03-06" });

    await screen.findByText("Hebrides");

    expect(screen.getByText("Port A to Port B", { selector: "div.muted" })).toBeInTheDocument();
    expect(screen.getByText("Scheduled Departures")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Locations" })).toBeInTheDocument();
    expect(screen.getAllByText("12:00")).toHaveLength(2);
    expect(screen.getByText("13:00")).toBeInTheDocument();
    expect(screen.queryByText(/Depart /)).not.toBeInTheDocument();
    expect(screen.queryByText(/Arrive /)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "CalMac" })).toBeInTheDocument();
    expect(screen.getByLabelText("Scheduled departures date")).toHaveValue("2026-03-06");
    expect(screen.getByTestId("google-map")).toHaveTextContent("Map for Hebrides");
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "auto" });

    await waitFor(() => {
      expect(mockFetchService).toHaveBeenCalledWith(7, "2026-03-06");
    });
  });

  it("updates departures date from the picker", async () => {
    renderPage({ path: "/service/7?departuresDate=2026-03-06" });

    await screen.findByText("Hebrides");

    fireEvent.change(screen.getByLabelText("Scheduled departures date"), {
      target: { value: "2026-03-07" }
    });

    await waitFor(() => {
      expect(mockFetchService).toHaveBeenLastCalledWith(7, "2026-03-07");
    });
  });

  it("opens disruption modal and closes it on Escape", async () => {
    renderPage({ path: "/service/7", state: { service: baseService } });

    await screen.findByText("Hebrides");

    fireEvent.click(screen.getByRole("button", { name: "View disruption details" }));
    expect(screen.getByText("Hebrides disruption details")).toBeInTheDocument();
    expect(screen.getByText("Heavy swell expected.")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("Hebrides disruption details")).not.toBeInTheDocument();
    });
  });

  it("redirects invalid service IDs to home route", async () => {
    renderPage({ path: "/service/not-a-number" });

    await screen.findByText("Home page");
    expect(mockFetchService).not.toHaveBeenCalled();
  });
});
