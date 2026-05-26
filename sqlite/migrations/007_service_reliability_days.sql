CREATE TABLE IF NOT EXISTS service_reliability_days (
    service_id INTEGER NOT NULL REFERENCES services (service_id) ON DELETE CASCADE,
    observed_date TEXT NOT NULL,
    status INTEGER NOT NULL CHECK (status IN (0, 1, 2)),
    scheduled_sailings INTEGER NOT NULL CHECK (scheduled_sailings >= 0),
    first_observed_at TEXT NOT NULL,
    last_observed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (service_id, observed_date)
);

CREATE INDEX IF NOT EXISTS service_reliability_days_service_date_idx
    ON service_reliability_days (service_id, observed_date);
