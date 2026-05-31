import "dotenv/config";
import { openDatabase } from "../database.js";
import { generateAndWriteOfflineSnapshot } from "./snapshot.js";
import { logger } from "../logger.js";
const db = openDatabase();

try {
  const metadata = generateAndWriteOfflineSnapshot(db);
  logger.info({ dataVersion: metadata.data_version, validFrom: metadata.valid_from, validTo: metadata.valid_to }, "Offline snapshot ready");
} finally {
  db.close();
}
