import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config/config.js";

export function openDatabase(databasePath = config.databasePath): Database.Database {
  if (databasePath !== ":memory:") {
    const parentDir = path.dirname(databasePath);
    if (parentDir !== ".") {
      fs.mkdirSync(parentDir, { recursive: true });
    }
  }

  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  return db;
}
