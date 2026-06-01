import { config } from "../config.js";

const FALLBACK_MESSAGE = "Sailing information has been updated.";
const MAX_BODY_LENGTH = 120;

type Notice = {
  title: string;
  detail: string;
  disruptionReason: string | null;
};

type OllamaResponse = {
  response?: unknown;
};

export type InformationSummaryOutcome = "generated" | "fallback" | "suppressed";

export type InformationSummary = {
  body: string | null;
  outcome: InformationSummaryOutcome;
};

type SummaryOptions = {
  ollamaUrl?: string | null;
  model?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
};

export async function summariseInformationChange(
  previousInfo: string | undefined,
  nextInfo: string | undefined,
  options: SummaryOptions = {}
): Promise<InformationSummary> {
  const previousNotices = parseNotices(previousInfo);
  const nextNotices = parseNotices(nextInfo);
  if (previousNotices === null || nextNotices === null) {
    return fallback();
  }
  if (normaliseNotices(previousNotices) === normaliseNotices(nextNotices)) {
    return { body: null, outcome: "suppressed" };
  }

  const facts = currentChangedFacts(previousNotices, nextNotices);
  const ollamaUrl = options.ollamaUrl === undefined ? config.ollama.url : options.ollamaUrl;
  if (!ollamaUrl || facts.length === 0) {
    return fallback();
  }

  const model = options.model ?? config.ollama.model;
  const timeoutMs = options.timeoutMs ?? config.ollama.timeoutMs;
  const fetchFn = options.fetchFn ?? fetch;
  const firstPrompt = [
    "Rewrite exactly these facts as one plain-text ferry push notification under 100 characters.",
    "Do not add facts, context, markdown or emoji.",
    `Facts: ${facts.join(" ")}`
  ].join(" ");

  try {
    const first = await generate(ollamaUrl, model, timeoutMs, fetchFn, firstPrompt);
    if (validBody(first)) {
      return { body: first, outcome: "generated" };
    }
    if (first.length <= MAX_BODY_LENGTH) {
      return fallback();
    }

    const retryPrompt = [
      "Shorten this to at most 100 characters.",
      "Return only one plain-text sentence. Do not add facts, context, markdown or emoji.",
      `Text: ${first}`
    ].join(" ");
    const retry = await generate(ollamaUrl, model, timeoutMs, fetchFn, retryPrompt);
    return validBody(retry) ? { body: retry, outcome: "generated" } : fallback();
  } catch {
    return fallback();
  }
}

function parseNotices(value: string | undefined): Notice[] | null {
  if (value === undefined) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return null;
    }

    const notices: Notice[] = [];
    for (const notice of parsed) {
      if (!isRecord(notice) || typeof notice.title !== "string" || typeof notice.detail !== "string") {
        return null;
      }
      notices.push({
        title: notice.title,
        detail: notice.detail,
        disruptionReason: typeof notice.disruptionReason === "string" ? notice.disruptionReason : null
      });
    }
    return notices;
  } catch {
    return null;
  }
}

function currentChangedFacts(previousNotices: Notice[], nextNotices: Notice[]): string[] {
  const previousByTitle = new Map(previousNotices.map((notice) => [normaliseText(notice.title), notice]));
  return nextNotices.flatMap((notice) => {
    const previous = previousByTitle.get(normaliseText(notice.title));
    return previous && normaliseNotice(previous) === normaliseNotice(notice)
      ? []
      : [noticeText(notice)];
  });
}

function noticeText(notice: Notice): string {
  return [notice.title, notice.detail, notice.disruptionReason].filter(Boolean).map((value) => plainText(value ?? "")).join(". ");
}

function normaliseNotices(notices: Notice[]): string {
  return notices.map(normaliseNotice).sort().join("\n");
}

function normaliseNotice(notice: Notice): string {
  return [notice.title, notice.detail, notice.disruptionReason ?? ""].map(normaliseText).join("|");
}

function normaliseText(value: string): string {
  return plainText(value)
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "")
    .toLowerCase();
}

function plainText(value: string): string {
  return value
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function generate(
  ollamaUrl: string,
  model: string,
  timeoutMs: number,
  fetchFn: typeof fetch,
  prompt: string
): Promise<string> {
  const response = await fetchFn(`${ollamaUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      keep_alive: "0",
      prompt,
      options: {
        temperature: 0,
        num_predict: 80
      }
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    throw new Error(`Ollama request failed with HTTP ${response.status}`);
  }

  const body = await response.json() as OllamaResponse;
  return typeof body.response === "string" ? body.response.trim() : "";
}

function validBody(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_BODY_LENGTH
    && !/[\r\n]/.test(value)
    && !/https?:\/\//i.test(value)
    && !/[*_`#[\]<>]/.test(value)
    && !/\p{Extended_Pictographic}/u.test(value)
    && !/^(?:here(?:'s| is)|notification:)/i.test(value);
}

function fallback(): InformationSummary {
  return { body: FALLBACK_MESSAGE, outcome: "fallback" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
