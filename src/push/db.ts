import type Database from "better-sqlite3";
import type { DeviceType } from "../api/types.js";

export type PushInstallation = {
  installationId: string;
  deviceToken: string;
  deviceType: DeviceType;
};

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
