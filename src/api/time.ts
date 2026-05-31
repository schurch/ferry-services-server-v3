export function parseSqlTimestamp(timestamp: string): Date {
  return new Date(`${timestamp.replace(" ", "T")}Z`);
}

export function sqlTimestamp(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

export function timeWithSeconds(time: string): string {
  return /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
}

export function utcIsoResponse(datePart: string, timePart: string): string {
  return new Date(`${datePart}T${timePart}Z`).toISOString();
}

export function timestampResponse(timestamp: string): string {
  return parseSqlTimestamp(timestamp).toISOString();
}

export function optionalTimestampResponse(timestamp: string | null): string | undefined {
  return timestamp ? timestampResponse(timestamp) : undefined;
}

export function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseDateString(value: string | undefined, fallback = new Date()): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : dateString(fallback);
}
