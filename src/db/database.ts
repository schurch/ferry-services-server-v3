import Database from "better-sqlite3";
import { config } from "../config/config.js";

export function openDatabase(path = config.databasePath): Database.Database {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  return db;
}

