import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeTimetableDocumentTitle } from "../src/jobs/timetable-document-titles.js";

describe("timetable document title normalization", () => {
  it("uses the filename when the link text is only a call to action", () => {
    assert.equal(
      normalizeTimetableDocumentTitle(
        "Print this timetable",
        "https://example.com/files/western-ferries-summer-timetable-2026.pdf"
      ),
      "western ferries summer timetable 2026"
    );
  });

  it("uses a supplied page heading before falling back to the filename", () => {
    assert.equal(
      normalizeTimetableDocumentTitle(
        "Print this timetable",
        "https://example.com/files/A3summer2026.pdf",
        "Summer Timetable 27 Mar 2026 - 10 Jan 2027"
      ),
      "Summer Timetable 27 Mar 2026 - 10 Jan 2027"
    );
  });

  it("keeps meaningful titles", () => {
    assert.equal(
      normalizeTimetableDocumentTitle(
        "Summer timetable 2026",
        "https://example.com/files/western-ferries-summer-timetable-2026.pdf"
      ),
      "Summer timetable 2026"
    );
  });

  it("removes call-to-action framing from otherwise useful titles", () => {
    assert.equal(
      normalizeTimetableDocumentTitle(
        "Download a printable 2026 Timetables and Visitor Fares sheet",
        "https://example.com/files/2026-timetables-and-visitor-fares.pdf"
      ),
      "2026 Timetables and Visitor Fares"
    );
  });
});
