import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDateTime, formatRelativeTime, formatTime, isDateInput, toApiDate, toDateInput } from "./date";

describe("date utils", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats API dates as YYYY-MM-DD", () => {
    expect(toApiDate(new Date("2026-03-05T01:02:03Z"))).toBe("2026-03-05");
  });

  it("toDateInput delegates to API date format", () => {
    expect(toDateInput(new Date(2026, 11, 31, 12, 0, 0))).toBe("2026-12-31");
  });

  it("detects valid date input strings", () => {
    expect(isDateInput("2026-03-06")).toBe(true);
    expect(isDateInput("2026-3-6")).toBe(false);
    expect(isDateInput(null)).toBe(false);
  });

  it("returns safe fallbacks for invalid or empty values", () => {
    expect(formatDateTime(null)).toBe("Unknown");
    expect(formatDateTime("not-a-date")).toBe("Unknown");
    expect(formatTime("not-a-date")).toBe("-");
    expect(formatRelativeTime(null)).toBe("unknown");
    expect(formatRelativeTime("not-a-date")).toBe("unknown");
  });

  it("formats relative time around now", () => {
    expect(formatRelativeTime("2026-03-05T12:01:00Z")).toContain("minute");
    expect(formatRelativeTime("2026-03-05T11:59:00Z")).toContain("minute");
  });
});
