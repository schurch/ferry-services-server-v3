import { config } from "../config.js";
import { logger } from "../logger.js";

const FALLBACK_MESSAGE = "Sailing information has been updated.";
const MAX_BODY_LENGTH = 120;
const MAX_FACTS_LENGTH = 1500;
const OLLAMA_KEEP_ALIVE = "5m";

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
    return fallback("invalid-notice-payload", {
      previousInfoPresent: previousInfo !== undefined,
      nextInfoPresent: nextInfo !== undefined
    });
  }
  if (normaliseNotices(previousNotices) === normaliseNotices(nextNotices)) {
    return { body: null, outcome: "suppressed" };
  }

  const { facts, removed } = currentChangedFacts(previousNotices, nextNotices);
  const ollamaUrl = options.ollamaUrl === undefined ? config.ollama.url : options.ollamaUrl;
  if (facts.length === 0) {
    return removed
      ? fallback("removed-only-change")
      : { body: null, outcome: "suppressed" };
  }

  const factsText = facts.join(" ");
  if (!ollamaUrl || factsText.length > MAX_FACTS_LENGTH) {
    return fallback(!ollamaUrl ? "ollama-disabled" : "changed-facts-too-long", {
      factCount: facts.length,
      factsLength: factsText.length
    });
  }

  const model = options.model ?? config.ollama.model;
  const timeoutMs = options.timeoutMs ?? config.ollama.timeoutMs;
  const fetchFn = options.fetchFn ?? fetch;
  const firstPrompt = [
    "Rewrite exactly these facts as one plain-text ferry push notification under 100 characters.",
    "Do not add facts, context, markdown or emoji.",
    "Do not omit operational state words that appear in the facts.",
    `Facts: ${factsText}`
  ].join(" ");

  try {
    const first = await generate(ollamaUrl, model, timeoutMs, fetchFn, firstPrompt);
    if (validBody(first) && preservesSafetyTerms(factsText, first)) {
      return { body: first, outcome: "generated" };
    }
    if (first.length <= MAX_BODY_LENGTH) {
      return fallback("generated-body-rejected", {
        generatedLength: first.length
      });
    }

    const retryPrompt = [
      "Shorten this to at most 100 characters.",
      "Return only one plain-text sentence. Do not add facts, context, markdown or emoji.",
      `Text: ${first}`
    ].join(" ");
    const retry = await generate(ollamaUrl, model, timeoutMs, fetchFn, retryPrompt);
    if (validBody(retry) && preservesSafetyTerms(factsText, retry)) {
      return { body: retry, outcome: "generated" };
    }
    return fallback("retry-body-rejected", {
      generatedLength: retry.length
    });
  } catch (error) {
    return fallback("ollama-request-failed", {
      error: error instanceof Error ? error.message : String(error)
    });
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

function currentChangedFacts(previousNotices: Notice[], nextNotices: Notice[]): { facts: string[]; removed: boolean } {
  const previousByTitle = new Map(previousNotices.map((notice) => [normaliseText(notice.title), notice]));
  const nextTitles = new Set(nextNotices.map((notice) => normaliseText(notice.title)));
  const facts: string[] = [];
  let removed = previousNotices.some((notice) => !nextTitles.has(normaliseText(notice.title)));

  for (const notice of nextNotices) {
    const previous = previousByTitle.get(normaliseText(notice.title));
    if (!previous) {
      facts.push(noticeText(notice));
      continue;
    }
    if (normaliseNotice(previous) === normaliseNotice(notice)) {
      continue;
    }

    const change = changedNoticeFacts(previous, notice);
    facts.push(...change.facts);
    removed ||= change.removed;
  }

  return { facts, removed };
}

function changedNoticeFacts(previous: Notice, next: Notice): { facts: string[]; removed: boolean } {
  const previousParagraphs = splitParagraphs(previous.detail);
  const nextParagraphs = splitParagraphs(next.detail);
  const previousParagraphKeys = new Set(previousParagraphs.map(normaliseText));
  const nextParagraphKeys = new Set(nextParagraphs.map(normaliseText));
  const previousSentenceKeys = new Set(splitSentences(previous.detail).map(normaliseText));
  const changedParagraphs = nextParagraphs
    .map((paragraph, index) => ({ paragraph, index }))
    .filter(({ paragraph }) => !previousParagraphKeys.has(normaliseText(paragraph)));
  const facts = changedParagraphs.flatMap(({ paragraph, index }) => {
    if (isLinkOnlyParagraph(paragraph)) {
      return [];
    }
    const changedSentences = splitSentences(paragraph)
      .filter((sentence) => !previousSentenceKeys.has(normaliseText(sentence)));
    const changedFacts = changedSentences.length > 0 ? changedSentences : [paragraph];
    return plainText(paragraph).endsWith(":")
      ? [...changedFacts, ...trailingParagraphContext(nextParagraphs, index)]
      : changedFacts;
  });

  const reasonChanged = normaliseText(previous.disruptionReason ?? "") !== normaliseText(next.disruptionReason ?? "");
  if (reasonChanged && next.disruptionReason) {
    facts.push(`Disruption reason: ${next.disruptionReason}.`);
  }

  return {
    facts: uniqueFacts(facts),
    removed: previousParagraphs.some((paragraph) => !nextParagraphKeys.has(normaliseText(paragraph)))
      || (reasonChanged && !next.disruptionReason)
  };
}

function noticeText(notice: Notice): string {
  return [notice.title, notice.detail, notice.disruptionReason].filter(Boolean).map((value) => plainText(value ?? "")).join(". ");
}

function splitParagraphs(value: string): string[] {
  return value
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0 && !/^\s*\[[^\]]+\]:\s*\S+.*$/s.test(paragraph));
}

function splitSentences(value: string): string[] {
  return splitParagraphs(value).flatMap((paragraph) => paragraph
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean));
}

function trailingParagraphContext(paragraphs: string[], index: number): string[] {
  const context: string[] = [];
  for (const paragraph of paragraphs.slice(index + 1)) {
    if (isLinkOnlyParagraph(paragraph)) {
      continue;
    }
    context.push(paragraph);
    if (/[.!?]\s*$/.test(plainText(paragraph))) {
      break;
    }
  }
  return context;
}

function isLinkOnlyParagraph(value: string): boolean {
  return /^\s*\[[^\]]+\](?:\([^)]+\)|\[[^\]]*\])\s*$/.test(value);
}

function uniqueFacts(facts: string[]): string[] {
  const seen = new Set<string>();
  return facts.map(plainText).filter((fact) => {
    const key = normaliseText(fact);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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
      keep_alive: OLLAMA_KEEP_ALIVE,
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

function preservesSafetyTerms(facts: string, body: string): boolean {
  const requiredTerms: Array<[RegExp, RegExp]> = [
    [/\bcancell?/iu, /\bcancell?/iu],
    [/\bclos(?:e|ed|ure)\b/iu, /\bclos(?:e|ed|ure)\b/iu],
    [/\bsuspend/iu, /\bsuspend/iu],
    [/\bno\b/iu, /\bno\b/iu],
    [/\bnot\b/iu, /\bnot\b/iu],
    [/\bwithout\b/iu, /\bwithout\b/iu],
    [/\bunavailable\b/iu, /\bunavailable\b/iu]
  ];
  return requiredTerms.every(([factsPattern, bodyPattern]) => !factsPattern.test(facts) || bodyPattern.test(body));
}

function fallback(reason: string, details: Record<string, unknown> = {}): InformationSummary {
  logger.warn({ reason, ...details }, "Falling back to default information-change summary");
  return { body: FALLBACK_MESSAGE, outcome: "fallback" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
