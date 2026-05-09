export type ApnsMessage = {
  deviceToken: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
};

export async function sendApnsMessage(_message: ApnsMessage): Promise<void> {
  throw new Error("APNs delivery is not implemented yet.");
}

