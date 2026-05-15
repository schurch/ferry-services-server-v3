import "dotenv/config";
import crypto from "node:crypto";
import { HTMLElement, NodeType, parse } from "node-html-parser";
import { openDatabase } from "../db/database.js";
import { saveTimetableDocuments } from "../db/timetable-documents.js";
import type { ScrapedTimetableDocument } from "../types/fetchers.js";

type TimetableDocumentSource = {
  organisationId: number;
  serviceIds: number[];
  pageUrl: string;
  titlePrefix?: string;
};

type DocumentLink = {
  title: string;
  url: string;
};

type DocumentMetadata = {
  contentHash?: string;
  contentType?: string;
  contentLength?: number;
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
  { organisationId: 3, serviceIds: [2000], pageUrl: "https://www.western-ferries.co.uk/pages/summer-timetable", titlePrefix: "Western Ferries" },
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

function dateOnly(value: unknown): string | null {
  return typeof value === "string" ? value.split("T")[0] ?? value : null;
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
    console.error(`Failed to fetch timetable document metadata: ${sourceLabel} - ${url} - ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

function isPdfDocument(metadata: DocumentMetadata): boolean {
  return metadata.contentType?.toLowerCase().includes("application/pdf") === true;
}

function htmlText(element: HTMLElement): string {
  return text(element.childNodes.flatMap((node) => {
    if (node.nodeType === NodeType.TEXT_NODE) {
      return [node.rawText];
    }
    if (node instanceof HTMLElement) {
      return [htmlText(node)];
    }
    return [];
  }).join(" "));
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

function absoluteUrl(pageUrl: string, href: string): string {
  return new URL(href, pageUrl).toString();
}

function canonicalDocumentUrl(url: string): string {
  return lower(url).includes("cdn.shopify.com") ? url.split("?")[0] ?? url : url;
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
      .replace(/\bpdf$/i, "")
  );
}

function isGenericTimetableTitle(value: string): boolean {
  return ["timetable", "imetable", "download timetable", "download"].includes(lower(text(value)));
}

function normalizeTitle(titlePrefix: string | undefined, title: string, url: string): string {
  const cleanedTitle = cleanupLinkTitle(title);
  const baseTitle = cleanedTitle.length < 3 || cleanedTitle.length > 160 || isGenericTimetableTitle(cleanedTitle)
    ? fileNameTitle(url)
    : cleanedTitle;

  return titlePrefix && !lower(baseTitle).includes(lower(titlePrefix))
    ? `${titlePrefix}: ${baseTitle}`
    : baseTitle;
}

function normalizeDocumentLink(source: TimetableDocumentSource, link: DocumentLink): DocumentLink {
  const url = absoluteUrl(source.pageUrl, link.url);
  return {
    title: normalizeTitle(source.titlePrefix, link.title, url),
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
    if (!isTimetableDocumentLink(link) || seen.has(link.url)) {
      return false;
    }
    seen.add(link.url);
    return true;
  });
}

function calMacTimetableTitle(timetable: CalMacTimetable): string {
  const routeName = typeof timetable.route?.name === "string" ? timetable.route.name : "CalMac timetable";
  const title = typeof timetable.title === "string" ? timetable.title : "Timetable";
  const validFrom = dateOnly(timetable.validFrom);
  const validUntil = dateOnly(timetable.validUntil);
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
  console.log("Fetching CalMac timetable documents from GraphQL");

  try {
    const timetables = await fetchCalMacTimetables();
    const documents: ScrapedTimetableDocument[] = [];
    for (const timetable of timetables) {
      const pdfUrl = typeof timetable.pdfUrl === "string" ? timetable.pdfUrl : null;
      const routeName = typeof timetable.route?.name === "string" ? timetable.route.name : "";
      const serviceIds = calMacServiceIds.get(normalizeCalMacRouteName(routeName)) ?? [];
      if (!pdfUrl || serviceIds.length === 0) {
        continue;
      }

      const metadata = await fetchDocumentMetadata("CalMac GraphQL", pdfUrl);
      if (!isPdfDocument(metadata)) {
        console.log(`Skipping non-PDF CalMac timetable document: ${pdfUrl}`);
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
    console.log(`Found ${documents.length} CalMac timetable documents from GraphQL`);
    return documents;
  } catch (error) {
    console.error(`Failed to fetch CalMac timetable documents from GraphQL - ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function scrapeSource(source: TimetableDocumentSource, lastSeenAt: string): Promise<ScrapedTimetableDocument[]> {
  const sourceLabel = source.titlePrefix ?? source.pageUrl;
  console.log(`Fetching timetable document source: ${sourceLabel}`);

  try {
    const page = await fetchText(source.pageUrl);
    const links = filterTimetableLinks(extractDocumentLinks(page).map((link) => normalizeDocumentLink(source, link)));
    console.log(`Found ${links.length} timetable document links for source: ${sourceLabel}`);

    const documents: ScrapedTimetableDocument[] = [];
    for (const link of links) {
      const metadata = await fetchDocumentMetadata(sourceLabel, link.url);
      if (!isPdfDocument(metadata)) {
        console.log(`Skipping non-PDF timetable document: ${sourceLabel} - ${link.url}`);
        continue;
      }

      documents.push({
        organisationId: source.organisationId,
        serviceIds: source.serviceIds,
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
    console.error(`Failed to fetch timetable document source: ${sourceLabel} - ${error instanceof Error ? error.message : String(error)}`);
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
  console.log(`Found ${unique.length} unique timetable documents`);
  return unique;
}

async function main(): Promise<void> {
  const db = openDatabase();
  try {
    const documents = await scrapeTimetableDocuments();
    console.log(`Saving ${documents.length} timetable documents`);
    saveTimetableDocuments(db, documents);
  } finally {
    db.close();
  }
}

await main();
