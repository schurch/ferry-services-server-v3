CREATE TABLE IF NOT EXISTS service_scrape_runs (
    scrape_run_id INTEGER PRIMARY KEY AUTOINCREMENT,
    operator_name TEXT NOT NULL,
    organisation_id INTEGER NULL REFERENCES organisations (organisation_id),
    source_name TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT NULL,
    success INTEGER NOT NULL DEFAULT 0,
    error TEXT NULL
);

CREATE TABLE IF NOT EXISTS service_status_observations (
    observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    scrape_run_id INTEGER NOT NULL REFERENCES service_scrape_runs (scrape_run_id) ON DELETE CASCADE,
    service_id INTEGER NOT NULL REFERENCES services (service_id),
    observed_at TEXT NOT NULL,
    source_service_id TEXT NULL,
    source_service_code TEXT NULL,
    source_area_id TEXT NULL,
    source_area_name TEXT NULL,
    source_area_latitude REAL NULL,
    source_area_longitude REAL NULL,
    status INTEGER NOT NULL,
    source_status TEXT NULL,
    disruption_reason TEXT NULL,
    last_updated_date TEXT NULL
);

CREATE TABLE IF NOT EXISTS service_status_observation_notices (
    notice_id INTEGER PRIMARY KEY AUTOINCREMENT,
    observation_id INTEGER NOT NULL REFERENCES service_status_observations (observation_id) ON DELETE CASCADE,
    source_notice_key TEXT NOT NULL,
    source_notice_type TEXT NULL,
    title TEXT NOT NULL,
    disruption_reason TEXT NULL,
    detail_text TEXT NULL,
    detail_markdown TEXT NULL,
    display_order INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS service_scrape_runs_started_at_idx
    ON service_scrape_runs (started_at);

CREATE INDEX IF NOT EXISTS service_scrape_runs_operator_started_at_idx
    ON service_scrape_runs (operator_name, started_at);

CREATE INDEX IF NOT EXISTS service_status_observations_service_observed_at_idx
    ON service_status_observations (service_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS service_status_observations_scrape_run_id_idx
    ON service_status_observations (scrape_run_id);

CREATE INDEX IF NOT EXISTS service_status_observation_notices_observation_id_idx
    ON service_status_observation_notices (observation_id);

CREATE INDEX IF NOT EXISTS service_status_observation_notices_disruption_reason_idx
    ON service_status_observation_notices (disruption_reason);
