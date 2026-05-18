function dateOnly(value: unknown): string | null {
  return typeof value === "string" ? value.split("T")[0] ?? value : null;
}

export function humanDate(value: unknown): string | null {
  const date = dateOnly(value);
  if (!date) {
    return null;
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(parsed);
}
