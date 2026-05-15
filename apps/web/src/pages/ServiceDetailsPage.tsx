import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { fetchService } from "../api/services";
import { AppPromo } from "../components/AppPromo";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeading } from "../components/SiteHeading";
import type { Service } from "../types";
import { isDateInput, toDateInput } from "../utils/date";
import { DisruptionDetailsModal } from "./service-details/DisruptionDetailsModal";
import { ServiceSummaryPanel } from "./service-details/ServiceSummaryPanel";

export function ServiceDetailsPage(): React.JSX.Element {
  const params = useParams();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const serviceId = Number(params.id);
  const routedService = (location.state as { service?: Service } | null)?.service;
  const defaultDateValue = toDateInput(new Date());
  const searchDateValue = searchParams.get("departuresDate");
  const dateValue = isDateInput(searchDateValue) ? searchDateValue : defaultDateValue;
  const initialService = useMemo(() => {
    if (routedService?.serviceId === serviceId) {
      return routedService;
    }

    return null;
  }, [routedService, serviceId]);

  const [service, setService] = useState<Service | null>(initialService ?? null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showDisruptionModal, setShowDisruptionModal] = useState(false);

  const loadDetails = useCallback(async () => {
    if (Number.isNaN(serviceId)) {
      return;
    }

    setErrorMessage(null);

    try {
      const latest = await fetchService(serviceId, dateValue);
      setService(latest);
    } catch {
      setErrorMessage("Could not load latest service details.");
    }
  }, [dateValue, serviceId]);

  const displayedService = initialService ?? service;

  useEffect(() => {
    void loadDetails();
  }, [serviceId]);

  useEffect(() => {
    if (Number.isNaN(serviceId)) {
      return;
    }

    if (searchDateValue === dateValue) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("departuresDate", dateValue);
    setSearchParams(nextParams, { replace: true });
  }, [dateValue, searchDateValue, searchParams, serviceId, setSearchParams]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [serviceId]);

  const handleDeparturesDateChange = (nextDate: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("departuresDate", nextDate);
    setSearchParams(nextParams);
  };

  const handleOpenDisruptionDetails = useCallback(() => {
    setShowDisruptionModal(true);
  }, []);

  useEffect(() => {
    if (!showDisruptionModal) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowDisruptionModal(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showDisruptionModal]);

  if (Number.isNaN(serviceId)) {
    return <Navigate to="/" replace />;
  }

  const hasAdditionalInfo = Boolean(displayedService?.additionalInfo && displayedService.additionalInfo.trim().length > 0);

  return (
    <main>
      <SiteHeading />
      <div className="content-with-promo">
        <div className="primary-content">
          {errorMessage && !displayedService && <p className="muted">{errorMessage}</p>}

          {displayedService && (
            <>
              <ServiceSummaryPanel
                departuresDate={dateValue}
                departuresInitialLocations={displayedService.locations}
                departuresInitialScheduledDeparturesAvailable={displayedService.scheduledDeparturesAvailable}
                service={displayedService}
                hasAdditionalInfo={hasAdditionalInfo}
                onDeparturesDateChange={handleDeparturesDateChange}
                onOpenDisruptionDetails={handleOpenDisruptionDetails}
              />
            </>
          )}
        </div>
        <aside className="promo-column">
          <AppPromo />
        </aside>
      </div>
      {displayedService && hasAdditionalInfo && showDisruptionModal && (
        <DisruptionDetailsModal
          area={displayedService.area}
          additionalInfo={displayedService.additionalInfo ?? ""}
          onClose={() => setShowDisruptionModal(false)}
        />
      )}
      <SiteFooter />
    </main>
  );
}
