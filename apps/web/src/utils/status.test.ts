import { describe, expect, it } from "vitest";
import { disruptionText, statusLabel } from "./status";

describe("status utils", () => {
  it("returns labels for known statuses", () => {
    expect(statusLabel("normal")).toBe("Normal operations");
    expect(statusLabel("disrupted")).toBe("Sailings disrupted");
    expect(statusLabel("cancelled")).toBe("Sailings cancelled");
  });

  it("returns fallback label for unknown status", () => {
    expect(statusLabel("unknown")).toBe("Unknown status");
  });

  it("returns disruption messages for each status", () => {
    expect(disruptionText("normal")).toContain("no disruptions");
    expect(disruptionText("disrupted")).toContain("disruptions");
    expect(disruptionText("cancelled")).toContain("cancelled");
    expect(disruptionText("unknown")).toContain("problem fetching");
  });
});
