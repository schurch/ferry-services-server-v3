function text(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function lower(value: string): string {
  return value.toLowerCase();
}

function fileNameTitle(url: string): string {
  const path = url.split("?")[0] ?? url;
  const fileName = path.split("/").filter(Boolean).at(-1) ?? path;
  return text(fileName.replace(/[^a-z0-9]+/gi, " "));
}

function stripPdfSizeText(value: string): string {
  return value.replace(/\([^)]*pdf,[^)]*\)/gi, "");
}

function cleanupLinkTitle(value: string): string {
  return text(
    stripPdfSizeText(value)
      .replace(/opens? in new window/gi, "")
      .replace(/^download a printable\s+/i, "")
      .replace(/\s+sheet$/i, "")
      .replace(/\bpdf$/i, "")
  );
}

function isGenericTimetableTitle(value: string): boolean {
  return [
    "timetable",
    "imetable",
    "download timetable",
    "download",
    "print this timetable"
  ].includes(lower(text(value)));
}

export function normalizeTimetableDocumentTitle(title: string, url: string, fallbackTitle?: string | null): string {
  const cleanedTitle = cleanupLinkTitle(title);
  if (cleanedTitle.length < 3 || cleanedTitle.length > 160 || isGenericTimetableTitle(cleanedTitle)) {
    return fallbackTitle ? text(fallbackTitle) : fileNameTitle(url);
  }

  return cleanedTitle;
}
