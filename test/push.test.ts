import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applePushPayload,
  defaultNotificationMessage,
  googlePushPayload,
  shouldNotifyForServiceStatusChange
} from "../src/push/payload.js";
import { classifyApnsFailure } from "../src/push/apns.js";

const baseService = {
  serviceId: 5,
  area: "Arran",
  route: "Ardrossan (ARD) - Brodick (BRO)"
};

describe("push notification payloads", () => {
  it("notifies only when an existing service changes to a known status", () => {
    assert.equal(
      shouldNotifyForServiceStatusChange(
        { ...baseService, status: 1 },
        { ...baseService, status: -99 }
      ),
      true
    );
    assert.equal(
      shouldNotifyForServiceStatusChange(
        { ...baseService, status: -99 },
        { ...baseService, status: 0 }
      ),
      false
    );
    assert.equal(
      shouldNotifyForServiceStatusChange(
        { ...baseService, status: 1 },
        { ...baseService, status: 1 }
      ),
      false
    );
    assert.equal(shouldNotifyForServiceStatusChange({ ...baseService, status: 1 }, null), false);
  });

  it("keeps the mobile iOS and Android payload contract", () => {
    const disrupted = { ...baseService, status: 1 as const };

    assert.equal(
      defaultNotificationMessage(disrupted),
      "There is a disruption to the service Ardrossan (ARD) - Brodick (BRO)"
    );
    assert.deepEqual(applePushPayload(disrupted), {
      aps: {
        alert: {
          title: "Arran",
          body: "There is a disruption to the service Ardrossan (ARD) - Brodick (BRO)"
        },
        sound: "default"
      },
      service_id: 5
    });
    assert.deepEqual(googlePushPayload(disrupted), {
      data: {
        service_id: "5",
        title: "Arran sailings disrupted",
        body: "Ardrossan (ARD) - Brodick (BRO)"
      },
      priority: "high",
      android: {
        priority: "HIGH"
      }
    });
  });
});

describe("APNs failure handling", () => {
  it("deletes only tokens APNs says are unregistered", () => {
    assert.equal(classifyApnsFailure(410, JSON.stringify({ reason: "Unregistered" })), "invalid-token");
  });

  it("keeps tokens when APNs reports an environment or topic mismatch", () => {
    assert.equal(classifyApnsFailure(400, JSON.stringify({ reason: "BadDeviceToken" })), "error");
    assert.equal(classifyApnsFailure(400, JSON.stringify({ reason: "DeviceTokenNotForTopic" })), "error");
  });
});
