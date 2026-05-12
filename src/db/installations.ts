import type Database from "better-sqlite3";
import type { CreateInstallationRequest, PushStatus } from "../types/api.js";

type InstallationRow = {
  push_enabled: number;
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
