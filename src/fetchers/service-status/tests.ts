import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  finishServiceScrapeRun,
  saveServiceReliabilityDays,
  saveServiceStatusObservations,
  startServiceScrapeRun
} from "./db.js";
import { createTestDatabase } from "../../test-helper.js";
import type { ScrapedService } from "./types.js";

describe("service status observations", () => {
  it("records scrape runs, observations and structured notices", () => {
    const { db, cleanup } = createTestDatabase();
    try {
      const scrapeRunId = startServiceScrapeRun(db, {
        operatorName: "CalMac",
        organisationId: 1,
        sourceName: "CalMac GraphQL routes",
        startedAt: "2026-05-20 12:00:00"
      });
      const service: ScrapedService = {
        serviceId: 5,
        area: "Arran",
        route: "Ardrossan - Brodick",
        status: 1,
        sourceStatus: "BE_AWARE",
        sourceServiceId: "route-123",
        sourceServiceCode: "003",
        sourceAreaId: "location-123",
        sourceAreaName: "Arran",
        sourceAreaLatitude: 55.5806165,
        sourceAreaLongitude: -5.2108573,
        disruptionReason: "Technical",
        additionalInfo: "<h2>Wednesday 20 May</h2><p>Amended timetable.</p>",
        organisationId: 1,
        updated: "2026-05-20 12:00:00",
        notices: [
          {
            sourceNoticeKey: "003:0:SAILING:Wednesday 20 May",
            sourceNoticeType: "SAILING",
            title: "Wednesday 20 May",
            disruptionReason: "Technical",
            detailMarkdown: "Due to a technical issue, an amended timetable will operate."
          },
          {
            sourceNoticeKey: "003:1:INFORMATION:Subscriber texts",
            sourceNoticeType: "INFORMATION",
            title: "Subscriber texts",
            detailMarkdown: "Generic subscriber text information."
          }
        ]
      };

      saveServiceStatusObservations(db, scrapeRunId, [service], "2026-05-20 12:01:00");
      finishServiceScrapeRun(db, scrapeRunId, { success: true, completedAt: "2026-05-20 12:02:00" });

      const run = db.prepare(`
        SELECT operator_name, organisation_id, source_name, started_at, completed_at, success, error
        FROM service_scrape_runs
        WHERE scrape_run_id = ?
      `).get(scrapeRunId) as Record<string, unknown>;
      assert.deepEqual(run, {
        operator_name: "CalMac",
        organisation_id: 1,
        source_name: "CalMac GraphQL routes",
        started_at: "2026-05-20 12:00:00",
        completed_at: "2026-05-20 12:02:00",
        success: 1,
        error: null
      });

      const observation = db.prepare(`
        SELECT service_id, observed_at, source_service_id, source_service_code, source_area_id, source_area_name,
          source_area_latitude, source_area_longitude, status, source_status, disruption_reason,
          last_updated_date
        FROM service_status_observations
        WHERE scrape_run_id = ?
      `).get(scrapeRunId) as Record<string, unknown>;
      assert.equal(observation.service_id, 5);
      assert.equal(observation.observed_at, "2026-05-20 12:01:00");
      assert.equal(observation.source_service_id, "route-123");
      assert.equal(observation.source_service_code, "003");
      assert.equal(observation.source_area_id, "location-123");
      assert.equal(observation.source_area_name, "Arran");
      assert.equal(observation.source_area_latitude, 55.5806165);
      assert.equal(observation.source_area_longitude, -5.2108573);
      assert.equal(observation.status, 1);
      assert.equal(observation.source_status, "BE_AWARE");
      assert.equal(observation.disruption_reason, "Technical");
      assert.equal(observation.last_updated_date, null);

      const notices = db.prepare(`
        SELECT n.source_notice_key, n.source_notice_type, n.title, n.disruption_reason,
          n.detail_text, n.detail_markdown, p.detail_markdown AS payload_detail_markdown,
          n.display_order
        FROM service_status_observation_notices n
        LEFT JOIN service_status_notice_payloads p ON p.payload_id = n.payload_id
        ORDER BY n.display_order
      `).all() as Array<Record<string, unknown>>;
      assert.deepEqual(notices, [
        {
          source_notice_key: "003:0:SAILING:Wednesday 20 May",
          source_notice_type: "SAILING",
          title: "Wednesday 20 May",
          disruption_reason: "Technical",
          detail_text: null,
          detail_markdown: null,
          payload_detail_markdown: "Due to a technical issue, an amended timetable will operate.",
          display_order: 0
        },
        {
          source_notice_key: "003:1:INFORMATION:Subscriber texts",
          source_notice_type: "INFORMATION",
          title: "Subscriber texts",
          disruption_reason: null,
          detail_text: null,
          detail_markdown: null,
          payload_detail_markdown: "Generic subscriber text information.",
          display_order: 1
        }
      ]);

      saveServiceStatusObservations(db, scrapeRunId, [service], "2026-05-20 12:02:00");
      const payloadCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM service_status_notice_payloads
      `).get() as { count: number };
      assert.equal(payloadCount.count, 2);
    } finally {
      cleanup();
    }
  });

  it("records failed scrape runs without observations", () => {
    const { db, cleanup } = createTestDatabase();
    try {
      const scrapeRunId = startServiceScrapeRun(db, {
        operatorName: "Western Ferries",
        organisationId: 3,
        sourceName: "Western Ferries status",
        startedAt: "2026-05-20 13:00:00"
      });

      finishServiceScrapeRun(db, scrapeRunId, {
        success: false,
        error: "HTTP 500",
        completedAt: "2026-05-20 13:00:10"
      });

      const run = db.prepare(`
        SELECT success, error, completed_at
        FROM service_scrape_runs
        WHERE scrape_run_id = ?
      `).get(scrapeRunId) as Record<string, unknown>;
      assert.deepEqual(run, {
        success: 0,
        error: "HTTP 500",
        completed_at: "2026-05-20 13:00:10"
      });

      const count = db.prepare(`
        SELECT COUNT(*) AS count
        FROM service_status_observations
        WHERE scrape_run_id = ?
      `).get(scrapeRunId) as { count: number };
      assert.equal(count.count, 0);
    } finally {
      cleanup();
    }
  });

  it("captures one reliability summary per service day", () => {
    const { db, cleanup } = createTestDatabase();
    try {
      saveServiceReliabilityDays(db, [
        { serviceId: 5, status: 0, scheduledSailings: 4 },
        { serviceId: 6, status: -99, scheduledSailings: 2 }
      ], "2026-05-20 08:00:00");
      saveServiceReliabilityDays(db, [
        { serviceId: 5, status: 2, scheduledSailings: 3 }
      ], "2026-05-20 17:00:00");

      const rows = db.prepare(`
        SELECT service_id, observed_date, status, scheduled_sailings, first_observed_at, last_observed_at
        FROM service_reliability_days
        ORDER BY service_id
      `).all() as Array<Record<string, unknown>>;

      assert.deepEqual(rows, [
        {
          service_id: 5,
          observed_date: "2026-05-20",
          status: 2,
          scheduled_sailings: 4,
          first_observed_at: "2026-05-20 08:00:00",
          last_observed_at: "2026-05-20 17:00:00"
        }
      ]);
    } finally {
      cleanup();
    }
  });
});
