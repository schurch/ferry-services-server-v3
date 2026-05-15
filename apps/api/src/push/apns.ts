import http2 from "node:http2";
import crypto from "node:crypto";
import fs from "node:fs";
import { config } from "../config.js";

export type ApnsPayload = {
  aps: {
    alert: {
      title: string;
      body: string;
    };
    sound: "default";
  };
  service_id: number;
};

export type ApnsResult = "success" | "invalid-token" | "skipped";

let cachedToken: { value: string; expiresAt: number } | null = null;

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function apnsAuthToken(): string {
  if (!config.apns.teamId || !config.apns.keyId || !config.apns.privateKeyPath) {
    throw new Error("APNs is not configured");
  }

  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.value;
  }

  const header = base64Url(JSON.stringify({ alg: "ES256", kid: config.apns.keyId }));
  const claims = base64Url(JSON.stringify({ iss: config.apns.teamId, iat: now }));
  const unsigned = `${header}.${claims}`;
  const key = fs.readFileSync(config.apns.privateKeyPath, "utf8");
  const signature = crypto.sign("sha256", Buffer.from(unsigned), {
    key,
    dsaEncoding: "ieee-p1363"
  });
  const value = `${unsigned}.${base64Url(signature)}`;
  cachedToken = { value, expiresAt: now + 50 * 60 };
  return value;
}

export async function sendApnsMessage(deviceToken: string, payload: ApnsPayload): Promise<ApnsResult> {
  if (!config.apns.bundleId || !config.apns.teamId || !config.apns.keyId || !config.apns.privateKeyPath) {
    return "skipped";
  }

  const bundleId = config.apns.bundleId;
  const origin = config.apns.production === true ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
  const client = http2.connect(origin);

  try {
    const body = JSON.stringify(payload);
    const result = await new Promise<ApnsResult>((resolve, reject) => {
      const request = client.request({
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        authorization: `bearer ${apnsAuthToken()}`,
        "apns-topic": bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      });

      let status = 0;
      let responseBody = "";
      request.setEncoding("utf8");
      request.on("response", (headers) => {
        status = Number(headers[":status"] ?? 0);
      });
      request.on("data", (chunk) => {
        responseBody += chunk;
      });
      request.on("error", reject);
      request.on("end", () => {
        if (status >= 200 && status < 300) {
          resolve("success");
          return;
        }

        if (status === 400 || status === 410) {
          try {
            const reason = (JSON.parse(responseBody) as { reason?: unknown }).reason;
            if (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic" || reason === "Unregistered") {
              resolve("invalid-token");
              return;
            }
          } catch {
            // Fall through to normal error handling.
          }
        }

        reject(new Error(`APNs returned HTTP ${status}: ${responseBody.slice(0, 500)}`));
      });
      request.end(body);
    });

    return result;
  } finally {
    client.close();
  }
}
