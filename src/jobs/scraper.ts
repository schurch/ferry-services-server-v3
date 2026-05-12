import "dotenv/config";
import { HTMLElement, NodeType, parse } from "node-html-parser";
import { marked } from "marked";
import { hideServices, listServiceIdsForOrganisation, saveServices } from "../db/fetchers.js";
import { openDatabase } from "../db/database.js";
import type { ScrapedService } from "../types/fetchers.js";
import type { ServiceStatus } from "../types/api.js";

type OperatorScraper = {
  name: string;
  scrape: () => Promise<ScrapedService[]>;
  afterSave?: (services: ScrapedService[]) => void;
};

type CalMacRouteStatus = {
  title: string;
  status: "SAILING" | "SERVICE" | "INFORMATION" | string;
  detail: string;
};

type CalMacRoute = {
  name: string;
  status: "NORMAL" | "BE_AWARE" | "DISRUPTIONS" | "ALL_SAILINGS_CANCELLED" | string;
  routeCode: string;
  location: {
    name: string;
  };
  routeStatuses: CalMacRouteStatus[];
};

type CalMacResponse = {
  data?: {
    routes?: CalMacRoute[];
  };
};

const SERVICE_STATUS = {
  normal: 0,
  disrupted: 1,
  cancelled: 2,
  unknown: -99
} satisfies Record<string, ServiceStatus>;

const calMacServiceIds = new Map<string, number>([
  ["001", 1],
  ["007", 2],
  ["002", 3],
  ["006", 4],
  ["003", 5],
  ["004", 6],
  ["005", 7],
  ["060", 8],
  ["030", 9],
  ["053", 10],
  ["031", 11],
  ["036", 12],
  ["056", 13],
  ["054", 14],
  ["055", 15],
  ["052", 16],
  ["061", 17],
  ["033", 18],
  ["051", 19],
  ["032", 20],
  ["080", 21],
  ["022", 22],
  ["065", 23],
  ["034", 24],
  ["035", 25],
  ["300", 35],
  ["038", 37],
  ["043", 38],
  ["011", 39],
  ["301", 41]
]);

function nowSql(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function text(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function htmlOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
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
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.text();
}

function htmlToTextParts(element: HTMLElement): string[] {
  return element.childNodes.flatMap((node) => {
    if (node.nodeType === NodeType.TEXT_NODE) {
      return [text(node.rawText)];
    }
    if (node instanceof HTMLElement) {
      return htmlToTextParts(node);
    }
    return [];
  }).filter(Boolean);
}

function service(input: Omit<ScrapedService, "updated">): ScrapedService {
  return {
    ...input,
    updated: nowSql()
  };
}

async function scrapeCorran(): Promise<ScrapedService[]> {
  return [
    service({
      serviceId: 6000,
      area: "Corran",
      route: "Nether Lochaber - Ardgour",
      status: SERVICE_STATUS.unknown,
      organisationId: 7
    })
  ];
}

async function scrapePentland(): Promise<ScrapedService[]> {
  const root = parse(await fetchText("https://pentlandferries.co.uk/"));
  const lines = root.querySelector(".vc_acf.announce")
    ? htmlToTextParts(root.querySelector(".vc_acf.announce") as HTMLElement)
    : [];
  const announcement = lines.join(" ").toLowerCase();
  const status = announcement.includes("cancelled")
    ? SERVICE_STATUS.cancelled
    : ["disruption", "delayed", "delay", "amended", "adverse weather", "weather conditions"].some((word) => announcement.includes(word))
      ? SERVICE_STATUS.disrupted
      : SERVICE_STATUS.normal;

  return [
    service({
      serviceId: 5000,
      area: "Pentland Firth",
      route: "Gills Bay - St Margaret's Hope",
      status,
      additionalInfo: htmlOrUndefined(lines.map((line) => `<p>${line}</p>`).join(" ")),
      organisationId: 6
    })
  ];
}

async function scrapeWestern(): Promise<ScrapedService[]> {
  const statusRoot = parse(await fetchText("https://status.western-ferries.co.uk/status/view"));
  const activeClass = statusRoot.querySelector(".active")?.getAttribute("class") ?? "";
  const additionalInfo = await fetchText("https://status.western-ferries.co.uk/status/content");

  const status = activeClass.includes("status-green")
    ? SERVICE_STATUS.normal
    : activeClass.includes("status-amber")
      ? SERVICE_STATUS.disrupted
      : activeClass.includes("status-red")
        ? SERVICE_STATUS.cancelled
        : SERVICE_STATUS.unknown;

  return [
    service({
      serviceId: 2000,
      area: "Cowal & Dunoon",
      route: "McInroy's Point (Gourock) - Hunters Quay (Dunoon)",
      status,
      additionalInfo: htmlOrUndefined(additionalInfo),
      organisationId: 3
    })
  ];
}

async function scrapeNorthLink(): Promise<ScrapedService[]> {
  const root = parse(await fetchText("https://www.northlinkferries.co.uk/opsnews/"));
  const statusClass = root.querySelectorAll("[class]")
    .map((element) => element.getAttribute("class") ?? "")
    .find((className) => className.includes("service-running") || className.includes("service-disruptions")) ?? "";
  const start = root.toString().search(/Please be aware of traffic delays|Pentland Firth Arrivals and Departures/);
  const support = root.toString().indexOf("Support", Math.max(0, start));
  const additionalInfo = start >= 0
    ? root.toString().slice(start, support > start ? support : undefined)
    : "";

  return [
    service({
      serviceId: 1000,
      area: "Orkney & Shetland",
      route: "Scrabster - Stromness / Aberdeen - Kirkwall - Lerwick",
      status: statusClass.includes("service-disruptions") ? SERVICE_STATUS.disrupted : SERVICE_STATUS.normal,
      additionalInfo: htmlOrUndefined(additionalInfo),
      organisationId: 2
    })
  ];
}

async function scrapeShetland(): Promise<ScrapedService[]> {
  const root = parse(await fetchText("https://www.shetland.gov.uk/ferrystatus"));
  const statuses = root.querySelectorAll("ul")
    .map((element) => text(element.getAttribute("class") ?? ""))
    .filter((className) => className.startsWith("Route_status_"));
  const status = (index: number): ServiceStatus => {
    const value = statuses[index] ?? "";
    if (value === "Route_status_ok") return SERVICE_STATUS.normal;
    if (value === "Route_status_amber") return SERVICE_STATUS.disrupted;
    if (value === "Route_status_red") return SERVICE_STATUS.cancelled;
    return SERVICE_STATUS.unknown;
  };
  const info = (name: string, phone: string): string =>
    `For more information on the ${name} service, phone <a href="tel:${phone}">${phone}</a>.`;

  return [
    service({ serviceId: 3000, area: "Bluemull Sound", route: "Gutcher - Belmont - Hamars Ness", status: status(0), additionalInfo: info("Bluemull Sound", "01595 743971"), organisationId: 4 }),
    service({ serviceId: 3001, area: "Yell", route: "Toft - Ulsta", status: status(1), additionalInfo: info("Yell Sound", "01595 743972"), organisationId: 4 }),
    service({ serviceId: 3003, area: "Whalsay", route: "Laxo - Symbister", status: status(2), additionalInfo: info("Whalsay", "01595 743973"), organisationId: 4 }),
    service({ serviceId: 3002, area: "Bressay", route: "Lerwick - Bressay", status: status(3), additionalInfo: info("Bressay", "01595 743974"), organisationId: 4 }),
    service({ serviceId: 3004, area: "Skerries", route: "Laxo - Symbister - Skerries - Vidlin - Lerwick", status: status(4), additionalInfo: info("Skerries", "01595 743975"), organisationId: 4 })
  ];
}

async function scrapeOrkney(): Promise<ScrapedService[]> {
  const statusRoot = parse(await fetchText("https://www.orkneyferries.co.uk/info/current-service-update"));
  const statuses = statusRoot.querySelectorAll("img")
    .map((element) => element.getAttribute("src") ?? "")
    .filter((src) => src.includes("tick") || src.includes("warning") || src.includes("no_entry"));
  const newsRoot = parse(await fetchText("https://www.orkneyferries.co.uk/news"));
  const additionalInfo = htmlOrUndefined(newsRoot.querySelector(".uk-placeholder")?.toString() ?? "");
  const status = (index: number): ServiceStatus => {
    const value = statuses[index] ?? "";
    if (value.includes("tick")) return SERVICE_STATUS.normal;
    if (value.includes("warning")) return SERVICE_STATUS.disrupted;
    if (value.includes("no_entry")) return SERVICE_STATUS.cancelled;
    return SERVICE_STATUS.unknown;
  };

  return [
    service({ serviceId: 4000, area: "Eday", route: "Kirkwall - Eday - Stronsay - Sanday - Rapness", status: status(0), additionalInfo, organisationId: 5 }),
    service({ serviceId: 4001, area: "Sanday", route: "Kirkwall - Eday - Stronsay - Sanday - Rapness", status: status(1), additionalInfo, organisationId: 5 }),
    service({ serviceId: 4002, area: "Stronsay", route: "Kirkwall - Eday - Stronsay - Sanday - Rapness", status: status(2), additionalInfo, organisationId: 5 }),
    service({ serviceId: 4003, area: "Westray", route: "Kirkwall - Eday - Stronsay - Sanday - Rapness", status: status(3), additionalInfo, organisationId: 5 }),
    service({ serviceId: 4004, area: "Shapinsay", route: "Kirkwall - Shapinsay", status: status(4), additionalInfo, organisationId: 5 }),
    service({ serviceId: 4005, area: "Graemsay", route: "Stromness - Graemsay - Hoy", status: status(5), additionalInfo, organisationId: 5 }),
    service({ serviceId: 4006, area: "Houton", route: "Houton - Flotta - Lyness - Longhope", status: status(6), additionalInfo, organisationId: 5 }),
    service({ serviceId: 4007, area: "Rousay, Egilsay & Wyre", route: "Tingwall - Rousay - Egilsay - Wyre", status: status(7), additionalInfo, organisationId: 5 }),
    service({ serviceId: 4008, area: "Pierowall - Papa Westray", route: "Westray Pierowall - Papa Westray", status: status(8), additionalInfo, organisationId: 5 })
  ];
}

function calMacStatus(status: string): ServiceStatus {
  if (status === "NORMAL") return SERVICE_STATUS.normal;
  if (status === "BE_AWARE" || status === "DISRUPTIONS") return SERVICE_STATUS.disrupted;
  if (status === "ALL_SAILINGS_CANCELLED") return SERVICE_STATUS.cancelled;
  return SERVICE_STATUS.unknown;
}

function calMacRouteInfo(statuses: CalMacRouteStatus[]): string | undefined {
  const order = new Map([["SAILING", 0], ["SERVICE", 1], ["INFORMATION", 2]]);
  const html = statuses
    .filter((status) => order.has(status.status))
    .sort((a, b) => (order.get(a.status) ?? 99) - (order.get(b.status) ?? 99) || a.title.localeCompare(b.title))
    .map((status) => `<h2>${status.title}</h2>${marked.parse(status.detail)}`)
    .join(" ");
  return htmlOrUndefined(html);
}

async function scrapeCalMac(): Promise<ScrapedService[]> {
  const query = `{
    routes {
      name
      routeCode
      routeStatuses { title status detail }
      location { name }
      status
    }
  }`;
  const response = await fetch("https://apim.calmac.co.uk/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      Host: "apim.calmac.co.uk",
      "Sec-Fetch-Site": "cross-site",
      "Accept-Language": "en-GB,en;q=0.9",
      "Sec-Fetch-Mode": "cors",
      Origin: "capacitor://localhost",
      Connection: "keep-alive",
      "Sec-Fetch-Dest": "empty"
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) {
    throw new Error(`CalMac GraphQL returned HTTP ${response.status}`);
  }

  const json = await response.json() as CalMacResponse;
  return (json.data?.routes ?? []).map((route) => service({
    serviceId: calMacServiceIds.get(route.routeCode) ?? Number.parseInt(route.routeCode, 10),
    area: route.location.name,
    route: route.name.replaceAll("[", "(").replaceAll("]", ")").replaceAll("�", "-"),
    status: calMacStatus(route.status),
    additionalInfo: calMacRouteInfo(route.routeStatuses),
    organisationId: 1
  }));
}

async function main(): Promise<void> {
  const db = openDatabase();
  const scrapers: OperatorScraper[] = [
    {
      name: "CalMac",
      scrape: scrapeCalMac,
      afterSave: (services) => {
        const scrapedIds = new Set(services.map((service) => service.serviceId));
        const removedIds = listServiceIdsForOrganisation(db, 1).filter((serviceId) => !scrapedIds.has(serviceId));
        hideServices(db, removedIds);
      }
    },
    { name: "Corran Ferry", scrape: scrapeCorran },
    { name: "NorthLink", scrape: scrapeNorthLink },
    { name: "Pentland Ferries", scrape: scrapePentland },
    { name: "Western Ferries", scrape: scrapeWestern },
    { name: "Shetland Ferries", scrape: scrapeShetland },
    { name: "Orkney Ferries", scrape: scrapeOrkney }
  ];

  try {
    for (const scraper of scrapers) {
      try {
        console.log(`Fetching ${scraper.name} services`);
        const services = await scraper.scrape();
        saveServices(db, services);
        scraper.afterSave?.(services);
      } catch (error) {
        process.exitCode = 1;
        console.error(`Skipping ${scraper.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    db.close();
  }
}

await main();
