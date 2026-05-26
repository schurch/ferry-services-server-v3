CREATE INDEX IF NOT EXISTS idx_installations_updated ON installations (updated);

CREATE TABLE IF NOT EXISTS installation_registration_attempts (
    client_ip TEXT NOT NULL,
    device_token_sha256 TEXT NOT NULL,
    installation_id TEXT NOT NULL,
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_installation_registration_attempts_ip_created
    ON installation_registration_attempts (client_ip, created);

CREATE INDEX IF NOT EXISTS idx_installation_registration_attempts_created
    ON installation_registration_attempts (created);

CREATE INDEX IF NOT EXISTS idx_installation_registration_attempts_token_created
    ON installation_registration_attempts (device_token_sha256, created);
