import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "node-html-parser";
import { htmlText } from "./fetcher.js";

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
