import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./database.js";
import { logger } from "../logger.js";

// #region Constants

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../../sqlite/migrations");
const seedPath = path.resolve(__dirname, "../../sqlite/seed.sql");

// #endregion

// #region Entrypoint

const db = openDatabase();
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

if (fs.existsSync(migrationsDir)) {
  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((row) => (row as { version: string }).version)
  );
  let shouldVacuum = false;

  for (const fileName of fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    if (applied.has(fileName)) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, fileName), "utf8");
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(fileName);
    });
    apply();
    if (fileName === "006_deduplicate_service_status_notice_payloads.sql") {
      shouldVacuum = true;
    }
    logger.info({ fileName }, "Applied migration");
  }

  if (shouldVacuum) {
    db.exec("VACUUM");
    logger.info("Vacuumed database after notice payload deduplication");
  }
}

const referenceData = db.prepare("SELECT COUNT(*) AS count FROM organisations").get() as { count: number };
if (referenceData.count === 0) {
  const seed = fs.readFileSync(seedPath, "utf8");
  db.exec(seed);
  logger.info("Loaded seed data");
}

db.close();

// #endregion
