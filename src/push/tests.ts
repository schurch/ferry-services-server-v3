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
      { ollamaUrl: null }
    );

    assert.deepEqual(summary, { body: null, outcome: "suppressed" });
  });

  it("rewrites current changed facts with Ollama", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const summary = await summariseInformationChange(
      notices("The 13:30 sailing is delayed."),
      notices("The delay is resolved. The vessel departed Oban. ETA Castlebay 19:40."),
      {
        ollamaUrl: "http://ollama:11434/",
        fetchFn: (async (_input, init) => {
          requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return Response.json({ response: "Vessel departed Oban. ETA Castlebay 19:40." });
        }) as typeof fetch
      }
    );

    assert.deepEqual(summary, { body: "Vessel departed Oban. ETA Castlebay 19:40.", outcome: "generated" });
    assert.equal(requestBody?.model, "qwen3:1.7b");
    assert.equal(requestBody?.keep_alive, "5m");
    assert.equal(requestBody?.think, false);
    assert.match(String(requestBody?.prompt), /The delay is resolved/);
    assert.doesNotMatch(String(requestBody?.prompt), /13:30 sailing is delayed/);
  });

  it("sends only changed current paragraphs for an existing notice", async () => {
    let prompt = "";
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
        ollamaUrl: "http://ollama:11434",
        fetchFn: (async (_input, init) => {
          prompt = String(JSON.parse(String(init?.body)).prompt);
          return Response.json({ response: "Bookings are open until 16 Sep and closed from 17-24 Sep." });
        }) as typeof fetch
      }
    );

    assert.deepEqual(summary, { body: "Bookings are open until 16 Sep and closed from 17-24 Sep.", outcome: "generated" });
    assert.match(prompt, /Sailings up to Wednesday 16 September/);
    assert.match(prompt, /Sailings between Thursday 17 September - Thursday 24 September/);
    assert.doesNotMatch(prompt, /MV Alfred will continue/);
    assert.doesNotMatch(prompt, /Thursday 10 September/);
    assert.doesNotMatch(prompt, /Friday 11 September/);
  });

  it("suppresses reordered paragraphs", async () => {
    const summary = await summariseInformationChange(
      notices("First paragraph.\n\nSecond paragraph."),
      notices("Second paragraph.\n\nFirst paragraph."),
      { ollamaUrl: "http://ollama:11434" }
    );

    assert.deepEqual(summary, { body: null, outcome: "suppressed" });
  });

  it("falls back without calling Ollama for removed-only paragraphs", async () => {
    let called = false;
    const summary = await summariseInformationChange(
      notices("Passenger lounge is open.\n\nNo hot meals are available."),
      notices("Passenger lounge is open."),
      {
        ollamaUrl: "http://ollama:11434",
        fetchFn: (async () => {
          called = true;
          return Response.json({ response: "Should not be used." });
        }) as typeof fetch
      }
    );

    assert.equal(called, false);
    assert.deepEqual(summary, { body: "Sailing information has been updated.", outcome: "fallback" });
  });

  it("keeps unchanged trailing list context for a changed introductory fact", async () => {
    let prompt = "";
    const summary = await summariseInformationChange(
      notices("The following sailings will be cancelled:\n\n**Depart** Oban 14:00\n\n**Depart** Lismore 15:00\n\nService resumes at 17:15."),
      notices("The following sailings are **cancelled**:\n\n**Depart** Oban - 14:00\n\n**Depart** Lismore - 15:00\n\nService resumes at 17:15."),
      {
        ollamaUrl: "http://ollama:11434",
        fetchFn: (async (_input, init) => {
          prompt = String(JSON.parse(String(init?.body)).prompt);
          return Response.json({ response: "Oban 14:00 and Lismore 15:00 sailings are cancelled." });
        }) as typeof fetch
      }
    );

    assert.deepEqual(summary, { body: "Oban 14:00 and Lismore 15:00 sailings are cancelled.", outcome: "generated" });
    assert.match(prompt, /Depart Oban - 14:00/);
    assert.match(prompt, /Depart Lismore - 15:00/);
    assert.match(prompt, /Service resumes at 17:15/);
  });

  it("suppresses standalone link-only additions", async () => {
    const summary = await summariseInformationChange(
      notices("Passenger lounge is open."),
      notices("Passenger lounge is open.\n\n[View passenger rights information.][1]\n\n[1]: https://example.com"),
      { ollamaUrl: "http://ollama:11434" }
    );

    assert.deepEqual(summary, { body: null, outcome: "suppressed" });
  });

  it("sends the full text for a new notice", async () => {
    let prompt = "";
    const summary = await summariseInformationChange(
      JSON.stringify([]),
      notices("The passenger lounge is closed."),
      {
        ollamaUrl: "http://ollama:11434",
        fetchFn: (async (_input, init) => {
          prompt = String(JSON.parse(String(init?.body)).prompt);
          return Response.json({ response: "The passenger lounge is closed." });
        }) as typeof fetch
      }
    );

    assert.deepEqual(summary, { body: "The passenger lounge is closed.", outcome: "generated" });
    assert.match(prompt, /Current update\. The passenger lounge is closed\./);
  });

  it("falls back without calling Ollama when extracted facts are too long", async () => {
    let called = false;
    const summary = await summariseInformationChange(
      notices("Previous information."),
      notices("x".repeat(1501)),
      {
        ollamaUrl: "http://ollama:11434",
        fetchFn: (async () => {
          called = true;
          return Response.json({ response: "Should not be used." });
        }) as typeof fetch
      }
    );

    assert.equal(called, false);
    assert.deepEqual(summary, { body: "Sailing information has been updated.", outcome: "fallback" });
  });

  it("retries long output once with a shortening prompt", async () => {
    let requestCount = 0;
    const summary = await summariseInformationChange(
      notices("Previous information."),
      notices("Changed passenger information."),
      {
        ollamaUrl: "http://ollama:11434",
        fetchFn: (async () => {
          requestCount += 1;
          return Response.json({
            response: requestCount === 1 ? "x".repeat(121) : "Changed passenger information."
          });
        }) as typeof fetch
      }
    );

    assert.equal(requestCount, 2);
    assert.deepEqual(summary, { body: "Changed passenger information.", outcome: "generated" });
  });

  it("falls back when generated output is unsafe", async () => {
    const summary = await summariseInformationChange(
      notices("Previous information."),
      notices("Changed passenger information."),
      {
        ollamaUrl: "http://ollama:11434",
        fetchFn: (async () => Response.json({ response: "Changed passenger information. 👍" })) as typeof fetch
      }
    );

    assert.deepEqual(summary, { body: "Sailing information has been updated.", outcome: "fallback" });
  });

  it("falls back when generated output drops a cancellation", async () => {
    const summary = await summariseInformationChange(
      notices("Previous information."),
      notices("The 14:00 sailing is cancelled."),
      {
        ollamaUrl: "http://ollama:11434",
        fetchFn: (async () => Response.json({ response: "The 14:00 sailing has been updated." })) as typeof fetch
      }
    );

    assert.deepEqual(summary, { body: "Sailing information has been updated.", outcome: "fallback" });
  });

  it("falls back when generated output reverses an explicit negation", async () => {
    const summary = await summariseInformationChange(
      notices("Previous information."),
      notices("The booking system has not yet been updated."),
      {
        ollamaUrl: "http://ollama:11434",
        fetchFn: (async () => Response.json({ response: "The booking system has been updated." })) as typeof fetch
      }
    );

    assert.deepEqual(summary, { body: "Sailing information has been updated.", outcome: "fallback" });
  });

  it("falls back without calling Ollama for removed-only notices", async () => {
    let called = false;
    const summary = await summariseInformationChange(
      notices("Electronic message boards are out of order."),
      JSON.stringify([]),
      {
        ollamaUrl: "http://ollama:11434",
        fetchFn: (async () => {
          called = true;
          return Response.json({ response: "Should not be used." });
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
