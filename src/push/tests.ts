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
import { summariseInformationChange } from "./information-summary.js";

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

  it("uses an information summary override in mobile payloads", () => {
    const normal = { ...baseService, status: 0 as const };
    const body = "MV Isle of Islay will operate stern only.";

    assert.equal(applePushPayload(normal, "information-change", body).aps.alert.body, body);
    assert.equal(googlePushPayload(normal, "information-change", body).data.body, body);
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

describe("information-change summaries", () => {
  it("suppresses punctuation-only notice changes", async () => {
    const summary = await summariseInformationChange(
      notices("No hot food service on 1 June ."),
      notices("No hot food service on 1 June."),
      { apiKey: null }
    );

    assert.deepEqual(summary, { body: null, outcome: "suppressed" });
  });

  it("rewrites current changed facts with OpenAI", async () => {
    let requestBody: Record<string, unknown> | undefined;
    let requestUrl = "";
    let authorization = "";
    const summary = await summariseInformationChange(
      notices("The 13:30 sailing is delayed."),
      notices("The delay is resolved. The vessel departed Oban. ETA Castlebay 19:40."),
      {
        apiKey: "test-key",
        fetchFn: (async (input, init) => {
          requestUrl = String(input);
          authorization = String((init?.headers as Record<string, string>)?.authorization);
          requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return openAiResponse("Vessel departed Oban. ETA Castlebay 19:40.");
        }) as typeof fetch
      }
    );

    assert.deepEqual(summary, { body: "Vessel departed Oban. ETA Castlebay 19:40.", outcome: "generated" });
    assert.equal(requestUrl, "https://api.openai.com/v1/responses");
    assert.equal(authorization, "Bearer test-key");
    assert.equal(requestBody?.model, "gpt-5.4-nano-2026-03-17");
    const input = JSON.parse(String(requestBody?.input)) as Record<string, string>;
    assert.match(input.changedFacts ?? "", /The delay is resolved/);
    assert.doesNotMatch(input.changedFacts ?? "", /13:30 sailing is delayed/);
    assert.match(input.previousStatus ?? "", /13:30 sailing is delayed/);
    assert.match(input.currentStatus ?? "", /ETA Castlebay 19:40/);
  });

  it("sends full notice context and changed current paragraphs for an existing notice", async () => {
    let requestInput: Record<string, string> = {};
    const summary = await summariseInformationChange(
      notices([
        "MV Alfred will continue to operate the Troon - Brodick service until Sunday 18 October.",
        "**Sailings up to Thursday 10 September:** We have contacted all impacted bookings.",
        "**Sailings between Friday 11 September - Thursday 24 September:** Bookings are currently closed."
      ].join("\n\n")),
      notices([
        "MV Alfred will continue to operate the Troon - Brodick service until Sunday 18 October.",
        "**Sailings up to Wednesday 16 September:** We have contacted all impacted bookings.",
        "**Sailings between Thursday 17 September - Thursday 24 September:** Bookings are currently closed."
      ].join("\n\n")),
      {
        apiKey: "test-key",
        fetchFn: (async (_input, init) => {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          requestInput = JSON.parse(String(body.input)) as Record<string, string>;
          return openAiResponse("Bookings are open until 16 Sep and closed from 17-24 Sep.");
        }) as typeof fetch
      }
    );

    assert.deepEqual(summary, { body: "Bookings are open until 16 Sep and closed from 17-24 Sep.", outcome: "generated" });
    assert.match(requestInput.changedFacts ?? "", /Sailings up to Wednesday 16 September/);
    assert.match(requestInput.changedFacts ?? "", /Sailings between Thursday 17 September - Thursday 24 September/);
    assert.doesNotMatch(requestInput.changedFacts ?? "", /MV Alfred will continue/);
    assert.doesNotMatch(requestInput.changedFacts ?? "", /Thursday 10 September/);
    assert.match(requestInput.previousStatus ?? "", /Thursday 10 September/);
    assert.match(requestInput.currentStatus ?? "", /Wednesday 16 September/);
  });

  it("suppresses reordered paragraphs", async () => {
    const summary = await summariseInformationChange(
      notices("First paragraph.\n\nSecond paragraph."),
      notices("Second paragraph.\n\nFirst paragraph."),
      { apiKey: "test-key" }
    );

    assert.deepEqual(summary, { body: null, outcome: "suppressed" });
  });

  it("falls back without calling OpenAI for removed-only paragraphs", async () => {
    let called = false;
    const summary = await summariseInformationChange(
      notices("Passenger lounge is open.\n\nNo hot meals are available."),
      notices("Passenger lounge is open."),
      {
        apiKey: "test-key",
        fetchFn: (async () => {
          called = true;
          return openAiResponse("Should not be used.");
        }) as typeof fetch
      }
    );

    assert.equal(called, false);
    assert.deepEqual(summary, { body: "Sailing information has been updated.", outcome: "fallback" });
  });

  it("keeps unchanged trailing list context for a changed introductory fact", async () => {
    let changedFacts = "";
    const summary = await summariseInformationChange(
      notices("The following sailings will be cancelled:\n\n**Depart** Oban 14:00\n\n**Depart** Lismore 15:00\n\nService resumes at 17:15."),
      notices("The following sailings are **cancelled**:\n\n**Depart** Oban - 14:00\n\n**Depart** Lismore - 15:00\n\nService resumes at 17:15."),
      {
        apiKey: "test-key",
        fetchFn: (async (_input, init) => {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          changedFacts = String((JSON.parse(String(body.input)) as Record<string, string>).changedFacts);
          return openAiResponse("Oban 14:00 and Lismore 15:00 sailings are cancelled.");
        }) as typeof fetch
      }
    );

    assert.deepEqual(summary, { body: "Oban 14:00 and Lismore 15:00 sailings are cancelled.", outcome: "generated" });
    assert.match(changedFacts, /Depart Oban - 14:00/);
    assert.match(changedFacts, /Depart Lismore - 15:00/);
    assert.match(changedFacts, /Service resumes at 17:15/);
  });

  it("suppresses standalone link-only additions", async () => {
    const summary = await summariseInformationChange(
      notices("Passenger lounge is open."),
      notices("Passenger lounge is open.\n\n[View passenger rights information.][1]\n\n[1]: https://example.com"),
      { apiKey: "test-key" }
    );

    assert.deepEqual(summary, { body: null, outcome: "suppressed" });
  });

  it("sends the full text for a new notice", async () => {
    let changedFacts = "";
    const summary = await summariseInformationChange(
      JSON.stringify([]),
      notices("The passenger lounge is closed."),
      {
        apiKey: "test-key",
        fetchFn: (async (_input, init) => {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          changedFacts = String((JSON.parse(String(body.input)) as Record<string, string>).changedFacts);
          return openAiResponse("The passenger lounge is closed.");
        }) as typeof fetch
      }
    );

    assert.deepEqual(summary, { body: "The passenger lounge is closed.", outcome: "generated" });
    assert.match(changedFacts, /Current update\. The passenger lounge is closed\./);
  });

  it("falls back without calling OpenAI when extracted facts are too long", async () => {
    let called = false;
    const summary = await summariseInformationChange(
      notices("Previous information."),
      notices("x".repeat(1501)),
      {
        apiKey: "test-key",
        fetchFn: (async () => {
          called = true;
          return openAiResponse("Should not be used.");
        }) as typeof fetch
      }
    );

    assert.equal(called, false);
    assert.deepEqual(summary, { body: "Sailing information has been updated.", outcome: "fallback" });
  });

  it("falls back without retrying long output", async () => {
    let requestCount = 0;
    const summary = await summariseInformationChange(
      notices("Previous information."),
      notices("Changed passenger information."),
      {
        apiKey: "test-key",
        fetchFn: (async () => {
          requestCount += 1;
          return openAiResponse("x".repeat(121));
        }) as typeof fetch
      }
    );

    assert.equal(requestCount, 1);
    assert.deepEqual(summary, { body: "Sailing information has been updated.", outcome: "fallback" });
  });

  it("falls back when generated output is unsafe", async () => {
    const summary = await summariseInformationChange(
      notices("Previous information."),
      notices("Changed passenger information."),
      {
        apiKey: "test-key",
        fetchFn: (async () => openAiResponse("Changed passenger information. 👍")) as typeof fetch
      }
    );

    assert.deepEqual(summary, { body: "Sailing information has been updated.", outcome: "fallback" });
  });

  it("falls back when generated output drops a cancellation", async () => {
    const summary = await summariseInformationChange(
      notices("Previous information."),
      notices("The 14:00 sailing is cancelled."),
      {
        apiKey: "test-key",
        fetchFn: (async () => openAiResponse("The 14:00 sailing has been updated.")) as typeof fetch
      }
    );

    assert.deepEqual(summary, { body: "Sailing information has been updated.", outcome: "fallback" });
  });

  it("falls back when generated output reverses an explicit negation", async () => {
    const summary = await summariseInformationChange(
      notices("Previous information."),
      notices("The booking system has not yet been updated."),
      {
        apiKey: "test-key",
        fetchFn: (async () => openAiResponse("The booking system has been updated.")) as typeof fetch
      }
    );

    assert.deepEqual(summary, { body: "Sailing information has been updated.", outcome: "fallback" });
  });

  it("validates safety terms against changed facts rather than unchanged context", async () => {
    const summary = await summariseInformationChange(
      notices("Bookings are closed 6-24 Sep.\n\nThe timetable has not yet been updated."),
      notices("Bookings are closed 17-24 Sep.\n\nThe timetable has not yet been updated."),
      {
        apiKey: "test-key",
        fetchFn: (async () => openAiResponse("Bookings are closed 17-24 Sep.")) as typeof fetch
      }
    );

    assert.deepEqual(summary, { body: "Bookings are closed 17-24 Sep.", outcome: "generated" });
  });

  it("falls back without calling OpenAI for removed-only notices", async () => {
    let called = false;
    const summary = await summariseInformationChange(
      notices("Electronic message boards are out of order."),
      JSON.stringify([]),
      {
        apiKey: "test-key",
        fetchFn: (async () => {
          called = true;
          return openAiResponse("Should not be used.");
        }) as typeof fetch
      }
    );

    assert.equal(called, false);
    assert.deepEqual(summary, { body: "Sailing information has been updated.", outcome: "fallback" });
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

function notices(detail: string): string {
  return JSON.stringify([{ title: "Current update", detail, disruptionReason: null }]);
}

function openAiResponse(summary: string): Response {
  return Response.json({
    output: [{
      content: [{
        type: "output_text",
        text: JSON.stringify({ summary })
      }]
    }]
  });
}
