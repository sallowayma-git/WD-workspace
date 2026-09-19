-- Customer feedback round 1: student display labels and archive metadata.
-- The two seed rows are deliberately stable so student rows can safely refer
-- to them across desktop/browser databases and exports.
CREATE TABLE student_status_label (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    color TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO student_status_label(id, label, color, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000001', '紧急', '#ff4d4f', 1),
  ('00000000-0000-0000-0000-000000000002', '不紧急', NULL, 2);

-- The migration is applied after v3 on existing installations, while the
-- browser database applies all migrations to a new database.  v1-v3 do not
-- contain any of these columns, so adding them here is safe in both paths.
ALTER TABLE student ADD COLUMN status_label_id TEXT
    REFERENCES student_status_label(id) ON DELETE SET NULL;
ALTER TABLE student ADD COLUMN exam_date TEXT;
ALTER TABLE student ADD COLUMN archived_at TEXT;
ALTER TABLE student ADD COLUMN archive_snapshot_json TEXT;

CREATE INDEX idx_student_exam_date ON student(exam_date);
CREATE INDEX idx_student_status_label ON student(status_label_id);
