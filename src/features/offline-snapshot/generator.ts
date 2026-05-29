import "dotenv/config";
import { openDatabase } from "../../shared/database.js";
import { generateAndWriteOfflineSnapshot } from "./snapshot.js";
import { logger } from "../../shared/logger.js";
const db = openDatabase();

try {
  const metadata = generateAndWriteOfflineSnapshot(db);
  logger.info({ dataVersion: metadata.data_version, validFrom: metadata.valid_from, validTo: metadata.valid_to }, "Offline snapshot ready");
} finally {
  db.close();
}
