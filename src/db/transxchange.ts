import type Database from "better-sqlite3";
import type { TransxchangeDocument } from "../types/transxchange.js";

export function replaceTransxchangeData(db: Database.Database, documents: TransxchangeDocument[]): void {
  const insertDocument = db.prepare(`
    INSERT INTO transxchange_documents (
      source_path,
      source_file_name,
      source_version_key,
      source_creation_datetime,
      source_modification_datetime
    )
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertStopPoint = db.prepare(`
    INSERT INTO transxchange_stop_points (document_id, stop_point_ref, common_name)
    VALUES (?, ?, ?)
  `);
  const insertService = db.prepare(`
    INSERT INTO transxchange_services (
      document_id, service_code, operator_ref, mode, description, origin, destination, start_date, end_date
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertLine = db.prepare(`
    INSERT INTO transxchange_lines (document_id, line_id, service_code, line_name)
    VALUES (?, ?, ?, ?)
  `);
  const insertJourneyPattern = db.prepare(`
    INSERT INTO transxchange_journey_patterns (document_id, journey_pattern_id, service_code, direction)
    VALUES (?, ?, ?, ?)
  `);
  const insertJourneyPatternSection = db.prepare(`
    INSERT INTO transxchange_journey_pattern_sections (document_id, journey_pattern_id, section_ref, section_order)
    VALUES (?, ?, ?, ?)
  `);
  const insertTimingLink = db.prepare(`
    INSERT INTO transxchange_journey_pattern_timing_links (
      document_id,
      journey_pattern_timing_link_id,
      journey_pattern_section_ref,
      sort_order,
      from_stop_point_ref,
      from_activity,
      from_timing_status,
      to_stop_point_ref,
      to_activity,
      to_timing_status,
      route_link_ref,
      direction,
      run_seconds,
      from_wait_seconds
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertVehicleJourney = db.prepare(`
    INSERT INTO transxchange_vehicle_journeys (
      document_id,
      vehicle_journey_code,
      service_code,
      line_id,
      journey_pattern_id,
      operator_ref,
      departure_time,
      note,
      note_code
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertVehicleJourneyTimingLink = db.prepare(`
    INSERT INTO transxchange_vehicle_journey_timing_links (
      document_id, vehicle_journey_code, journey_pattern_timing_link_id, sort_order
    )
    VALUES (?, ?, ?, ?)
  `);
  const insertVehicleJourneyDay = db.prepare(`
    INSERT INTO transxchange_vehicle_journey_days (document_id, vehicle_journey_code, day_rule)
    VALUES (?, ?, ?)
  `);
  const insertWeekOfMonthRule = db.prepare(`
    INSERT INTO transxchange_vehicle_journey_week_of_month_rules (document_id, vehicle_journey_code, week_of_month_rule)
    VALUES (?, ?, ?)
  `);
  const insertDateRange = db.prepare(`
    INSERT INTO transxchange_vehicle_journey_date_ranges (
      document_id, vehicle_journey_code, range_type, start_date, end_date
    )
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertBankHolidayRule = db.prepare(`
    INSERT INTO transxchange_vehicle_journey_bank_holiday_rules (
      document_id, vehicle_journey_code, rule_type, bank_holiday_rule
    )
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction((items: TransxchangeDocument[]) => {
    db.prepare("DELETE FROM transxchange_documents").run();

    for (const document of items) {
      const result = insertDocument.run(
        document.sourcePath,
        document.sourceFileName,
        document.sourceVersionKey,
        document.sourceCreationDateTime ?? null,
        document.sourceModificationDateTime ?? null
      );
      const documentId = Number(result.lastInsertRowid);

      for (const stopPoint of document.stopPoints) {
        insertStopPoint.run(documentId, stopPoint.stopPointRef, stopPoint.commonName);
      }
      for (const service of document.services) {
        insertService.run(
          documentId,
          service.serviceCode,
          service.operatorRef,
          service.mode,
          service.description,
          service.origin,
          service.destination,
          service.startDate ?? null,
          service.endDate ?? null
        );
      }
      for (const line of document.lines) {
        insertLine.run(documentId, line.lineId, line.serviceCode, line.lineName);
      }
      for (const pattern of document.journeyPatterns) {
        insertJourneyPattern.run(documentId, pattern.journeyPatternId, pattern.serviceCode, pattern.direction);
      }
      for (const section of document.journeyPatternSections) {
        insertJourneyPatternSection.run(documentId, section.journeyPatternId, section.sectionRef, section.sectionOrder);
      }
      for (const link of document.journeyPatternTimingLinks) {
        insertTimingLink.run(
          documentId,
          link.journeyPatternTimingLinkId,
          link.journeyPatternSectionRef,
          link.sortOrder,
          link.fromStopPointRef,
          link.fromActivity,
          link.fromTimingStatus,
          link.toStopPointRef,
          link.toActivity,
          link.toTimingStatus,
          link.routeLinkRef,
          link.direction,
          link.runSeconds,
          link.fromWaitSeconds
        );
      }
      for (const journey of document.vehicleJourneys) {
        insertVehicleJourney.run(
          documentId,
          journey.vehicleJourneyCode,
          journey.serviceCode,
          journey.lineId,
          journey.journeyPatternId,
          journey.operatorRef,
          journey.departureTime,
          journey.note,
          journey.noteCode
        );
        journey.timingLinkRefs.forEach((timingLinkRef, index) => {
          insertVehicleJourneyTimingLink.run(documentId, journey.vehicleJourneyCode, timingLinkRef, index + 1);
        });
        journey.dayRules.forEach((dayRule) => {
          insertVehicleJourneyDay.run(documentId, journey.vehicleJourneyCode, dayRule);
        });
        journey.weekOfMonthRules.forEach((rule) => {
          insertWeekOfMonthRule.run(documentId, journey.vehicleJourneyCode, rule);
        });
        for (const range of journey.servicedOrganisationDaysOfOperation) {
          insertDateRange.run(documentId, journey.vehicleJourneyCode, "serviced_organisation_days_of_operation", range.startDate, range.endDate);
        }
        for (const range of journey.servicedOrganisationDaysOfNonOperation) {
          insertDateRange.run(documentId, journey.vehicleJourneyCode, "serviced_organisation_days_of_non_operation", range.startDate, range.endDate);
        }
        for (const range of journey.daysOfOperation) {
          insertDateRange.run(documentId, journey.vehicleJourneyCode, "days_of_operation", range.startDate, range.endDate);
        }
        for (const range of journey.daysOfNonOperation) {
          insertDateRange.run(documentId, journey.vehicleJourneyCode, "days_of_non_operation", range.startDate, range.endDate);
        }
        journey.bankHolidayOperationRules.forEach((rule) => {
          insertBankHolidayRule.run(documentId, journey.vehicleJourneyCode, "operation", rule);
        });
        journey.bankHolidayNonOperationRules.forEach((rule) => {
          insertBankHolidayRule.run(documentId, journey.vehicleJourneyCode, "non_operation", rule);
        });
      }
    }
  });

  transaction(documents);
}
