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
import { logger } from "../logger.js";

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

    logger.debug(
      { serviceId: service.serviceId, previousStatus: oldService?.status ?? null, nextStatus: service.status },
      "Service status change qualifies for push notification"
    );
    await notifyForService(db, service);
  }
}

async function notifyForService(db: Database.Database, service: PushService): Promise<void> {
  const installations = listPushInstallationsForService(db, service.serviceId);
  let successCount = 0;
  let invalidTokenCount = 0;
  let skippedCount = 0;
  let failureCount = 0;

  for (const installation of installations) {
    try {
      const result = installation.deviceType === "IOS"
        ? await sendApnsMessage(installation.deviceToken, applePushPayload(service))
        : await sendFcmMessage(installation.deviceToken, googlePushPayload(service));

      if (result === "success") {
        recordPushSuccess(db, installation.installationId);
        successCount += 1;
      } else if (result === "invalid-token") {
        deleteInstallation(db, installation.installationId);
        invalidTokenCount += 1;
      } else {
        skippedCount += 1;
        logger.warn(
          { installationId: installation.installationId, serviceId: service.serviceId, deviceType: installation.deviceType },
          "Push skipped because provider is not configured"
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordPushError(db, installation.installationId, message);
      failureCount += 1;
      logger.error({ err: error, installationId: installation.installationId, serviceId: service.serviceId }, "Push failed");
    }
  }

  logger.info(
    {
      serviceId: service.serviceId,
      installationCount: installations.length,
      successCount,
      invalidTokenCount,
      skippedCount,
      failureCount
    },
    "Push notification batch complete"
  );
}
