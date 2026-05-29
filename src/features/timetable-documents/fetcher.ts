import "dotenv/config";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { parse, type HTMLElement } from "node-html-parser";
import { openDatabase } from "../../shared/database.js";
import { saveTimetableDocuments } from "./repository.js";
import { logger } from "../../shared/logger.js";
import type { ScrapedTimetableDocument } from "../../shared/fetcher-types.js";

export {
  hasOnlyHistoricalYears,
  htmlText,
  humanDate,
  isExpiredValidityWindow,
  normalizeTimetableDocumentTitle,
  orkneyServiceIdsForDocument
};

export type TimetableDocumentCandidate = {
  title: string;
  url: string;
};

type TimetableDocumentSource = {
  organisationId: number;
  serviceIds: number[];
  pageUrl: string;
  titlePrefix?: string;
  usePageHeadingForGenericTitles?: boolean;
};

type DocumentLink = {
  title: string;
  url: string;
};

type DocumentMetadata = {
  contentHash?: string | undefined;
  contentType?: string | undefined;
  contentLength?: number | undefined;
};

type CalMacTimetable = {
  title?: unknown;
  route?: {
    name?: unknown;
  };
  pdfUrl?: unknown;
  validFrom?: unknown;
  validUntil?: unknown;
};

type CalMacTimetablesResponse = {
  data?: {
    timetables?: CalMacTimetable[];
  };
};

const requestTimeoutMs = 30_000;

const timetableDocumentSources: TimetableDocumentSource[] = [
  { organisationId: 2, serviceIds: [1000], pageUrl: "https://www.northlinkferries.co.uk/timetables/", titlePrefix: "NorthLink" },
  {
    organisationId: 3,
    serviceIds: [2000],
    pageUrl: "https://www.western-ferries.co.uk/pages/summer-timetable",
    titlePrefix: "Western Ferries",
    usePageHeadingForGenericTitles: true
  },
  { organisationId: 5, serviceIds: [4000, 4001, 4002, 4003, 4004, 4005, 4006, 4007, 4008], pageUrl: "https://www.orkneyferries.co.uk/timetables", titlePrefix: "Orkney Ferries" },
  { organisationId: 4, serviceIds: [3000, 3001, 3002, 3003, 3004], pageUrl: "https://www.shetland.gov.uk/ferries/timetable", titlePrefix: "Shetland Ferries" },
  { organisationId: 7, serviceIds: [6000], pageUrl: "https://www.highland.gov.uk/downloads/download/4/corran-ferry-timetable-and-fares", titlePrefix: "Corran Ferry" }
];

const calMacServiceIds = new Map<string, number[]>([
  ["ardrossan - brodick", [5]],
  ["troon - brodick", [41]],
  ["claonaig - lochranza", [6]],
  ["tarbert (loch fyne) - lochranza (seasonal winter)", [6]],
  ["colintraive - rhubodach", [4]],
  ["wemyss bay - rothesay", [3]],
  ["gourock - dunoon", [1]],
  ["tarbert (loch fyne) - portavadie", [2]],
  ["largs - cumbrae slip (millport)", [7]],
  ["gourock - kilcreggan", [39]],
  ["ardrossan - campbeltown", [36]],
  ["kennacraig - port askaig (islay) / port ellen (islay)", [9]],
  ["kennacraig - islay/c'say/oban", [9, 10]],
  ["tayinloan - gigha", [8]],
  ["oban - colonsay - port askaig - kennacraig", [10]],
  ["tobermory - kilchoan", [14]],
  ["fionnphort - iona", [13]],
  ["gallanach-kerrera", [38]],
  ["oban - coll/tiree", [16]],
  ["oban - craignure", [11]],
  ["lochaline - fishnish", [12]],
  ["oban - lismore", [15]],
  ["mallaig - eigg/muck/rum/canna", [19]],
  ["mallaig - armadale", [18]],
  ["sconser - raasay", [17]],
  ["ardmhor (barra) - eriskay", [21]],
  ["oban - castlebay", [20]],
  ["berneray - leverburgh", [23]],
  ["uig - lochmaddy", [22]],
  ["uig - tarbert", [24]],
  ["ullapool - stornoway", [25]],
  ["mallaig / oban - lochboisdale", [37]]
]);
function nowSql(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function dateOnly(value: unknown): string | null {
  return typeof value === "string" ? value.split("T")[0] ?? value : null;
}

function text(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function lower(value: string): string {
  return value.toLowerCase();
}

function replaceAll(value: string, oldValue: string, newValue: string): string {
  return value.split(oldValue).join(newValue);
}

function normalizeCalMacRouteName(value: string): string {
  return lower(text(replaceAll(replaceAll(value, "–", "-"), "\u00a0", " ")));
}

function fileNameTitle(url: string): string {
  const path = url.split("?")[0] ?? url;
  const fileName = path.split("/").filter(Boolean).at(-1) ?? path;
  return text(fileName.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, " "));
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
      .replace(/\s*pdf$/i, "")
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

function yearsIn(value: string): number[] {
  return [...value.matchAll(/\b20\d{2}\b/g)].map((match) => Number.parseInt(match[0], 10));
}

function normalizedServiceDocument(value: string): string {
  return lower(value).replace(/&/g, "and").replace(/\s+/g, " ").trim();
}

function humanDate(value: unknown): string | null {
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

function normalizeTimetableDocumentTitle(title: string, url: string, fallbackTitle?: string | null): string {
  const cleanedTitle = cleanupLinkTitle(title);
  if (cleanedTitle.length < 3 || cleanedTitle.length > 160 || isGenericTimetableTitle(cleanedTitle)) {
    return fallbackTitle ? text(fallbackTitle) : fileNameTitle(url);
  }

  return cleanedTitle;
}

function htmlText(element: HTMLElement): string {
  // textContent decodes HTML entities such as &amp;, unlike rawText/innerText.
  return text(element.textContent);
}

function hasOnlyHistoricalYears(candidate: TimetableDocumentCandidate, now = new Date()): boolean {
  const years = yearsIn(`${candidate.title} ${candidate.url}`);
  if (years.length === 0) {
    return false;
  }

  // Seasonal timetables often span adjacent years (for example winter 2025/26),
  // so keep the current year plus the immediately preceding year.
  return Math.max(...years) < now.getUTCFullYear() - 1;
}

function isExpiredValidityWindow(validUntil: unknown, now = new Date()): boolean {
  const endDate = dateOnly(validUntil);
  if (!endDate) {
    return false;
  }

  return endDate < now.toISOString().slice(0, 10);
}

function orkneyServiceIdsForDocument(document: TimetableDocumentCandidate): number[] {
  const value = normalizedServiceDocument(`${document.title} ${document.url}`);

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
async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
      "Accept-Encoding": "identity",
      Connection: "keep-alive"
    },
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.text();
}

async function fetchDocumentMetadata(sourceLabel: string, url: string): Promise<DocumentMetadata> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        Accept: "text/html,application/pdf,application/octet-stream,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
        "Accept-Encoding": "identity",
        Connection: "keep-alive"
      },
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }

    const body = Buffer.from(await response.arrayBuffer());
    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    return {
      contentHash: `sha256-${crypto.createHash("sha256").update(body).digest("hex")}`,
      contentType: response.headers.get("content-type") ?? undefined,
      contentLength: Number.isFinite(contentLength) ? contentLength : undefined
    };
  } catch (error) {
    logger.warn({ err: error, sourceLabel, url }, "Failed to fetch timetable document metadata");
    return {};
  }
}

function isPdfDocument(metadata: DocumentMetadata): boolean {
  return metadata.contentType?.toLowerCase().includes("application/pdf") === true;
}

function extractDocumentLinks(page: string): DocumentLink[] {
  const root = parse(page);
  return root.querySelectorAll("a").flatMap((anchor) => {
    const href = anchor.getAttribute("href");
    if (!href) {
      return [];
    }

    const title = htmlText(anchor) || href;
    return [{ title, url: href }];
  });
}

function pageHeading(page: string): string | null {
  const heading = parse(page).querySelector("h1");
  return heading ? htmlText(heading) : null;
}

function absoluteUrl(pageUrl: string, href: string): string {
  return new URL(href, pageUrl).toString();
}

function canonicalDocumentUrl(url: string): string {
  return lower(url).includes("cdn.shopify.com") ? url.split("?")[0] ?? url : url;
}

function normalizeDocumentLink(source: TimetableDocumentSource, link: DocumentLink, fallbackTitle?: string | null): DocumentLink {
  const url = absoluteUrl(source.pageUrl, link.url);
  return {
    title: normalizeTimetableDocumentTitle(link.title, url, fallbackTitle),
    url
  };
}

function isTimetableDocumentLink(link: DocumentLink): boolean {
  const combined = lower(`${link.url} ${link.title}`);
  const isDocumentUrl = combined.includes(".pdf") || combined.includes("download") || combined.includes("/documents/");
  const looksLikeTimetable = ["timetable", "summer", "winter", "amended", "stt-", "wtt-"].some((value) => combined.includes(value));
  const fareOnly = combined.includes("fare") && !combined.includes("timetable");
  const officeDocument = [".doc", ".docx", " doc ", " docx "].some((value) => combined.includes(value));
  const islanderFares = combined.includes("islander fares") || combined.includes("fares-for-islanders");
  return isDocumentUrl && looksLikeTimetable && !fareOnly && !officeDocument && !islanderFares;
}

function filterTimetableLinks(links: DocumentLink[]): DocumentLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (!isTimetableDocumentLink(link) || hasOnlyHistoricalYears(link) || seen.has(link.url)) {
      return false;
    }
    seen.add(link.url);
    return true;
  });
}
function calMacTimetableTitle(timetable: CalMacTimetable): string {
  const routeName = typeof timetable.route?.name === "string" ? timetable.route.name : "CalMac timetable";
  const title = typeof timetable.title === "string" ? timetable.title : "Timetable";
  const validFrom = humanDate(timetable.validFrom);
  const validUntil = humanDate(timetable.validUntil);
  const validRange = validFrom && validUntil ? ` (${validFrom} to ${validUntil})` : "";
  return `${routeName}: ${title}${validRange}`;
}

async function fetchCalMacTimetables(): Promise<CalMacTimetable[]> {
  const query = `{
    timetables {
      timetableType
      title
      route { name }
      releaseDetail
      pdfUrl
      validFrom
      validUntil
      lastUpdated
    }
  }`;
  const response = await fetch("https://apim.calmac.co.uk/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-GB,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      Origin: "capacitor://localhost",
      Connection: "keep-alive"
    },
    body: JSON.stringify({ variables: {}, query }),
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  if (!response.ok) {
    throw new Error(`CalMac GraphQL returned HTTP ${response.status}`);
  }

  const body = await response.json() as CalMacTimetablesResponse;
  return body.data?.timetables ?? [];
}

async function scrapeCalMacTimetableDocuments(lastSeenAt: string): Promise<ScrapedTimetableDocument[]> {
  logger.info("Fetching CalMac timetable documents from GraphQL");

  try {
    const timetables = await fetchCalMacTimetables();
    const documents: ScrapedTimetableDocument[] = [];
    for (const timetable of timetables) {
      const pdfUrl = typeof timetable.pdfUrl === "string" ? timetable.pdfUrl : null;
      const routeName = typeof timetable.route?.name === "string" ? timetable.route.name : "";
      const serviceIds = calMacServiceIds.get(normalizeCalMacRouteName(routeName)) ?? [];
      if (!pdfUrl || serviceIds.length === 0 || isExpiredValidityWindow(timetable.validUntil)) {
        continue;
      }

      const metadata = await fetchDocumentMetadata("CalMac GraphQL", pdfUrl);
      if (!isPdfDocument(metadata)) {
        logger.info({ url: pdfUrl }, "Skipping non-PDF CalMac timetable document");
        continue;
      }

      documents.push({
        organisationId: 1,
        serviceIds,
        title: calMacTimetableTitle(timetable),
        sourceUrl: canonicalDocumentUrl(pdfUrl),
        contentHash: metadata.contentHash,
        contentType: metadata.contentType,
        contentLength: metadata.contentLength,
        lastSeenAt
      });
    }
    logger.info({ documentCount: documents.length }, "Found CalMac timetable documents from GraphQL");
    return documents;
  } catch (error) {
    logger.error({ err: error }, "Failed to fetch CalMac timetable documents from GraphQL");
    return [];
  }
}

async function scrapeSource(source: TimetableDocumentSource, lastSeenAt: string): Promise<ScrapedTimetableDocument[]> {
  const sourceLabel = source.titlePrefix ?? source.pageUrl;
  logger.info({ sourceLabel }, "Fetching timetable document source");

  try {
    const page = await fetchText(source.pageUrl);
    const fallbackTitle = source.usePageHeadingForGenericTitles ? pageHeading(page) : null;
    const links = filterTimetableLinks(
      extractDocumentLinks(page).map((link) => normalizeDocumentLink(source, link, fallbackTitle))
    );
    logger.info({ sourceLabel, linkCount: links.length }, "Found timetable document links");

    const documents: ScrapedTimetableDocument[] = [];
    for (const link of links) {
      const metadata = await fetchDocumentMetadata(sourceLabel, link.url);
      if (!isPdfDocument(metadata)) {
        logger.info({ sourceLabel, url: link.url }, "Skipping non-PDF timetable document");
        continue;
      }

      const serviceIds = source.organisationId === 5
        ? orkneyServiceIdsForDocument(link)
        : source.serviceIds;
      if (serviceIds.length === 0) {
        logger.info({ sourceLabel, url: link.url, title: link.title }, "Skipping timetable document without mapped services");
        continue;
      }

      documents.push({
        organisationId: source.organisationId,
        serviceIds,
        title: link.title,
        sourceUrl: canonicalDocumentUrl(link.url),
        contentHash: metadata.contentHash,
        contentType: metadata.contentType,
        contentLength: metadata.contentLength,
        lastSeenAt
      });
    }
    return documents;
  } catch (error) {
    logger.error({ err: error, sourceLabel }, "Failed to fetch timetable document source");
    return [];
  }
}

async function scrapeTimetableDocuments(): Promise<ScrapedTimetableDocument[]> {
  const lastSeenAt = nowSql();
  const documents = [
    ...await scrapeCalMacTimetableDocuments(lastSeenAt),
    ...(await Promise.all(timetableDocumentSources.map((source) => scrapeSource(source, lastSeenAt)))).flat()
  ];
  const seen = new Set<string>();
  const unique = documents.filter((document) => {
    if (seen.has(document.sourceUrl)) {
      return false;
    }
    seen.add(document.sourceUrl);
    return true;
  });
  logger.info({ documentCount: unique.length }, "Found unique timetable documents");
  return unique;
}
async function main(): Promise<void> {
  const db = openDatabase();
  try {
    const documents = await scrapeTimetableDocuments();
    logger.info({ documentCount: documents.length }, "Saving timetable documents");
    saveTimetableDocuments(db, documents);
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
