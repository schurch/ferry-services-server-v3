import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasOnlyHistoricalYears, isExpiredValidityWindow } from "./fetcher.js";

describe("timetable document freshness filters", () => {
  const now = new Date("2026-05-18T00:00:00.000Z");

  it("rejects documents whose only explicit years are older than the previous year", () => {
    assert.equal(
      hasOnlyHistoricalYears(
        {
          title: "Summer timetable 2023",
          url: "https://example.com/timetables/summer-timetable-2023.pdf"
        },
        now
      ),
      true
    );
  });

  it("keeps adjacent-year seasonal documents", () => {
    assert.equal(
      hasOnlyHistoricalYears(
        {
          title: "Winter timetable 2025/26",
          url: "https://example.com/timetables/winter-timetable-2025-26.pdf"
        },
        now
      ),
      false
    );
  });

  it("does not reject undated documents", () => {
    assert.equal(
      hasOnlyHistoricalYears(
        {
          title: "Summer timetable",
          url: "https://example.com/timetables/summer-timetable.pdf"
        },
        now
      ),
      false
    );
  });

  it("treats CalMac timetables as expired after their valid-until date", () => {
    assert.equal(isExpiredValidityWindow("2026-05-17T23:59:59.000Z", now), true);
    assert.equal(isExpiredValidityWindow("2026-05-18T00:00:00.000Z", now), false);
    assert.equal(isExpiredValidityWindow("2026-10-18T00:00:00.000Z", now), false);
  });
});
