import type Database from "better-sqlite3";
import type { ScrapedService } from "./types.js";
import type { ServiceStatus } from "../../api/types.js";
import { calMacNotificationInfo } from "./notification-info.js";

export function listServiceIdsForOrganisation(db: Database.Database, organisationId: number): number[] {
  return (db.prepare(`
    SELECT service_id
    FROM services
    WHERE organisation_id = ?
    ORDER BY service_id
  `).all(organisationId) as Array<{ service_id: number }>).map((row) => row.service_id);
}

export function listServicesById(db: Database.Database, serviceIds: number[]): Map<number, ScrapedService> {
  if (serviceIds.length === 0) {
    return new Map();
  }

  const rows = db.prepare(`
    SELECT service_id, area, route, status, additional_info, disruption_reason, organisation_id, last_updated_date, updated
    FROM services
    WHERE service_id = ?
  `);

  return new Map(serviceIds.flatMap((serviceId) => {
    const row = rows.get(serviceId) as {
      service_id: number;
      area: string;
      route: string;
      status: ServiceStatus;
      additional_info: string | null;
      disruption_reason: string | null;
      organisation_id: number;
      last_updated_date: string | null;
      updated: string;
    } | undefined;

    return row
      ? [[row.service_id, {
        serviceId: row.service_id,
        area: row.area,
        route: row.route,
        status: row.status,
        additionalInfo: row.additional_info ?? undefined,
        notificationInfo: notificationInfo(db, row.service_id, row.organisation_id, row.additional_info),
        disruptionReason: row.disruption_reason ?? undefined,
        organisationId: row.organisation_id,
        lastUpdatedDate: row.last_updated_date ?? undefined,
        updated: row.updated
      }]]
      : [];
  }));
}

function notificationInfo(
  db: Database.Database,
  serviceId: number,
  organisationId: number,
  additionalInfo: string | null
): string | undefined {
  if (organisationId === 1) {
    return storedCalMacNotificationInfo(db, serviceId);
  }
  return [3, 6].includes(organisationId) ? additionalInfo ?? undefined : undefined;
}

function storedCalMacNotificationInfo(db: Database.Database, serviceId: number): string | undefined {
  const observation = db.prepare(`
    SELECT observation_id
    FROM service_status_observations
    WHERE service_id = ?
    ORDER BY observed_at DESC, observation_id DESC
    LIMIT 1
  `).get(serviceId) as { observation_id: number } | undefined;
  if (!observation) {
    return undefined;
  }

  const notices = db.prepare(`
    SELECT n.title, p.detail_markdown, n.disruption_reason
    FROM service_status_observation_notices n
    LEFT JOIN service_status_notice_payloads p ON p.payload_id = n.payload_id
    WHERE n.observation_id = ?
      AND n.source_notice_type = 'SAILING'
    ORDER BY n.display_order
  `).all(observation.observation_id) as Array<{
    title: string;
    detail_markdown: string | null;
    disruption_reason: string | null;
  }>;

  return calMacNotificationInfo(notices.map((notice) => ({
    title: notice.title,
    detail: notice.detail_markdown ?? "",
    disruptionReason: notice.disruption_reason
  })));
}

export function saveServices(db: Database.Database, services: ScrapedService[]): void {
  const save = db.prepare(`
    INSERT INTO services (service_id, area, route, status, additional_info, disruption_reason, organisation_id, last_updated_date, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (service_id) DO UPDATE
      SET area = excluded.area,
          route = excluded.route,
          status = excluded.status,
          additional_info = excluded.additional_info,
          disruption_reason = excluded.disruption_reason,
          organisation_id = excluded.organisation_id,
          last_updated_date = excluded.last_updated_date,
          updated = excluded.updated,
          visible = 1
  `);

  const transaction = db.transaction((items: ScrapedService[]) => {
    for (const service of items) {
      save.run(
        service.serviceId,
        service.area,
        service.route,
        service.status,
        service.additionalInfo ?? null,
        service.disruptionReason ?? null,
        service.organisationId,
        service.lastUpdatedDate ?? null,
        service.updated
      );
    }
  });

  transaction(services);
}

export function startServiceScrapeRun(
  db: Database.Database,
  input: {
    operatorName: string;
    organisationId?: number;
    sourceName: string;
    startedAt?: string;
  }
): number {
  const result = db.prepare(`
    INSERT INTO service_scrape_runs (operator_name, organisation_id, source_name, started_at)
    VALUES (?, ?, ?, ?)
  `).run(input.operatorName, input.organisationId ?? null, input.sourceName, input.startedAt ?? nowSql());

  return Number(result.lastInsertRowid);
}

export function finishServiceScrapeRun(
  db: Database.Database,
  scrapeRunId: number,
  input: {
    success: boolean;
    error?: string;
    completedAt?: string;
  }
): void {
  db.prepare(`
    UPDATE service_scrape_runs
    SET success = ?,
        error = ?,
        completed_at = ?
    WHERE scrape_run_id = ?
  `).run(input.success ? 1 : 0, input.error ?? null, input.completedAt ?? nowSql(), scrapeRunId);
}

export function saveServiceStatusObservations(
  db: Database.Database,
  scrapeRunId: number,
  services: ScrapedService[],
  observedAt = nowSql()
): void {
  const saveObservation = db.prepare(`
    INSERT INTO service_status_observations (
      scrape_run_id,
      service_id,
      observed_at,
      source_service_id,
      source_service_code,
      source_area_id,
      source_area_name,
      source_area_latitude,
      source_area_longitude,
      status,
      source_status,
      disruption_reason,
      last_updated_date
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const saveNotice = db.prepare(`
    INSERT INTO service_status_observation_notices (
      observation_id,
      source_notice_key,
      source_notice_type,
      title,
      disruption_reason,
      payload_id,
      display_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const savePayload = db.prepare(`
    INSERT OR IGNORE INTO service_status_notice_payloads (
      detail_text,
      detail_markdown
    )
    VALUES (?, ?)
  `);
  const findPayload = db.prepare(`
    SELECT payload_id
    FROM service_status_notice_payloads
    WHERE coalesce(detail_text, '') = coalesce(?, '')
      AND coalesce(detail_markdown, '') = coalesce(?, '')
  `);

  const transaction = db.transaction((items: ScrapedService[]) => {
    for (const service of items) {
      const notices = service.notices ?? [];
      const result = saveObservation.run(
        scrapeRunId,
        service.serviceId,
        observedAt,
        service.sourceServiceId ?? null,
        service.sourceServiceCode ?? null,
        service.sourceAreaId ?? null,
        service.sourceAreaName ?? null,
        service.sourceAreaLatitude ?? null,
        service.sourceAreaLongitude ?? null,
        service.status,
        service.sourceStatus ?? null,
        service.disruptionReason ?? null,
        service.lastUpdatedDate ?? null
      );
      const observationId = Number(result.lastInsertRowid);

      notices.forEach((notice, index) => {
        const detailText = notice.detailText ?? null;
        const detailMarkdown = notice.detailMarkdown ?? null;
        let payloadId: number | null = null;
        if (detailText !== null || detailMarkdown !== null) {
          savePayload.run(detailText, detailMarkdown);
          const payload = findPayload.get(detailText, detailMarkdown) as { payload_id: number };
          payloadId = payload.payload_id;
        }

        saveNotice.run(
          observationId,
          notice.sourceNoticeKey ?? `${service.serviceId}:${index}`,
          notice.sourceNoticeType ?? null,
          notice.title,
          notice.disruptionReason ?? null,
          payloadId,
          index
        );
      });
    }
  });

  transaction(services);
}

export function saveServiceReliabilityDays(
  db: Database.Database,
  services: Array<{
    serviceId: number;
    status: ServiceStatus;
    scheduledSailings: number;
  }>,
  observedAt = nowSql()
): void {
  const observedDate = dateString(observedAt);
  const save = db.prepare(`
    INSERT INTO service_reliability_days (
      service_id,
      observed_date,
      status,
      scheduled_sailings,
      first_observed_at,
      last_observed_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (service_id, observed_date) DO UPDATE
      SET status = max(service_reliability_days.status, excluded.status),
          scheduled_sailings = max(service_reliability_days.scheduled_sailings, excluded.scheduled_sailings),
          first_observed_at = min(service_reliability_days.first_observed_at, excluded.first_observed_at),
          last_observed_at = max(service_reliability_days.last_observed_at, excluded.last_observed_at),
          updated_at = CURRENT_TIMESTAMP
  `);

  const transaction = db.transaction((items: typeof services) => {
    for (const service of items) {
      if (service.status !== 0 && service.status !== 1 && service.status !== 2) {
        continue;
      }

      save.run(
        service.serviceId,
        observedDate,
        service.status,
        service.scheduledSailings,
        observedAt,
        observedAt
      );
    }
  });

  transaction(services);
}

export function hideServices(db: Database.Database, serviceIds: number[]): void {
  const hide = db.prepare("UPDATE services SET visible = 0 WHERE service_id = ?");
  const transaction = db.transaction((ids: number[]) => {
    for (const serviceId of ids) {
      hide.run(serviceId);
    }
  });
  transaction(serviceIds);
}

function nowSql(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function dateString(value: string): string {
  return value.slice(0, 10);
}
