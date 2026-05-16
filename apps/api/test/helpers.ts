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
  const migrationsDirectory = path.resolve("sqlite/migrations");

  db.pragma("foreign_keys = ON");
  for (const fileName of fs.readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDirectory, fileName), "utf8"));
  }
  db.exec(fs.readFileSync("sqlite/seed.sql", "utf8"));

  return {
    db,
    cleanup: () => {
      db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}
