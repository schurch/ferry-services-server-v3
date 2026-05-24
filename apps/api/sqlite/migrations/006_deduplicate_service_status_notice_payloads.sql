CREATE TABLE IF NOT EXISTS service_status_notice_payloads (
    payload_id INTEGER PRIMARY KEY AUTOINCREMENT,
    detail_text TEXT NULL,
    detail_markdown TEXT NULL,
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS service_status_notice_payloads_body_idx
    ON service_status_notice_payloads (
        coalesce(detail_text, ''),
        coalesce(detail_markdown, '')
    );

ALTER TABLE service_status_observation_notices
    ADD COLUMN payload_id INTEGER NULL REFERENCES service_status_notice_payloads (payload_id);

INSERT OR IGNORE INTO service_status_notice_payloads (detail_text, detail_markdown)
SELECT DISTINCT detail_text, detail_markdown
FROM service_status_observation_notices
WHERE detail_text IS NOT NULL
   OR detail_markdown IS NOT NULL;

UPDATE service_status_observation_notices
SET payload_id = (
    SELECT payload_id
    FROM service_status_notice_payloads payload
    WHERE coalesce(payload.detail_text, '') = coalesce(service_status_observation_notices.detail_text, '')
      AND coalesce(payload.detail_markdown, '') = coalesce(service_status_observation_notices.detail_markdown, '')
)
WHERE detail_text IS NOT NULL
   OR detail_markdown IS NOT NULL;

UPDATE service_status_observation_notices
SET detail_text = NULL,
    detail_markdown = NULL
WHERE payload_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS service_status_observation_notices_payload_id_idx
    ON service_status_observation_notices (payload_id);
