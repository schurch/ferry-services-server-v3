export function parseNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseInteger(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function capitaliseWords(value: string): string {
  return value.split(/\s+/).filter(Boolean).map((word) => {
    const upper = word.toUpperCase();
    if (upper === "OF" || upper === "THE") {
      return upper.toLowerCase();
    }
    return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
  }).join(" ");
}

export function cleanVesselText(value: string): string | undefined {
  const cleaned = value.replace(/@/g, " ").trim().replace(/\s+/g, " ");
  return cleaned === "" ? undefined : cleaned;
}
