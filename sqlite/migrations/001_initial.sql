CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organisations (
    organisation_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    website TEXT NULL,
    local_phone TEXT NULL,
    international_phone TEXT NULL,
    email TEXT NULL,
    x TEXT NULL,
    facebook TEXT NULL,
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
    service_id INTEGER PRIMARY KEY,
    area TEXT NOT NULL,
    route TEXT NOT NULL,
    status INTEGER NOT NULL,
    additional_info TEXT NULL,
    disruption_reason TEXT NULL,
    organisation_id INTEGER NOT NULL REFERENCES organisations (organisation_id),
    last_updated_date TEXT NULL,
    updated TEXT NOT NULL,
    visible INTEGER NOT NULL DEFAULT 1,
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS installations (
    installation_id TEXT PRIMARY KEY,
    device_token TEXT NOT NULL,
    device_type TEXT NOT NULL CHECK (device_type IN ('IOS', 'Android')),
    push_enabled INTEGER NOT NULL DEFAULT 1,
    last_push_success_at TEXT NULL,
    last_push_error_at TEXT NULL,
    last_push_error TEXT NULL,
    updated TEXT NOT NULL,
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS installation_services (
    installation_id TEXT NOT NULL REFERENCES installations (installation_id) ON DELETE CASCADE,
    service_id INTEGER NOT NULL REFERENCES services (service_id) ON DELETE CASCADE,
    PRIMARY KEY (installation_id, service_id)
);

CREATE TABLE IF NOT EXISTS locations (
    location_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    stop_point_id TEXT NULL UNIQUE,
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_locations (
    service_id INTEGER NOT NULL REFERENCES services (service_id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES locations (location_id) ON DELETE CASCADE,
    PRIMARY KEY (service_id, location_id)
);

CREATE TABLE IF NOT EXISTS location_weather (
    location_id INTEGER PRIMARY KEY REFERENCES locations (location_id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    icon TEXT NOT NULL,
    temperature REAL NOT NULL,
    wind_speed REAL NOT NULL,
    wind_direction REAL NOT NULL,
    updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vessels (
    mmsi INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    speed REAL NULL,
    course REAL NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    last_received TEXT NOT NULL,
    updated TEXT NOT NULL,
    organisation_id INTEGER NOT NULL REFERENCES organisations (organisation_id),
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rail_departures (
    departure_crs TEXT NOT NULL,
    departure_name TEXT NOT NULL,
    destination_crs TEXT NOT NULL,
    destination_name TEXT NOT NULL,
    scheduled_departure_time TEXT NOT NULL,
    estimated_departure_time TEXT NOT NULL,
    cancelled INTEGER NOT NULL,
    platform TEXT NULL,
    location_id INTEGER NOT NULL REFERENCES locations (location_id) ON DELETE CASCADE,
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (departure_crs, destination_crs, scheduled_departure_time)
);

CREATE TABLE IF NOT EXISTS timetable_documents (
    timetable_document_id INTEGER PRIMARY KEY AUTOINCREMENT,
    organisation_id INTEGER NOT NULL REFERENCES organisations (organisation_id),
    title TEXT NOT NULL,
    source_url TEXT NOT NULL UNIQUE,
    content_hash TEXT NULL,
    content_type TEXT NULL,
    content_length INTEGER NULL,
    last_seen_at TEXT NOT NULL,
    updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS timetable_document_services (
    timetable_document_id INTEGER NOT NULL REFERENCES timetable_documents (timetable_document_id) ON DELETE CASCADE,
    service_id INTEGER NOT NULL REFERENCES services (service_id),
    PRIMARY KEY (timetable_document_id, service_id)
);

CREATE TABLE IF NOT EXISTS transxchange_documents (
    document_id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path TEXT NOT NULL,
    source_file_name TEXT NOT NULL,
    source_version_key TEXT NOT NULL,
    source_creation_datetime TEXT NULL,
    source_modification_datetime TEXT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transxchange_stop_points (
    document_id INTEGER NOT NULL REFERENCES transxchange_documents (document_id) ON DELETE CASCADE,
    stop_point_ref TEXT NOT NULL,
    common_name TEXT NOT NULL,
    PRIMARY KEY (document_id, stop_point_ref)
);

CREATE TABLE IF NOT EXISTS transxchange_services (
    document_id INTEGER NOT NULL REFERENCES transxchange_documents (document_id) ON DELETE CASCADE,
    service_code TEXT NOT NULL,
    operator_ref TEXT NOT NULL,
    mode TEXT NOT NULL,
    description TEXT NOT NULL,
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    start_date TEXT NULL,
    end_date TEXT NULL,
    PRIMARY KEY (document_id, service_code)
);

CREATE TABLE IF NOT EXISTS transxchange_lines (
    document_id INTEGER NOT NULL REFERENCES transxchange_documents (document_id) ON DELETE CASCADE,
    line_id TEXT NOT NULL,
    service_code TEXT NOT NULL,
    line_name TEXT NOT NULL,
    PRIMARY KEY (document_id, line_id)
);

CREATE TABLE IF NOT EXISTS transxchange_journey_patterns (
    document_id INTEGER NOT NULL REFERENCES transxchange_documents (document_id) ON DELETE CASCADE,
    journey_pattern_id TEXT NOT NULL,
    service_code TEXT NOT NULL,
    direction TEXT NOT NULL,
    PRIMARY KEY (document_id, journey_pattern_id)
);

CREATE TABLE IF NOT EXISTS transxchange_journey_pattern_sections (
    document_id INTEGER NOT NULL REFERENCES transxchange_documents (document_id) ON DELETE CASCADE,
    journey_pattern_id TEXT NOT NULL,
    section_ref TEXT NOT NULL,
    section_order INTEGER NOT NULL,
    PRIMARY KEY (document_id, journey_pattern_id, section_order)
);

CREATE TABLE IF NOT EXISTS transxchange_journey_pattern_timing_links (
    document_id INTEGER NOT NULL REFERENCES transxchange_documents (document_id) ON DELETE CASCADE,
    journey_pattern_timing_link_id TEXT NOT NULL,
    journey_pattern_section_ref TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    from_stop_point_ref TEXT NOT NULL,
    from_activity TEXT NOT NULL,
    from_timing_status TEXT NOT NULL,
    to_stop_point_ref TEXT NOT NULL,
    to_activity TEXT NOT NULL,
    to_timing_status TEXT NOT NULL,
    route_link_ref TEXT NOT NULL,
    direction TEXT NOT NULL,
    run_seconds INTEGER NOT NULL,
    from_wait_seconds INTEGER NOT NULL,
    PRIMARY KEY (document_id, journey_pattern_timing_link_id)
);

CREATE TABLE IF NOT EXISTS transxchange_vehicle_journeys (
    document_id INTEGER NOT NULL REFERENCES transxchange_documents (document_id) ON DELETE CASCADE,
    vehicle_journey_code TEXT NOT NULL,
    service_code TEXT NOT NULL,
    line_id TEXT NOT NULL,
    journey_pattern_id TEXT NOT NULL,
    operator_ref TEXT NOT NULL,
    departure_time TEXT NOT NULL,
    note TEXT NOT NULL,
    note_code TEXT NOT NULL,
    PRIMARY KEY (document_id, vehicle_journey_code)
);

CREATE TABLE IF NOT EXISTS transxchange_vehicle_journey_timing_links (
    document_id INTEGER NOT NULL REFERENCES transxchange_documents (document_id) ON DELETE CASCADE,
    vehicle_journey_code TEXT NOT NULL,
    journey_pattern_timing_link_id TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    PRIMARY KEY (document_id, vehicle_journey_code, sort_order)
);

CREATE TABLE IF NOT EXISTS transxchange_vehicle_journey_days (
    document_id INTEGER NOT NULL REFERENCES transxchange_documents (document_id) ON DELETE CASCADE,
    vehicle_journey_code TEXT NOT NULL,
    day_rule TEXT NOT NULL,
    PRIMARY KEY (document_id, vehicle_journey_code, day_rule)
);

CREATE TABLE IF NOT EXISTS transxchange_vehicle_journey_week_of_month_rules (
    document_id INTEGER NOT NULL REFERENCES transxchange_documents (document_id) ON DELETE CASCADE,
    vehicle_journey_code TEXT NOT NULL,
    week_of_month_rule TEXT NOT NULL,
    PRIMARY KEY (document_id, vehicle_journey_code, week_of_month_rule)
);

CREATE TABLE IF NOT EXISTS transxchange_vehicle_journey_date_ranges (
    document_id INTEGER NOT NULL REFERENCES transxchange_documents (document_id) ON DELETE CASCADE,
    vehicle_journey_code TEXT NOT NULL,
    range_type TEXT NOT NULL CHECK (range_type IN ('days_of_operation', 'days_of_non_operation', 'serviced_organisation_days_of_operation', 'serviced_organisation_days_of_non_operation')),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    PRIMARY KEY (document_id, vehicle_journey_code, range_type, start_date, end_date)
);

CREATE TABLE IF NOT EXISTS transxchange_vehicle_journey_bank_holiday_rules (
    document_id INTEGER NOT NULL REFERENCES transxchange_documents (document_id) ON DELETE CASCADE,
    vehicle_journey_code TEXT NOT NULL,
    rule_type TEXT NOT NULL CHECK (rule_type IN ('operation', 'non_operation')),
    bank_holiday_rule TEXT NOT NULL,
    PRIMARY KEY (document_id, vehicle_journey_code, rule_type, bank_holiday_rule)
);

CREATE TABLE IF NOT EXISTS transxchange_service_mappings (
    service_id INTEGER NOT NULL REFERENCES services (service_id) ON DELETE CASCADE,
    service_code TEXT NOT NULL,
    PRIMARY KEY (service_id, service_code)
);

CREATE INDEX IF NOT EXISTS services_organisation_id_idx ON services (organisation_id);
CREATE INDEX IF NOT EXISTS services_visible_idx ON services (visible);
CREATE INDEX IF NOT EXISTS installations_device_type_idx ON installations (device_type);
CREATE INDEX IF NOT EXISTS installations_push_enabled_idx ON installations (push_enabled);
CREATE INDEX IF NOT EXISTS installation_services_service_id_idx ON installation_services (service_id);
CREATE INDEX IF NOT EXISTS service_locations_location_id_idx ON service_locations (location_id);
CREATE INDEX IF NOT EXISTS vessels_organisation_id_idx ON vessels (organisation_id);
CREATE INDEX IF NOT EXISTS rail_departures_location_id_idx ON rail_departures (location_id);
CREATE INDEX IF NOT EXISTS rail_departures_created_idx ON rail_departures (created);
CREATE INDEX IF NOT EXISTS timetable_documents_organisation_id_idx ON timetable_documents (organisation_id);
CREATE INDEX IF NOT EXISTS timetable_document_services_service_id_idx ON timetable_document_services (service_id);
CREATE INDEX IF NOT EXISTS transxchange_services_service_code_idx ON transxchange_services (service_code);
CREATE INDEX IF NOT EXISTS transxchange_services_mode_idx ON transxchange_services (mode);
CREATE INDEX IF NOT EXISTS transxchange_timing_links_from_to_idx ON transxchange_journey_pattern_timing_links (from_stop_point_ref, to_stop_point_ref);
CREATE INDEX IF NOT EXISTS transxchange_vehicle_journeys_service_code_idx ON transxchange_vehicle_journeys (service_code);
CREATE INDEX IF NOT EXISTS transxchange_service_mappings_service_code_idx ON transxchange_service_mappings (service_code);
