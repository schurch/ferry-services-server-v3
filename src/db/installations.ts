import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { CreateInstallationRequest, DeviceType, PushStatus } from "../types/api.js";

type InstallationRow = {
  push_enabled: number;
};

export type PushInstallation = {
  installationId: string;
  deviceToken: string;
  deviceType: DeviceType;
};

export type RegistrationAttemptResult =
  | { allowed: true }
  | { allowed: false; reason: "duplicate-churn" | "ip-rate-limit" };

type CountRow = {
  count: number;
};

function isoTimestamp(date: Date): string {
  return date.toISOString();
}

function shiftedIsoTimestamp(now: Date, deltaMs: number): string {
  return new Date(now.getTime() + deltaMs).toISOString();
}

export function hashDeviceToken(deviceToken: string): string {
  return crypto.createHash("sha256").update(deviceToken).digest("hex");
}

export function upsertInstallation(
  db: Database.Database,
  installationId: string,
  request: CreateInstallationRequest,
  now = new Date()
): void {
  db.prepare(`
    INSERT INTO installations (installation_id, device_token, device_type, updated)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (installation_id) DO UPDATE
      SET device_token = excluded.device_token,
          device_type = excluded.device_type,
          updated = excluded.updated
  `).run(installationId, request.deviceToken, request.deviceType, now.toISOString());
}

export function getPushStatus(db: Database.Database, installationId: string): PushStatus | null {
  const row = db.prepare(`
    SELECT push_enabled
    FROM installations
    WHERE installation_id = ?
  `).get(installationId) as InstallationRow | undefined;

  return row ? { enabled: row.push_enabled !== 0 } : null;
}

export function updatePushStatus(db: Database.Database, installationId: string, status: PushStatus): PushStatus | null {
  const result = db.prepare(`
    UPDATE installations
    SET push_enabled = ?, updated = ?
    WHERE installation_id = ?
  `).run(status.enabled ? 1 : 0, new Date().toISOString(), installationId);

  return result.changes > 0 ? status : null;
}

export function addInstallationService(db: Database.Database, installationId: string, serviceId: number): void {
  db.prepare(`
    INSERT INTO installation_services (installation_id, service_id)
    VALUES (?, ?)
    ON CONFLICT DO NOTHING
  `).run(installationId, serviceId);
}

export function deleteInstallationService(db: Database.Database, installationId: string, serviceId: number): void {
  db.prepare(`
    DELETE FROM installation_services
    WHERE installation_id = ? AND service_id = ?
  `).run(installationId, serviceId);
}

export function listPushInstallationsForService(db: Database.Database, serviceId: number): PushInstallation[] {
  return db.prepare(`
    SELECT i.installation_id, i.device_token, i.device_type
    FROM installation_services s
    JOIN installations i ON i.installation_id = s.installation_id
    WHERE s.service_id = ? AND i.push_enabled = 1
    ORDER BY i.installation_id
  `).all(serviceId).map((row) => {
    const installation = row as { installation_id: string; device_token: string; device_type: DeviceType };
    return {
      installationId: installation.installation_id,
      deviceToken: installation.device_token,
      deviceType: installation.device_type
    };
  });
}

export function deleteInstallation(db: Database.Database, installationId: string): void {
  db.prepare("DELETE FROM installations WHERE installation_id = ?").run(installationId);
}

export function recordPushSuccess(db: Database.Database, installationId: string): void {
  db.prepare(`
    UPDATE installations
    SET last_push_success_at = CURRENT_TIMESTAMP,
        last_push_error_at = NULL,
        last_push_error = NULL
    WHERE installation_id = ?
  `).run(installationId);
}

export function recordPushError(db: Database.Database, installationId: string, error: string): void {
  db.prepare(`
    UPDATE installations
    SET last_push_error_at = CURRENT_TIMESTAMP,
        last_push_error = ?
    WHERE installation_id = ?
  `).run(error.slice(0, 1000), installationId);
}

export function checkAndRecordInstallationRegistrationAttempt(
  db: Database.Database,
  installationId: string,
  clientIp: string,
  deviceToken: string,
  now = new Date()
): RegistrationAttemptResult {
  const deviceTokenHash = hashDeviceToken(deviceToken);
  const duplicateWindowStart = shiftedIsoTimestamp(now, -24 * 60 * 60 * 1000);
  const ipWindowStart = shiftedIsoTimestamp(now, -60 * 60 * 1000);
  const currentTimestamp = isoTimestamp(now);

  const duplicateAttempt = db.prepare(`
    SELECT 1
    FROM installation_registration_attempts
    WHERE client_ip = ?
      AND device_token_sha256 = ?
      AND installation_id != ?
      AND created >= ?
    LIMIT 1
  `).get(clientIp, deviceTokenHash, installationId, duplicateWindowStart);

  if (duplicateAttempt) {
    return { allowed: false, reason: "duplicate-churn" };
  }

  const recentAttempts = db.prepare(`
    SELECT COUNT(*) AS count
    FROM installation_registration_attempts
    WHERE client_ip = ?
      AND created >= ?
  `).get(clientIp, ipWindowStart) as CountRow;

  if (recentAttempts.count >= 30) {
    return { allowed: false, reason: "ip-rate-limit" };
  }

  db.prepare(`
    INSERT INTO installation_registration_attempts (
      client_ip,
      device_token_sha256,
      installation_id,
      created
    )
    VALUES (?, ?, ?, ?)
  `).run(clientIp, deviceTokenHash, installationId, currentTimestamp);

  return { allowed: true };
}

export function deleteStaleInstallations(
  db: Database.Database,
  now = new Date(),
  maxInstallationAgeDays = 90,
  maxAttemptAgeDays = 7
): { deletedInstallations: number; deletedAttempts: number } {
  const staleInstallationCutoff = shiftedIsoTimestamp(now, -(maxInstallationAgeDays * 24 * 60 * 60 * 1000));
  const staleAttemptCutoff = shiftedIsoTimestamp(now, -(maxAttemptAgeDays * 24 * 60 * 60 * 1000));

  const deletedInstallations = db.prepare(`
    DELETE FROM installations
    WHERE updated < ?
  `).run(staleInstallationCutoff).changes;

  const deletedAttempts = db.prepare(`
    DELETE FROM installation_registration_attempts
    WHERE created < ?
  `).run(staleAttemptCutoff).changes;

  return {
    deletedInstallations: deletedInstallations ?? 0,
    deletedAttempts: deletedAttempts ?? 0
  };
}
