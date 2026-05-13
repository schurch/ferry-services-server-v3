import "dotenv/config";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import zlib from "node:zlib";
import { HTMLElement, parse } from "node-html-parser";
import { config } from "../config/config.js";
import { openDatabase } from "../db/database.js";
import { replaceTransxchangeData } from "../db/transxchange.js";
import type {
  TransxchangeDateRange,
  TransxchangeDocument,
  TransxchangeJourneyPattern,
  TransxchangeJourneyPatternSection,
  TransxchangeJourneyPatternTimingLink,
  TransxchangeLine,
  TransxchangeService,
  TransxchangeStopPoint,
  TransxchangeVehicleJourney
} from "../types/transxchange.js";

type RawVehicleJourney = Partial<TransxchangeVehicleJourney> & {
  vehicleJourneyCode: string;
  vehicleJourneyRef?: string;
};

type ServicedOrganisationCalendars = {
  workingDays: Map<string, TransxchangeDateRange[]>;
  holidays: Map<string, TransxchangeDateRange[]>;
};

type FtpConfig = {
  address: string;
  username: string;
  password: string;
};

function child(element: HTMLElement, name: string): HTMLElement | null {
  return element.querySelector(name.toLowerCase());
}

function children(element: HTMLElement, name: string): HTMLElement[] {
  return element.querySelectorAll(name.toLowerCase());
}

function childText(element: HTMLElement, name: string): string | undefined {
  const value = child(element, name)?.text.trim();
  return value && value.length > 0 ? value : undefined;
}

function parseDate(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function parseDateTime(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}T/.test(value) ? value : undefined;
}

function parseTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\d{2}:\d{2}$/.test(value)) return `${value}:00`;
  return /^\d{2}:\d{2}:\d{2}$/.test(value) ? value : undefined;
}

function durationSeconds(value: string | undefined): number {
  if (!value) return 0;
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  return Number.parseInt(match[1] ?? "0", 10) * 3600 +
    Number.parseInt(match[2] ?? "0", 10) * 60 +
    Number.parseInt(match[3] ?? "0", 10);
}

function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (letter, index) => `${index === 0 ? "" : "_"}${letter.toLowerCase()}`);
}

function normalizeWeekOfMonthRule(value: string): string | null {
  const normalized = camelToSnake(value.trim());
  const aliases = new Map([
    ["1", "first"],
    ["2", "second"],
    ["3", "third"],
    ["4", "fourth"],
    ["5", "fifth"]
  ]);
  return aliases.get(normalized) ?? (normalized || null);
}

function normalizeBankHolidayDescription(value: string): string {
  const normalized = camelToSnake(value.trim());
  if (normalized === "jan2nd_scotland_holiday") return "jan2nd_scotland";
  if (normalized === "st_andrews_day_holiday") return "st_andrews_day";
  return normalized;
}

function dateRanges(node: HTMLElement | null): TransxchangeDateRange[] {
  if (!node) return [];
  return children(node, "DateRange").flatMap((range) => {
    const startDate = parseDate(childText(range, "StartDate"));
    const endDate = parseDate(childText(range, "EndDate"));
    return startDate && endDate ? [{ startDate, endDate }] : [];
  });
}

function parseServicedOrganisationCalendars(root: HTMLElement): ServicedOrganisationCalendars {
  const workingDays = new Map<string, TransxchangeDateRange[]>();
  const holidays = new Map<string, TransxchangeDateRange[]>();
  for (const organisation of children(root, "ServicedOrganisation")) {
    const code = childText(organisation, "OrganisationCode");
    if (!code) continue;
    workingDays.set(code, dateRanges(child(organisation, "WorkingDays")));
    holidays.set(code, dateRanges(child(organisation, "Holidays")));
  }
  return { workingDays, holidays };
}

function servicedOrganisationRanges(
  calendars: ServicedOrganisationCalendars,
  journey: HTMLElement,
  name: "DaysOfOperation" | "DaysOfNonOperation"
): TransxchangeDateRange[] {
  const node = child(child(journey, "ServicedOrganisationDayType") ?? journey, name);
  if (!node) return [];
  const refs = children(node, "ServicedOrganisationRef").map((ref) => ref.text.trim()).filter(Boolean);
  const lookup = name === "DaysOfOperation" ? calendars.workingDays : calendars.holidays;
  return refs.flatMap((ref) => lookup.get(ref) ?? []);
}

function specialDayRanges(journey: HTMLElement, name: "DaysOfOperation" | "DaysOfNonOperation"): TransxchangeDateRange[] {
  const special = child(child(journey, "SpecialDaysOperation") ?? journey, name);
  const bankHoliday = child(child(journey, "BankHolidayOperation") ?? journey, name);
  const holidayDates = bankHoliday
    ? children(bankHoliday, "OtherPublicHoliday").flatMap((node) => {
      const date = parseDate(childText(node, "Date"));
      return date ? [{ startDate: date, endDate: date }] : [];
    })
    : [];
  return [...dateRanges(special), ...holidayDates];
}

function bankHolidayRules(journey: HTMLElement, name: "DaysOfOperation" | "DaysOfNonOperation"): string[] {
  const node = child(child(journey, "BankHolidayOperation") ?? journey, name);
  if (!node) return [];
  return node.childNodes.flatMap((item) => {
    if (!(item instanceof HTMLElement)) return [];
    if (item.rawTagName.toLowerCase() === "otherpublicholiday" && childText(item, "Date")) return [];
    if (item.rawTagName.toLowerCase() === "otherpublicholiday") {
      return [normalizeBankHolidayDescription(childText(item, "Description") ?? "other_public_holiday")];
    }
    return [camelToSnake(item.rawTagName)];
  });
}

function dayRules(journey: HTMLElement): string[] {
  const node = child(journey, "DaysOfWeek");
  if (!node) return [];
  return node.childNodes.flatMap((item) => {
    if (!(item instanceof HTMLElement)) return [];
    const tag = item.rawTagName;
    const normalized = camelToSnake(tag);
    if (normalized === "monday_to_friday") return ["monday_to_friday"];
    if (normalized === "monday_to_saturday") return ["monday_to_saturday"];
    if (normalized === "monday_to_sunday") return ["monday_to_sunday"];
    return [normalized];
  });
}

function weekOfMonthRules(journey: HTMLElement): string[] {
  const node = child(journey, "WeekOfMonth");
  if (!node) return [];
  return children(node, "WeekNumber")
    .map((item) => normalizeWeekOfMonthRule(item.text))
    .filter((item): item is string => item !== null);
}

function parseStopPoints(root: HTMLElement): TransxchangeStopPoint[] {
  return children(root, "AnnotatedStopPointRef").map((node) => ({
    stopPointRef: childText(node, "StopPointRef") ?? "",
    commonName: childText(node, "CommonName") ?? ""
  })).filter((item) => item.stopPointRef.length > 0);
}

function parseServices(root: HTMLElement): {
  services: TransxchangeService[];
  lines: TransxchangeLine[];
  journeyPatterns: TransxchangeJourneyPattern[];
  journeyPatternSections: TransxchangeJourneyPatternSection[];
} {
  const services: TransxchangeService[] = [];
  const lines: TransxchangeLine[] = [];
  const journeyPatterns: TransxchangeJourneyPattern[] = [];
  const journeyPatternSections: TransxchangeJourneyPatternSection[] = [];

  for (const serviceNode of children(root, "Service")) {
    const serviceCode = childText(serviceNode, "ServiceCode") ?? "";
    const standard = child(serviceNode, "StandardService");
    services.push({
      serviceCode,
      operatorRef: childText(serviceNode, "RegisteredOperatorRef") ?? "",
      mode: childText(serviceNode, "Mode") ?? "",
      description: childText(serviceNode, "Description") ?? "",
      origin: standard ? childText(standard, "Origin") ?? "" : "",
      destination: standard ? childText(standard, "Destination") ?? "" : "",
      startDate: parseDate(childText(child(serviceNode, "OperatingPeriod") ?? serviceNode, "StartDate")),
      endDate: parseDate(childText(child(serviceNode, "OperatingPeriod") ?? serviceNode, "EndDate"))
    });

    for (const line of children(serviceNode, "Line")) {
      lines.push({
        lineId: line.getAttribute("id") ?? "",
        serviceCode,
        lineName: childText(line, "LineName") ?? ""
      });
    }

    if (standard) {
      for (const pattern of children(standard, "JourneyPattern")) {
        const journeyPatternId = pattern.getAttribute("id") ?? "";
        journeyPatterns.push({
          journeyPatternId,
          serviceCode,
          direction: childText(pattern, "Direction") ?? ""
        });
        children(pattern, "JourneyPatternSectionRefs").forEach((section, index) => {
          journeyPatternSections.push({
            journeyPatternId,
            sectionRef: section.text.trim(),
            sectionOrder: index + 1
          });
        });
      }
    }
  }

  return { services, lines, journeyPatterns, journeyPatternSections };
}

function parseTimingLinks(root: HTMLElement): TransxchangeJourneyPatternTimingLink[] {
  return children(root, "JourneyPatternSection").flatMap((sectionNode) => {
    const sectionRef = sectionNode.getAttribute("id") ?? "";
    return children(sectionNode, "JourneyPatternTimingLink").map((linkNode, index) => {
      const from = child(linkNode, "From");
      const to = child(linkNode, "To");
      return {
        journeyPatternTimingLinkId: linkNode.getAttribute("id") ?? "",
        journeyPatternSectionRef: sectionRef,
        sortOrder: index + 1,
        fromStopPointRef: from ? childText(from, "StopPointRef") ?? "" : "",
        fromActivity: from ? childText(from, "Activity") ?? "" : "",
        fromTimingStatus: from ? childText(from, "TimingStatus") ?? "" : "",
        toStopPointRef: to ? childText(to, "StopPointRef") ?? "" : "",
        toActivity: to ? childText(to, "Activity") ?? "" : "",
        toTimingStatus: to ? childText(to, "TimingStatus") ?? "" : "",
        routeLinkRef: childText(linkNode, "RouteLinkRef") ?? "",
        direction: childText(linkNode, "Direction") ?? "",
        runSeconds: durationSeconds(childText(linkNode, "RunTime")),
        fromWaitSeconds: from ? durationSeconds(childText(from, "WaitTime")) : 0
      };
    });
  });
}

function parseRawVehicleJourneys(root: HTMLElement, calendars: ServicedOrganisationCalendars): RawVehicleJourney[] {
  return children(root, "VehicleJourney").map((journey) => ({
    vehicleJourneyCode: childText(journey, "VehicleJourneyCode") ?? "",
    vehicleJourneyRef: childText(journey, "VehicleJourneyRef"),
    serviceCode: childText(journey, "ServiceRef"),
    lineId: childText(journey, "LineRef"),
    journeyPatternId: childText(journey, "JourneyPatternRef"),
    timingLinkRefs: children(journey, "VehicleJourneyTimingLink")
      .map((link) => childText(link, "JourneyPatternTimingLinkRef"))
      .filter((item): item is string => item !== undefined),
    operatorRef: childText(journey, "OperatorRef"),
    departureTime: parseTime(childText(journey, "DepartureTime")),
    dayRules: dayRules(journey),
    weekOfMonthRules: weekOfMonthRules(journey),
    servicedOrganisationDaysOfOperation: servicedOrganisationRanges(calendars, journey, "DaysOfOperation"),
    servicedOrganisationDaysOfNonOperation: servicedOrganisationRanges(calendars, journey, "DaysOfNonOperation"),
    daysOfOperation: specialDayRanges(journey, "DaysOfOperation"),
    daysOfNonOperation: specialDayRanges(journey, "DaysOfNonOperation"),
    bankHolidayOperationRules: bankHolidayRules(journey, "DaysOfOperation"),
    bankHolidayNonOperationRules: bankHolidayRules(journey, "DaysOfNonOperation"),
    note: children(journey, "NoteText").map((note) => note.text.trim()).filter(Boolean).join(" | "),
    noteCode: children(journey, "NoteCode").map((note) => note.text.trim()).filter(Boolean).join(" | ")
  })).filter((journey) => journey.vehicleJourneyCode.length > 0);
}

function resolveVehicleJourneys(rawJourneys: RawVehicleJourney[]): TransxchangeVehicleJourney[] {
  const byCode = new Map(rawJourneys.map((journey) => [journey.vehicleJourneyCode, journey]));

  function resolve(journey: RawVehicleJourney, seen = new Set<string>()): RawVehicleJourney {
    if (!journey.vehicleJourneyRef || seen.has(journey.vehicleJourneyRef)) return journey;
    const parent = byCode.get(journey.vehicleJourneyRef);
    if (!parent) return journey;
    const resolvedParent = resolve(parent, new Set([...seen, journey.vehicleJourneyRef]));
    return {
      ...resolvedParent,
      ...Object.fromEntries(Object.entries(journey).filter(([, value]) => value !== undefined)),
      vehicleJourneyCode: journey.vehicleJourneyCode
    };
  }

  return rawJourneys.flatMap((journey) => {
    const resolved = resolve(journey);
    if (!resolved.serviceCode || !resolved.lineId || !resolved.journeyPatternId || !resolved.departureTime) {
      return [];
    }
    return [{
      vehicleJourneyCode: resolved.vehicleJourneyCode,
      serviceCode: resolved.serviceCode,
      lineId: resolved.lineId,
      journeyPatternId: resolved.journeyPatternId,
      timingLinkRefs: resolved.timingLinkRefs ?? [],
      operatorRef: resolved.operatorRef ?? "",
      departureTime: resolved.departureTime,
      dayRules: resolved.dayRules ?? [],
      weekOfMonthRules: resolved.weekOfMonthRules ?? [],
      servicedOrganisationDaysOfOperation: resolved.servicedOrganisationDaysOfOperation ?? [],
      servicedOrganisationDaysOfNonOperation: resolved.servicedOrganisationDaysOfNonOperation ?? [],
      daysOfOperation: resolved.daysOfOperation ?? [],
      daysOfNonOperation: resolved.daysOfNonOperation ?? [],
      bankHolidayOperationRules: resolved.bankHolidayOperationRules ?? [],
      bankHolidayNonOperationRules: resolved.bankHolidayNonOperationRules ?? [],
      note: resolved.note ?? "",
      noteCode: resolved.noteCode ?? ""
    }];
  });
}

function versionKey(fileName: string, creation?: string, modification?: string): string {
  return `${fileName}|${creation ?? ""}|${modification ?? ""}`;
}

function parseDocument(filePath: string): TransxchangeDocument | null {
  const xml = fs.readFileSync(filePath, "utf8");
  if (!xml.toLowerCase().includes("<mode>ferry</mode>")) return null;

  const root = parse(xml);
  const documentNode = root.querySelector("transxchange");
  const sourceFileName = documentNode?.getAttribute("filename") ?? path.basename(filePath);
  const sourceCreationDateTime = parseDateTime(documentNode?.getAttribute("creationdatetime"));
  const sourceModificationDateTime = parseDateTime(documentNode?.getAttribute("modificationdatetime"));
  const serviceParts = parseServices(root);
  const ferryServiceCodes = new Set(
    serviceParts.services
      .filter((service) => service.mode.toLowerCase() === "ferry")
      .map((service) => service.serviceCode)
  );
  if (ferryServiceCodes.size === 0) return null;

  const journeyPatternIds = new Set(
    serviceParts.journeyPatterns
      .filter((pattern) => ferryServiceCodes.has(pattern.serviceCode))
      .map((pattern) => pattern.journeyPatternId)
  );
  const calendars = parseServicedOrganisationCalendars(root);
  const vehicleJourneys = resolveVehicleJourneys(parseRawVehicleJourneys(root, calendars))
    .filter((journey) => ferryServiceCodes.has(journey.serviceCode));

  return {
    sourcePath: filePath,
    sourceFileName,
    sourceVersionKey: versionKey(sourceFileName, sourceCreationDateTime, sourceModificationDateTime),
    sourceCreationDateTime,
    sourceModificationDateTime,
    stopPoints: parseStopPoints(root),
    services: serviceParts.services.filter((service) => ferryServiceCodes.has(service.serviceCode)),
    lines: serviceParts.lines.filter((line) => ferryServiceCodes.has(line.serviceCode)),
    journeyPatterns: serviceParts.journeyPatterns.filter((pattern) => ferryServiceCodes.has(pattern.serviceCode)),
    journeyPatternSections: serviceParts.journeyPatternSections.filter((section) => journeyPatternIds.has(section.journeyPatternId)),
    journeyPatternTimingLinks: parseTimingLinks(root),
    vehicleJourneys
  };
}

function findXmlFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findXmlFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".xml") ? [entryPath] : [];
  }).sort();
}

function socketRead(socket: net.Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer): void => {
      cleanup();
      resolve(chunk);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.once("data", onData);
    socket.once("error", onError);
  });
}

async function sendFtpCommand(socket: net.Socket, command: string): Promise<string> {
  socket.write(`${command}\r\n`);
  const response = (await socketRead(socket)).toString("utf8");
  console.log(`FTP: ${response.split("\r")[0] ?? response.trim()}`);
  return response;
}

function passiveEndpoint(response: string): { host: string; port: number } {
  const match = response.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
  if (!match) {
    throw new Error(`Could not parse FTP passive response: ${response.trim()}`);
  }
  return {
    host: `${match[1]}.${match[2]}.${match[3]}.${match[4]}`,
    port: Number.parseInt(match[5], 10) * 256 + Number.parseInt(match[6], 10)
  };
}

function connectSocket(host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host, () => resolve(socket));
    socket.once("error", reject);
  });
}

async function downloadFtpFile(ftp: FtpConfig, remoteFilePath: string, localFilePath: string): Promise<void> {
  fs.rmSync(localFilePath, { force: true });
  const control = await connectSocket(ftp.address, 21);
  try {
    console.log(`FTP: ${(await socketRead(control)).toString("utf8").split("\r")[0] ?? ""}`);
    await sendFtpCommand(control, `USER ${ftp.username}`);
    await sendFtpCommand(control, `PASS ${ftp.password}`);
    await sendFtpCommand(control, "TYPE I");
    const passive = passiveEndpoint(await sendFtpCommand(control, "PASV"));
    console.log(`FTP passive endpoint: ${passive.host}:${passive.port}`);
    const data = await connectSocket(passive.host, passive.port);
    const output = fs.createWriteStream(localFilePath);
    const finished = new Promise<void>((resolve, reject) => {
      data.on("error", reject);
      output.on("error", reject);
      output.on("finish", resolve);
    });
    data.pipe(output);
    await sendFtpCommand(control, `RETR ${remoteFilePath}`);
    await finished;
    await socketRead(control);
    await sendFtpCommand(control, "QUIT").catch(() => undefined);
  } finally {
    control.destroy();
  }
}

function safeExtractPath(outputDirectory: string, entryName: string): string {
  const destination = path.resolve(outputDirectory, entryName);
  const root = path.resolve(outputDirectory);
  if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing to extract ZIP entry outside target directory: ${entryName}`);
  }
  return destination;
}

function findEndOfCentralDirectory(zip: Buffer): number {
  const signature = 0x06054b50;
  const minimumSize = 22;
  const searchStart = Math.max(0, zip.length - 65_557);
  for (let offset = zip.length - minimumSize; offset >= searchStart; offset -= 1) {
    if (zip.readUInt32LE(offset) === signature) {
      return offset;
    }
  }
  throw new Error("Could not find ZIP central directory");
}

async function extractZip(zipFilePath: string, outputDirectory: string): Promise<void> {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });

  const zip = fs.readFileSync(zipFilePath);
  const endOffset = findEndOfCentralDirectory(zip);
  const entryCount = zip.readUInt16LE(endOffset + 10);
  let centralOffset = zip.readUInt32LE(endOffset + 16);

  for (let index = 0; index < entryCount; index += 1) {
    if (zip.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory entry");
    }

    const method = zip.readUInt16LE(centralOffset + 10);
    const compressedSize = zip.readUInt32LE(centralOffset + 20);
    const nameLength = zip.readUInt16LE(centralOffset + 28);
    const extraLength = zip.readUInt16LE(centralOffset + 30);
    const commentLength = zip.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = zip.readUInt32LE(centralOffset + 42);
    const entryName = zip.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString("utf8");

    if (zip.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid ZIP local header for ${entryName}`);
    }

    const destination = safeExtractPath(outputDirectory, entryName);
    if (entryName.endsWith("/")) {
      fs.mkdirSync(destination, { recursive: true });
    } else {
      const localNameLength = zip.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const data = zip.subarray(dataStart, dataStart + compressedSize);
      const contents = method === 0
        ? data
        : method === 8
          ? zlib.inflateRawSync(data)
          : null;
      if (!contents) {
        throw new Error(`Unsupported ZIP compression method ${method} for ${entryName}`);
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, contents);
    }

    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
}

async function prepareIngestDirectory(): Promise<string> {
  const directory = process.argv[2];
  if (directory) {
    return directory;
  }

  const ftp = config.travelineFtp;
  if (!ftp.address || !ftp.username || !ftp.password) {
    throw new Error("Usage: node dist/jobs/transxchange-ingester.js <directory> or set TRAVELLINE_FTP_ADDRESS, TRAVELLINE_FTP_USERNAME and TRAVELLINE_FTP_PASSWORD");
  }

  const workingDirectory = path.resolve("data/transxchange-ingest");
  const zipFilePath = path.join(workingDirectory, "S.zip");
  const extractDirectory = path.join(workingDirectory, "S");
  fs.mkdirSync(workingDirectory, { recursive: true });
  console.log("Downloading S.zip for TransXChange ingest ...");
  await downloadFtpFile(ftp as FtpConfig, "S.zip", zipFilePath);
  await extractZip(zipFilePath, extractDirectory);
  return extractDirectory;
}

async function main(): Promise<void> {
  const directory = await prepareIngestDirectory();
  const files = findXmlFiles(directory);
  console.log(`TransXChange files discovered: ${files.length}`);

  const documents: TransxchangeDocument[] = [];
  let skipped = 0;
  for (const [index, file] of files.entries()) {
    const document = parseDocument(file);
    if (document) documents.push(document);
    else skipped += 1;
    if (index === 0 || (index + 1) % 50 === 0 || index === files.length - 1) {
      console.log(`TransXChange progress ${index + 1}/${files.length}: ferry_documents=${documents.length}, skipped=${skipped}`);
    }
  }

  const db = openDatabase();
  try {
    replaceTransxchangeData(db, documents);
  } finally {
    db.close();
  }
  console.log(`TransXChange ingest complete: ferry_documents=${documents.length}, skipped=${skipped}`);
}

await main();
