export type TimetableDocumentCandidate = {
  title: string;
  url: string;
};

function dateOnly(value: unknown): string | null {
  return typeof value === "string" ? value.split("T")[0] ?? value : null;
}

function yearsIn(value: string): number[] {
  return [...value.matchAll(/\b20\d{2}\b/g)].map((match) => Number.parseInt(match[0], 10));
}

export function hasOnlyHistoricalYears(candidate: TimetableDocumentCandidate, now = new Date()): boolean {
  const years = yearsIn(`${candidate.title} ${candidate.url}`);
  if (years.length === 0) {
    return false;
  }

  // Seasonal timetables often span adjacent years (for example winter 2025/26),
  // so keep the current year plus the immediately preceding year.
  return Math.max(...years) < now.getUTCFullYear() - 1;
}

export function isExpiredValidityWindow(validUntil: unknown, now = new Date()): boolean {
  const endDate = dateOnly(validUntil);
  if (!endDate) {
    return false;
  }

  return endDate < now.toISOString().slice(0, 10);
}
