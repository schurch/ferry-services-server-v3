import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { humanDate } from "../src/jobs/timetable-document-dates.js";

describe("timetable document date formatting", () => {
  it("formats ISO dates for people", () => {
    assert.equal(humanDate("2026-03-27T00:00:00.000Z"), "27 Mar 2026");
    assert.equal(humanDate("2027-01-10"), "10 Jan 2027");
  });

  it("returns null for missing or invalid dates", () => {
    assert.equal(humanDate(null), null);
    assert.equal(humanDate("not-a-date"), null);
  });
});
