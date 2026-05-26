import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { orkneyServiceIdsForDocument } from "../src/jobs/timetable-document-fetcher.js";

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
