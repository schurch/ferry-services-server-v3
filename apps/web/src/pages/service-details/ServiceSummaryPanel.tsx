import React from "react";
import { GoogleServiceMap } from "../../components/GoogleServiceMap";
import { getGoogleMapPoints } from "../../maps/points";
import type { Location, Service } from "../../types";
import { formatDateTime } from "../../utils/date";
import { disruptionText, statusLabel } from "../../utils/status";
import { OperatorContactActions } from "./OperatorContactActions";
import { ScheduledDeparturesPanel } from "./ScheduledDeparturesPanel";
import { ServiceLocations } from "./ServiceLocations";

function ServiceSummaryPanelInner({
  departuresDate,
  departuresInitialLocations,
  departuresInitialScheduledDeparturesAvailable,
  service,
  hasAdditionalInfo,
  onDeparturesDateChange,
  onOpenDisruptionDetails
}: {
  departuresDate: string;
  departuresInitialLocations: Location[];
  departuresInitialScheduledDeparturesAvailable: boolean;
  service: Service;
  hasAdditionalInfo: boolean;
  onDeparturesDateChange: (nextDate: string) => void;
  onOpenDisruptionDetails: () => void;
}): React.JSX.Element {
  const mapPoints = getGoogleMapPoints(service);

  return (
    <section className="panel service-summary">
      <h1 className="title" style={{ marginBottom: 0, fontSize: "1.1rem" }}>
        {service.area}
      </h1>
      <div className="muted" style={{ marginBottom: 12 }}>
        {service.route}
      </div>
      <div className={`status-inline status-text status-${service.status}`}>
        <span className={`status-dot status-${service.status}`} aria-hidden="true" />
        <span>{statusLabel(service.status)}</span>
      </div>
      <p style={{ marginTop: 12, marginBottom: 0 }}>{disruptionText(service.status)}</p>
      {service.disruptionReason && (
        <p className="small" style={{ marginBottom: 0 }}>
          {service.disruptionReason}
        </p>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>
        Last updated: {formatDateTime(service.lastUpdatedDate ?? service.updated)}
      </p>
      {hasAdditionalInfo && (
        <p style={{ marginBottom: 0 }}>
          <button className="link-button" type="button" onClick={onOpenDisruptionDetails}>
            View disruption details
          </button>
        </p>
      )}
      <div className="panel-map-bleed">
        <GoogleServiceMap serviceArea={service.area} points={mapPoints} />
      </div>

      <ServiceLocations service={service} />
      <ScheduledDeparturesPanel
        departuresDate={departuresDate}
        initialLocations={departuresInitialLocations}
        initialScheduledDeparturesAvailable={departuresInitialScheduledDeparturesAvailable}
        onDeparturesDateChange={onDeparturesDateChange}
        serviceId={service.serviceId}
      />
      {service.operator && <OperatorContactActions operator={service.operator} />}
    </section>
  );
}

export const ServiceSummaryPanel = React.memo(ServiceSummaryPanelInner);
