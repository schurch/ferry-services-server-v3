import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applePushPayload,
  defaultNotificationMessage,
  googlePushPayload,
  notificationTitle,
  shouldNotifyForServiceUpdate
} from "./payload.js";
import { classifyApnsFailure } from "./apns.js";

const baseService = {
  serviceId: 5,
  area: "Arran",
  route: "Ardrossan (ARD) - Brodick (BRO)"
};

describe("push notification payloads", () => {
  it("notifies when an existing service changes to a known status", () => {
    assert.equal(
      shouldNotifyForServiceUpdate(
        { ...baseService, status: 1 },
        { ...baseService, status: -99 }
      ),
      true
    );
    assert.equal(
      shouldNotifyForServiceUpdate(
        { ...baseService, status: -99 },
        { ...baseService, status: 0 }
      ),
      false
    );
    assert.equal(
      shouldNotifyForServiceUpdate(
        { ...baseService, status: 1 },
        { ...baseService, status: 1 }
      ),
      false
    );
    assert.equal(shouldNotifyForServiceUpdate({ ...baseService, status: 1 }, null), false);
  });

  it("notifies when information changes after an initial baseline has been recorded", () => {
    assert.equal(
      shouldNotifyForServiceUpdate(
        { ...baseService, status: 1, notificationInfo: "Updated sailings" },
        { ...baseService, status: 1, notificationInfo: "Original sailings" }
      ),
      true
    );
    assert.equal(
      shouldNotifyForServiceUpdate(
        { ...baseService, status: 1, notificationInfo: "Initial sailings" },
        { ...baseService, status: 1 }
      ),
      false
    );
    assert.equal(
      shouldNotifyForServiceUpdate(
        { ...baseService, status: -99, notificationInfo: "Updated sailings" },
        { ...baseService, status: 1, notificationInfo: "Original sailings" }
      ),
      false
    );
  });

  it("keeps the mobile iOS and Android payload contract", () => {
    const disrupted = { ...baseService, status: 1 as const };

    assert.equal(
      defaultNotificationMessage(disrupted),
      "There is a disruption affecting this service."
    );
    assert.deepEqual(applePushPayload(disrupted), {
      aps: {
        alert: {
          title: "Ardrossan - Brodick disrupted",
          body: "There is a disruption affecting this service."
        },
        sound: "default"
      },
      service_id: 5
    });
    assert.deepEqual(googlePushPayload(disrupted), {
      data: {
        service_id: "5",
        title: "Ardrossan - Brodick disrupted",
        body: "There is a disruption affecting this service."
      },
      priority: "high",
      android: {
        priority: "HIGH"
      }
    });
  });

  it("describes information-only notifications without implying a status change", () => {
    const normal = { ...baseService, status: 0 as const };

    assert.deepEqual(applePushPayload(normal, "information-change").aps.alert, {
      title: "Ardrossan - Brodick updated",
      body: "Sailing information has been updated."
    });
    assert.deepEqual(googlePushPayload(normal, "information-change").data, {
      service_id: "5",
      title: "Ardrossan - Brodick updated",
      body: "Sailing information has been updated."
    });
  });

  it("keeps route-based titles short", () => {
    assert.equal(
      notificationTitle({
        ...baseService,
        route: "Scrabster - Stromness / Aberdeen - Kirkwall - Lerwick",
        status: 1
      }),
      "Scrabster - Stromness / Aberdeen... disrupted"
    );
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
