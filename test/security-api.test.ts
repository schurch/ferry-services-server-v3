import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/api/app.js";
import { deleteStaleInstallations } from "../src/db/installations.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

let currentDb: TestDatabase | null = null;
let currentApp: FastifyInstance | null = null;

afterEach(async () => {
  await currentApp?.close();
  currentApp = null;
  currentDb?.cleanup();
  currentDb = null;
});

describe("API security hardening", () => {
  it("rejects installation registrations with oversized device tokens", async () => {
    currentDb = createTestDatabase();
    currentApp = await buildApp({ db: currentDb.db });
    const app = currentApp;
    assert.notEqual(app, null);

    const response = await app.inject({
      method: "POST",
      url: `/api/installations/${installationId(1)}`,
      payload: {
        device_token: "a".repeat(513),
        device_type: "IOS"
      }
    });

    assert.equal(response.statusCode, 400);
  });

  it("blocks duplicate installation churn for the same client and device token", async () => {
    currentDb = createTestDatabase();
    currentApp = await buildApp({ db: currentDb.db });
    const app = currentApp;
    assert.notEqual(app, null);
    const deviceToken = `token-${"b".repeat(58)}`;

    const first = await app.inject({
      method: "POST",
      url: `/api/installations/${installationId(1)}`,
      payload: {
        device_token: deviceToken,
        device_type: "IOS"
      }
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/installations/${installationId(2)}`,
      payload: {
        device_token: deviceToken,
        device_type: "IOS"
      }
    });

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 429);
    assert.match(second.body, /Duplicate installation churn/i);
  });

  it("rate limits repeated installation registrations from one client", async () => {
    currentDb = createTestDatabase();
    currentApp = await buildApp({ db: currentDb.db });
    const app = currentApp;
    assert.notEqual(app, null);

    for (let index = 0; index < 20; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: `/api/installations/${installationId(index + 1)}`,
        payload: {
          device_token: `token-${String(index).padStart(3, "0")}-${"c".repeat(52)}`,
          device_type: "Android"
        }
      });
      assert.equal(response.statusCode, 200);
    }

    const limited = await app.inject({
      method: "POST",
      url: `/api/installations/${installationId(99)}`,
      payload: {
        device_token: `token-099-${"d".repeat(52)}`,
        device_type: "Android"
      }
    });

    assert.equal(limited.statusCode, 429);
    assert.match(limited.body, /Too many installation registration requests/i);
  });
});

describe("installation retention", () => {
  it("deletes stale installations and old registration attempts", () => {
    currentDb = createTestDatabase();
    const now = new Date("2026-05-16T00:00:00.000Z");

    currentDb.db.prepare(`
      INSERT INTO installations (installation_id, device_token, device_type, updated)
      VALUES (?, ?, ?, ?), (?, ?, ?, ?)
    `).run(
      installationId(10), "fresh-token", "IOS", "2026-05-01T00:00:00.000Z",
      installationId(11), "stale-token", "IOS", "2025-12-01T00:00:00.000Z"
    );
    currentDb.db.prepare(`
      INSERT INTO installation_registration_attempts (client_ip, device_token_sha256, installation_id, created)
      VALUES (?, ?, ?, ?), (?, ?, ?, ?)
    `).run(
      "127.0.0.1", "fresh", installationId(10), "2026-05-15T00:00:00.000Z",
      "127.0.0.1", "stale", installationId(11), "2026-05-01T00:00:00.000Z"
    );

    const deleted = deleteStaleInstallations(currentDb.db, now, 90, 7);
    const installations = currentDb.db.prepare("SELECT installation_id FROM installations ORDER BY installation_id").all() as Array<{ installation_id: string }>;
    const attempts = currentDb.db.prepare("SELECT device_token_sha256 FROM installation_registration_attempts ORDER BY device_token_sha256").all() as Array<{ device_token_sha256: string }>;

    assert.deepEqual(deleted, { deletedInstallations: 1, deletedAttempts: 1 });
    assert.deepEqual(installations.map((row) => row.installation_id), [installationId(10)]);
    assert.deepEqual(attempts.map((row) => row.device_token_sha256), ["fresh"]);
  });
});

function installationId(seed: number): string {
  return `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}
