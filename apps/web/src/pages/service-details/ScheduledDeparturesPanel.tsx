import type React from "react";
import { useEffect, useRef, useState } from "react";
import { fetchService } from "../../api/services";
import type { Location, ScheduledDeparture } from "../../types";
import { formatTime } from "../../utils/date";

export function ScheduledDeparturesPanel({
  departuresDate,
  initialLocations,
  initialScheduledDeparturesAvailable,
  onDeparturesDateChange
  ,
  serviceId
}: {
  departuresDate: string;
  initialLocations: Location[];
  initialScheduledDeparturesAvailable: boolean;
  onDeparturesDateChange: (nextDate: string) => void;
  serviceId: number;
}): React.JSX.Element | null {
  const [locations, setLocations] = useState<Location[]>(initialLocations);
  const [scheduledDeparturesAvailable, setScheduledDeparturesAvailable] = useState(
    initialScheduledDeparturesAvailable
  );
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const previousDateRef = useRef(departuresDate);

  useEffect(() => {
    setLocations(initialLocations);
    setScheduledDeparturesAvailable(initialScheduledDeparturesAvailable);
    setLoading(false);
    setErrorMessage(null);
    previousDateRef.current = departuresDate;
  }, [initialLocations, initialScheduledDeparturesAvailable, serviceId]);

  useEffect(() => {
    if (previousDateRef.current === departuresDate) {
      return;
    }

    previousDateRef.current = departuresDate;
    let cancelled = false;

    const loadDepartures = async () => {
      setLoading(true);
      setErrorMessage(null);

      try {
        const latest = await fetchService(serviceId, departuresDate);
        if (cancelled) {
          return;
        }

        setLocations(latest.locations);
        setScheduledDeparturesAvailable(latest.scheduledDeparturesAvailable);
      } catch {
        if (!cancelled) {
          setErrorMessage("Could not load scheduled departures.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadDepartures();

    return () => {
      cancelled = true;
    };
  }, [departuresDate, serviceId]);

  if (!scheduledDeparturesAvailable) {
    return null;
  }

  const locationsWithDepartures = locations.filter((currentLocation) => currentLocation.scheduledDepartures.length > 0);

  if (locationsWithDepartures.length === 0) {
    return null;
  }

  return (
    <>
      <div className="panel-divider" />
      <div className="section-header">
        <h2 className="title card-subtitle">Scheduled Departures</h2>
        <label className="date-picker">
          <span className="sr-only">Scheduled departures date</span>
          <input
            className="date-input"
            type="date"
            value={departuresDate}
            onChange={(event) => onDeparturesDateChange(event.target.value)}
            aria-label="Scheduled departures date"
          />
        </label>
      </div>
      {errorMessage && <p className="small muted section-status">{errorMessage}</p>}
      {locationsWithDepartures
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((currentLocation) => {
          const groupedByDestination = new Map<number, ScheduledDeparture[]>();
          for (const departure of currentLocation.scheduledDepartures) {
            const existing = groupedByDestination.get(departure.destination.id) ?? [];
            existing.push(departure);
            groupedByDestination.set(departure.destination.id, existing);
          }

          return Array.from(groupedByDestination.entries()).map(([destinationId, departures]) => {
            const destinationName = departures[0]?.destination.name ?? "Destination";
            return (
              <article className="departures-route" key={`${currentLocation.id}-${destinationId}`}>
                <h3>
                  {currentLocation.name} to {destinationName}
                </h3>
                {departures
                  .slice()
                  .sort((a, b) => a.departure.localeCompare(b.departure))
                  .map((departure) => {
                    const hasDeparted = new Date(departure.departure).getTime() < Date.now();
                    return (
                      <div
                        className={`departure-row ${hasDeparted ? "departure-dim" : ""}`}
                        key={`${departure.departure}-${departure.arrival}`}
                      >
                        <span>{formatTime(departure.departure)}</span>
                        <span>{formatTime(departure.arrival)}</span>
                      </div>
                    );
                  })}
              </article>
            );
          });
        })}
    </>
  );
}
