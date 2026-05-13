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
