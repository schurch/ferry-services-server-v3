import type Database from "better-sqlite3";
import {
  deleteInstallation,
  listPushInstallationsForService,
  recordPushError,
  recordPushSuccess
} from "../db/installations.js";
import { sendApnsMessage } from "./apns.js";
import { sendFcmMessage } from "./fcm.js";
import { applePushPayload, googlePushPayload, shouldNotifyForServiceStatusChange, type PushService } from "./payload.js";

export async function notifyForServiceStatusChanges(
  db: Database.Database,
  newServices: PushService[],
  oldServices: Map<number, PushService>
): Promise<void> {
  for (const service of newServices) {
    const oldService = oldServices.get(service.serviceId) ?? null;
    if (!shouldNotifyForServiceStatusChange(service, oldService)) {
      continue;
    }

    await notifyForService(db, service);
  }
}

async function notifyForService(db: Database.Database, service: PushService): Promise<void> {
  for (const installation of listPushInstallationsForService(db, service.serviceId)) {
    try {
      const result = installation.deviceType === "IOS"
        ? await sendApnsMessage(installation.deviceToken, applePushPayload(service))
        : await sendFcmMessage(installation.deviceToken, googlePushPayload(service));

      if (result === "success") {
        recordPushSuccess(db, installation.installationId);
      } else if (result === "invalid-token") {
        deleteInstallation(db, installation.installationId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordPushError(db, installation.installationId, message);
      console.error(`Push failed for installation ${installation.installationId}: ${message}`);
    }
  }
}
