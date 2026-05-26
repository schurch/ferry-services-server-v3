ALTER TABLE vessels ADD COLUMN destination_name TEXT NULL;
ALTER TABLE vessels ADD COLUMN eta TEXT NULL;
ALTER TABLE vessels ADD COLUMN origin_name TEXT NULL;
ALTER TABLE vessels ADD COLUMN origin_departed_at TEXT NULL;
ALTER TABLE vessels ADD COLUMN arrival_name TEXT NULL;
ALTER TABLE vessels ADD COLUMN arrival_at TEXT NULL;
ALTER TABLE vessels ADD COLUMN progress REAL NULL;
