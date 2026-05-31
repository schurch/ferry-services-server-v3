import { setTimeout as delay } from "node:timers/promises";
import { logger } from "../../logger.js";
import { capitaliseWords, cleanVesselText, parseInteger, parseNumber, parseText } from "./source-utils.js";
import type { PositionUpdate, SourceVesselUpdateHandler } from "./types.js";

export async function runAisStreamLoop(
  apiKey: string,
  mmsis: string[],
  onUpdate: SourceVesselUpdateHandler,
  onName: (mmsi: number, name: string) => void
): Promise<void> {
  let reconnectDelayMs = 5_000;
  while (true) {
    try {
      await connectToAisStream(apiKey, mmsis, onUpdate, onName);
      reconnectDelayMs = 5_000;
    } catch (error) {
      logger.warn({ err: error }, "AISStream vessel fetcher disconnected with an error");
    }

    await delay(reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 60_000);
  }
}

type AisStreamMessage = {
  MessageType?: unknown;
  Metadata?: Record<string, unknown>;
  Message?: Record<string, unknown>;
};

const aisStreamUrl = "wss://stream.aisstream.io/v0/stream";

function connectToAisStream(
  apiKey: string,
  mmsis: string[],
  onUpdate: SourceVesselUpdateHandler,
  onName: (mmsi: number, name: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(aisStreamUrl);
    let settled = false;

    const settle = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FiltersShipMMSI: mmsis,
        FilterMessageTypes: [
          "PositionReport",
          "ShipStaticData",
          "StaticDataReport",
          "StandardClassBPositionReport",
          "ExtendedClassBPositionReport"
        ]
      }));
      logger.info({ vesselCount: mmsis.length }, "Subscribed to AISStream vessel updates");
    });

    socket.addEventListener("message", (event) => {
      void (async () => {
        const text = await eventDataText(event.data);
        const message = JSON.parse(text) as AisStreamMessage;
        const shipName = parseAisShipName(message);
        if (shipName) {
          onName(shipName.mmsi, shipName.name);
        }

        const position = parseAisPositionUpdate(message);
        if (!position) {
          return;
        }

        await onUpdate({ position });
      })().catch((error: unknown) => {
        logger.warn({ err: error }, "Skipping AISStream message because it could not be processed");
      });
    });

    socket.addEventListener("error", () => {
      socket.close();
      settle(new Error("AISStream websocket error"));
    });

    socket.addEventListener("close", (event) => {
      const reason = event.reason || undefined;
      logger.warn({ code: event.code, reason }, "AISStream websocket closed");
      settle();
    });
  });
}

function aisMessageBody(message: AisStreamMessage): Record<string, unknown> {
  const messageType = parseText(message.MessageType);
  const value = messageType ? message.Message?.[messageType] : undefined;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseAisPositionUpdate(message: AisStreamMessage): PositionUpdate | null {
  const body = aisMessageBody(message);
  const metadata = message.Metadata ?? {};
  const mmsi = parseInteger(body.UserID ?? body.MMSI ?? body.Mmsi ?? metadata.MMSI ?? metadata.ShipMMSI);
  const latitude = parseNumber(body.Latitude ?? metadata.Latitude ?? metadata.latitude);
  const longitude = parseNumber(body.Longitude ?? metadata.Longitude ?? metadata.longitude);
  if (mmsi === undefined || latitude === undefined || longitude === undefined) {
    return null;
  }

  const destination = parseText(body.Destination);
  return {
    mmsi,
    latitude,
    longitude,
    speed: parseNumber(body.Sog ?? body.SOG ?? metadata.Sog ?? metadata.SOG),
    course: parseNumber(body.Cog ?? body.COG ?? metadata.Cog ?? metadata.COG),
    destinationName: destination ? cleanVesselText(destination) : undefined,
    receivedAt: sqlTimestamp()
  };
}

function parseAisShipName(message: AisStreamMessage): { mmsi: number; name: string } | null {
  const body = aisMessageBody(message);
  const metadata = message.Metadata ?? {};
  const mmsi = parseInteger(body.UserID ?? body.MMSI ?? body.Mmsi ?? metadata.MMSI ?? metadata.ShipMMSI);
  const rawName = parseText(body.Name ?? body.ShipName ?? body.NameExtension ?? metadata.ShipName);
  return mmsi !== undefined && rawName !== undefined
    ? { mmsi, name: capitaliseWords(rawName) }
    : null;
}

async function eventDataText(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (data instanceof Blob) {
    return data.text();
  }
  return String(data);
}

function sqlTimestamp(date = new Date()): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}
