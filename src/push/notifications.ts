import type Database from "better-sqlite3";
import {
  deleteInstallation,
  listPushInstallationsForService,
  recordPushError,
  recordPushSuccess
} from "./db.js";
import { sendApnsMessage } from "./apns.js";
import { sendFcmMessage } from "./fcm.js";
import {
  applePushPayload,
  googlePushPayload,
  shouldNotifyForServiceUpdate,
  type PushNotificationReason,
  type PushService
} from "./payload.js";
import { logger } from "../logger.js";
import { summariseInformationChange } from "./information-summary.js";

export async function notifyForServiceStatusChanges(
  db: Database.Database,
  newServices: PushService[],
  oldServices: Map<number, PushService>
): Promise<void> {
  for (const service of newServices) {
    const oldService = oldServices.get(service.serviceId) ?? null;
    if (!shouldNotifyForServiceUpdate(service, oldService)) {
      continue;
    }

    logger.debug(
      {
        serviceId: service.serviceId,
        previousStatus: oldService?.status ?? null,
        nextStatus: service.status,
        informationChanged: oldService?.notificationInfo !== undefined
          && service.notificationInfo !== oldService.notificationInfo
      },
      "Service update qualifies for push notification"
    );
    const reason: PushNotificationReason = service.status === oldService?.status
      ? "information-change"
      : "status-change";
    await notifyForService(db, service, oldService, reason);
  }
}

async function notifyForService(
  db: Database.Database,
  service: PushService,
  oldService: PushService | null,
  reason: PushNotificationReason
): Promise<void> {
  const installations = listPushInstallationsForService(db, service.serviceId);
  let body: string | undefined;
  if (installations.length > 0 && reason === "information-change") {
    const summary = await summariseInformationChange(oldService?.notificationInfo, service.notificationInfo);
    if (summary.outcome === "suppressed") {
      logger.info({ serviceId: service.serviceId }, "Suppressing push for non-material information change");
      return;
    }
    body = summary.body ?? undefined;
    logger.info({ serviceId: service.serviceId, summaryOutcome: summary.outcome }, "Prepared information-change push message");
  }
  let successCount = 0;
  let invalidTokenCount = 0;
  let skippedCount = 0;
  let failureCount = 0;

  for (const installation of installations) {
    try {
      const result = installation.deviceType === "IOS"
        ? await sendApnsMessage(installation.deviceToken, applePushPayload(service, reason, body))
        : await sendFcmMessage(installation.deviceToken, googlePushPayload(service, reason, body));

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
