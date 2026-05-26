import { GoogleAuth } from "google-auth-library";
import { config } from "../config.js";

export type FcmPayload = {
  data: {
    service_id: string;
    title: string;
    body: string;
  };
  android: {
    priority: "HIGH";
  };
};

export type FcmResult = "success" | "invalid-token" | "skipped";

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/firebase.messaging"]
});

function invalidTokenResponse(status: number, body: string): boolean {
  if (status === 404 || body.includes("UNREGISTERED") || body.includes("registration-token-not-registered")) {
    return true;
  }

  try {
    const parsed = JSON.parse(body) as { error?: { details?: Array<{ errorCode?: unknown }> } };
    return parsed.error?.details?.some((detail) => detail.errorCode === "INVALID_ARGUMENT") === true;
  } catch {
    return false;
  }
}

export async function sendFcmMessage(deviceToken: string, payload: FcmPayload): Promise<FcmResult> {
  if (!config.fcm.projectId || !config.fcm.googleApplicationCredentials) {
    return "skipped";
  }

  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  if (!accessToken.token) {
    throw new Error("Could not get Google access token for FCM");
  }

  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${config.fcm.projectId}/messages:send`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        data: payload.data,
        android: payload.android
      }
    }),
    signal: AbortSignal.timeout(20_000)
  });

  if (response.ok) {
    return "success";
  }

  const body = await response.text();
  if (invalidTokenResponse(response.status, body)) {
    return "invalid-token";
  }

  throw new Error(`FCM returned HTTP ${response.status}: ${body.slice(0, 500)}`);
}
