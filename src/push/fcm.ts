export type FcmMessage = {
  deviceToken: string;
  title: string;
  body: string;
  data?: Record<string, string>;
};

export async function sendFcmMessage(_message: FcmMessage): Promise<void> {
  throw new Error("FCM delivery is not implemented yet.");
}

