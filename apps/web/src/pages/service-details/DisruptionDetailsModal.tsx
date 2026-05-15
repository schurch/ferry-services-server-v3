import type React from "react";

export function DisruptionDetailsModal({
  area,
  additionalInfo,
  onClose
}: {
  area: string;
  additionalInfo: string;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>{area} disruption details</h2>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close disruption details">
            x
          </button>
        </div>
        <div className="modal-content" dangerouslySetInnerHTML={{ __html: additionalInfo }} />
      </div>
    </div>
  );
}
