import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type TestDatabase = {
  db: Database.Database;
  cleanup: () => void;
};

export function createTestDatabase(): TestDatabase {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ferry-services-v3-test-"));
  const databasePath = path.join(directory, "test.sqlite3");
  const db = new Database(databasePath);

  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync("sqlite/migrations/001_initial.sql", "utf8"));
  db.exec(fs.readFileSync("sqlite/seed.sql", "utf8"));

  return {
    db,
    cleanup: () => {
      db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}
