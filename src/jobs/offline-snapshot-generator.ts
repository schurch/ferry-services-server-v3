import "dotenv/config";
import { openDatabase } from "../db/database.js";
import { generateAndWriteOfflineSnapshot } from "../offline/snapshot.js";

const db = openDatabase();

try {
  const metadata = generateAndWriteOfflineSnapshot(db);
  console.log(`Offline snapshot ready: ${metadata.data_version}, valid ${metadata.valid_from} to ${metadata.valid_to}`);
} finally {
  db.close();
}
