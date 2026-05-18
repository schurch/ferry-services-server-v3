import type { TimetableDocumentCandidate } from "./timetable-document-filters.js";

function normalized(value: string): string {
  return value.toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ").trim();
}

export function orkneyServiceIdsForDocument(document: TimetableDocumentCandidate): number[] {
  const value = normalized(`${document.title} ${document.url}`);

  if (value.includes("north ronaldsay") || value.includes("nordic sea")) {
    return [];
  }
  if (value.includes("eday") && value.includes("sanday") && value.includes("stronsay")) {
    return [4000, 4001, 4002];
  }
  if (value.includes("westray") && value.includes("papa westray")) {
    return [4003, 4008];
  }
  if (value.includes("south isles") || (value.includes("hoy") && value.includes("flotta"))) {
    return [4006];
  }
  if (value.includes("rousay") && value.includes("egilsay") && value.includes("wyre")) {
    return [4007];
  }
  if (value.includes("shapinsay")) {
    return [4004];
  }
  if (value.includes("graemsay") && value.includes("hoy")) {
    return [4005];
  }
  return [];
}
