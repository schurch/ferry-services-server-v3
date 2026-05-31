import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "node-html-parser";
import {
  hasOnlyHistoricalYears,
  htmlText,
  humanDate,
  isExpiredValidityWindow,
  normalizeTimetableDocumentTitle,
  orkneyServiceIdsForDocument
} from "./fetcher.js";

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

describe("timetable document HTML text extraction", () => {
  it("decodes HTML entities in link text", () => {
    const anchor = parse("<a>North &amp; South timetable</a>").querySelector("a");
    assert.ok(anchor);
    assert.equal(htmlText(anchor), "North & South timetable");
  });

  it("normalizes nested whitespace while preserving decoded text", () => {
    const anchor = parse("<a>North <span>&amp;</span> South&nbsp; timetable</a>").querySelector("a");
    assert.ok(anchor);
    assert.equal(htmlText(anchor), "North & South timetable");
  });
});

describe("Orkney timetable document service mapping", () => {
  it("maps north-isles timetable groups only to the matching app services", () => {
    assert.deepEqual(
      orkneyServiceIdsForDocument({
        title: "Eday, Sanday, & Stronsay",
        url: "https://example.com/documents/summer-2026-eday-sanday-stronsay"
      }),
      [4000, 4001, 4002]
    );
    assert.deepEqual(
      orkneyServiceIdsForDocument({
        title: "Westray & Papa Westray (from Kirkwall)",
        url: "https://example.com/documents/summer-2026-westray-papa-westray"
      }),
      [4003, 4008]
    );
  });

  it("maps south and inner-isles documents to their own service only", () => {
    assert.deepEqual(
      orkneyServiceIdsForDocument({
        title: "South Isles (Hoy and Flotta)",
        url: "https://example.com/documents/summer-2026-south-isles"
      }),
      [4006]
    );
    assert.deepEqual(
      orkneyServiceIdsForDocument({
        title: "Rousay Egilsay & Wyre",
        url: "https://example.com/documents/summer-2026-rousay-egilsay-wyre"
      }),
      [4007]
    );
    assert.deepEqual(
      orkneyServiceIdsForDocument({
        title: "Shapinsay",
        url: "https://example.com/documents/summer-2026-shapinsay"
      }),
      [4004]
    );
    assert.deepEqual(
      orkneyServiceIdsForDocument({
        title: "Graemsay and Hoy (Moaness)",
        url: "https://example.com/documents/summer-2026-graemsay-hoy-moaness"
      }),
      [4005]
    );
  });

  it("ignores Orkney PDFs that do not map to an app service", () => {
    assert.deepEqual(
      orkneyServiceIdsForDocument({
        title: "North Ronaldsay",
        url: "https://example.com/documents/summer-2026-north-ronaldsay"
      }),
      []
    );
    assert.deepEqual(
      orkneyServiceIdsForDocument({
        title: "Nordic Sea Foot Passenger Service to Eday, Sanday, Stronsay and North Ronaldsay",
        url: "https://example.com/documents/summer-2026-nordic-sea"
      }),
      []
    );
  });
});

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

  it("removes a trailing PDF label even when markup collapses the whitespace", () => {
    assert.equal(
      normalizeTimetableDocumentTitle(
        "ShapinsayPdf",
        "https://example.com/files/shapinsay.pdf"
      ),
      "Shapinsay"
    );
  });
});
