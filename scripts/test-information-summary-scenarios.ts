import Database from "better-sqlite3";
import { summariseInformationChange } from "../src/push/information-summary.js";

const databasePath = process.argv[2];
const scenarioLimit = Number(process.argv[3] ?? "12");
if (!databasePath || !Number.isInteger(scenarioLimit) || scenarioLimit < 1) {
  throw new Error("Usage: npx tsx scripts/test-information-summary-scenarios.ts <database-path> [scenario-limit]");
}

const db = new Database(databasePath, { readonly: true });
const ollamaUrl = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const model = process.env.OLLAMA_MODEL ?? "qwen3:1.7b";
const observations = db.prepare(`
  SELECT
    o.observation_id,
    o.service_id,
    o.observed_at,
    s.route
  FROM service_status_observations o
  JOIN services s ON s.service_id = o.service_id
  WHERE s.organisation_id = 1
  ORDER BY o.observed_at, o.observation_id
`).all() as Array<{
  observation_id: number;
  service_id: number;
  observed_at: string;
  route: string;
}>;
const noticesForObservation = db.prepare(`
  SELECT
    n.title,
    coalesce(p.detail_markdown, '') AS detail,
    n.disruption_reason AS disruptionReason
  FROM service_status_observation_notices n
  LEFT JOIN service_status_notice_payloads p ON p.payload_id = n.payload_id
  WHERE n.observation_id = ?
    AND n.source_notice_type = 'SAILING'
  ORDER BY n.display_order
`);
const previousByService = new Map<number, string>();
const scenarios: Array<{
  observationId: number;
  serviceId: number;
  route: string;
  observedAt: string;
  previousInfo: string;
  nextInfo: string;
}> = [];

for (const observation of observations) {
  const nextInfo = JSON.stringify(noticesForObservation.all(observation.observation_id));
  const previousInfo = previousByService.get(observation.service_id);
  if (previousInfo !== undefined && previousInfo !== nextInfo) {
    scenarios.push({
      observationId: observation.observation_id,
      serviceId: observation.service_id,
      route: observation.route,
      observedAt: observation.observed_at,
      previousInfo,
      nextInfo
    });
  }
  previousByService.set(observation.service_id, nextInfo);
}

for (const scenario of scenarios.slice(-scenarioLimit).reverse()) {
  let facts = "";
  const started = performance.now();
  const summary = await summariseInformationChange(scenario.previousInfo, scenario.nextInfo, {
    ollamaUrl,
    model,
    timeoutMs: 120000,
    fetchFn: (async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { prompt?: unknown };
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      facts = prompt.includes("Facts: ") ? prompt.split("Facts: ", 2)[1] : facts;
      return fetch(input, init);
    }) as typeof fetch
  });
  console.log({
    observationId: scenario.observationId,
    serviceId: scenario.serviceId,
    route: scenario.route,
    observedAt: scenario.observedAt,
    elapsedSeconds: ((performance.now() - started) / 1000).toFixed(2),
    facts,
    ...summary
  });
}
