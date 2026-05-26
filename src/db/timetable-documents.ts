import type Database from "better-sqlite3";
import type { ScrapedTimetableDocument } from "../types/fetchers.js";

type ExistingDocumentRow = {
  timetable_document_id: number;
  source_url: string;
};

export function saveTimetableDocuments(db: Database.Database, documents: ScrapedTimetableDocument[]): void {
  const upsertDocument = db.prepare(`
    INSERT INTO timetable_documents (
      organisation_id,
      title,
      source_url,
      content_hash,
      content_type,
      content_length,
      last_seen_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (source_url) DO UPDATE
      SET organisation_id = excluded.organisation_id,
          title = excluded.title,
          content_hash = excluded.content_hash,
          content_type = excluded.content_type,
          content_length = excluded.content_length,
          last_seen_at = excluded.last_seen_at,
          updated = CURRENT_TIMESTAMP
    RETURNING timetable_document_id
  `);
  const deleteLinks = db.prepare("DELETE FROM timetable_document_services WHERE timetable_document_id = ?");
  const insertLink = db.prepare(`
    INSERT INTO timetable_document_services (timetable_document_id, service_id)
    VALUES (?, ?)
    ON CONFLICT DO NOTHING
  `);
  const listExisting = db.prepare(`
    SELECT timetable_document_id, source_url
    FROM timetable_documents
    WHERE organisation_id = ?
  `);
  const deleteDocument = db.prepare("DELETE FROM timetable_documents WHERE timetable_document_id = ?");

  const transaction = db.transaction((items: ScrapedTimetableDocument[]) => {
    for (const document of items) {
      const row = upsertDocument.get(
        document.organisationId,
        document.title,
        document.sourceUrl,
        document.contentHash ?? null,
        document.contentType ?? null,
        document.contentLength ?? null,
        document.lastSeenAt
      ) as { timetable_document_id: number } | undefined;

      if (!row) {
        continue;
      }

      deleteLinks.run(row.timetable_document_id);
      for (const serviceId of document.serviceIds) {
        insertLink.run(row.timetable_document_id, serviceId);
      }
    }

    for (const organisationId of new Set(items.map((document) => document.organisationId))) {
      const currentSourceUrls = new Set(
        items
          .filter((document) => document.organisationId === organisationId)
          .map((document) => document.sourceUrl)
      );
      const existing = listExisting.all(organisationId) as ExistingDocumentRow[];
      for (const document of existing) {
        if (!currentSourceUrls.has(document.source_url)) {
          deleteDocument.run(document.timetable_document_id);
        }
      }
    }
  });

  transaction(documents);
}
