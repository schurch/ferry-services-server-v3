import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { generateAndWriteOfflineSnapshot } from "../src/offline/snapshot.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

let currentDb: TestDatabase | null = null;

afterEach(() => {
  currentDb?.cleanup();
  currentDb = null;
});

describe("offline snapshot", () => {
  it("writes a client-queryable SQLite database with stable metadata", () => {
    currentDb = createTestDatabase();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ferry-services-v3-snapshot-"));
    const snapshotPath = path.join(directory, "snapshot.sqlite3");
    const metadataPath = path.join(directory, "snapshot.meta.json");

    try {
      const metadata = generateAndWriteOfflineSnapshot(currentDb.db, snapshotPath, metadataPath);
      assert.match(metadata.data_version, /^sha256-/);
      assert.equal(metadata.etag, `"${metadata.data_version}"`);

      const snapshotDb = new Database(snapshotPath, { readonly: true });
      try {
        const views = snapshotDb.prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'view'
          ORDER BY name
        `).all().map((row) => (row as { name: string }).name);
        const schemaVersion = snapshotDb.prepare(`
          SELECT value FROM metadata WHERE key = 'schema_version'
        `).pluck().get();

        assert.deepEqual(
          ["client_departures", "client_service_locations", "client_services"].every((view) => views.includes(view)),
          true
        );
        assert.equal(schemaVersion, "1");
      } finally {
        snapshotDb.close();
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
