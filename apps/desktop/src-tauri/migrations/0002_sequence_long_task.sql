-- SEQUENCE long-task model (Long Task / Sequence Model v1).
--
-- Adds a second generation mode next to the ITEMIZED template course model:
--   SEQUENCE  一天一句长难句 Day {n}  — title pattern + ordinal, no version/item
--   ITEMIZED  legacy per-item courses (Excel import), unchanged behaviour
--
-- A SEQUENCE track carries a snapshot of the definition (name + title pattern)
-- so later definition edits never rewrite already-mounted students' titles.
-- end_ordinal becomes nullable: an open-ended track never auto-completes.
-- A TRACK task_instance now needs track_id + item_ordinal only; the
-- template_item_id requirement applies to ITEMIZED tracks.
--
-- SQLite cannot drop NOT NULL or rewrite CHECK constraints in place, so
-- student_task_track and task_instance are rebuilt. Statement order keeps the
-- rebuild valid with PRAGMA foreign_keys=ON (node:sqlite and sqlx both enable
-- it): task_instance is the only table referencing student_task_track, so its
-- rows move to a plain (constraint-free) backup table first.

ALTER TABLE task_template ADD COLUMN generation_mode TEXT NOT NULL DEFAULT 'ITEMIZED';
ALTER TABLE task_template ADD COLUMN normalized_key TEXT;
ALTER TABLE task_template ADD COLUMN title_pattern TEXT;
ALTER TABLE task_template ADD COLUMN default_start_ordinal INTEGER NOT NULL DEFAULT 1;
ALTER TABLE task_template ADD COLUMN sequence_end_ordinal INTEGER;

CREATE INDEX ix_task_template_sequence_lookup
    ON task_template (generation_mode, status, normalized_key);

-- ---------------------------------------------------------------------------
-- task_instance: relax the TRACK source constraint (template_item_id becomes
-- ITEMIZED-only), preserving all rows.
-- ---------------------------------------------------------------------------

CREATE TABLE task_instance_backup AS
    SELECT * FROM task_instance;

DROP TABLE task_instance;

-- Build and populate the replacement parent before restoring task rows. The
-- temporary task table below points at this replacement, so dropping the old
-- parent cannot execute ON DELETE SET NULL against existing TRACK tasks.
CREATE TABLE student_task_track_migrated (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES student(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL REFERENCES task_template(id),
    template_version_id TEXT REFERENCES task_template_version(id),
    generation_mode TEXT NOT NULL DEFAULT 'ITEMIZED'
        CHECK (generation_mode IN ('ITEMIZED', 'SEQUENCE')),
    status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('NOT_STARTED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')),
    start_ordinal INTEGER NOT NULL CHECK (start_ordinal >= 1),
    current_ordinal INTEGER NOT NULL CHECK (current_ordinal >= 1),
    end_ordinal INTEGER
        CHECK (end_ordinal IS NULL OR end_ordinal >= start_ordinal),
    default_units_per_session INTEGER NOT NULL DEFAULT 1 CHECK (default_units_per_session >= 1),
    start_date TEXT NOT NULL,
    next_candidate_date TEXT,
    definition_name_snapshot TEXT,
    title_pattern_snapshot TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    allow_parallel_items INTEGER NOT NULL DEFAULT 0 CHECK (allow_parallel_items IN (0, 1)),
    scheduling_policy TEXT,
    duration_override_minutes INTEGER,
    device_policy_override TEXT
        CHECK (device_policy_override IS NULL OR device_policy_override IN ('ALLOWED', 'NOT_ALLOWED', 'CONFIRM')),
    note TEXT,
    completed_at TEXT,
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (current_ordinal >= start_ordinal),
    CHECK (end_ordinal IS NULL OR current_ordinal <= end_ordinal + 1),
    CHECK (generation_mode <> 'SEQUENCE' OR title_pattern_snapshot IS NOT NULL),
    CHECK (generation_mode <> 'SEQUENCE' OR template_version_id IS NULL),
    CHECK (generation_mode <> 'ITEMIZED' OR template_version_id IS NOT NULL)
);

INSERT INTO student_task_track_migrated (
    id, student_id, template_id, template_version_id, generation_mode,
    status, start_ordinal, current_ordinal, end_ordinal,
    default_units_per_session, start_date, next_candidate_date,
    definition_name_snapshot, title_pattern_snapshot, priority,
    allow_parallel_items, scheduling_policy, duration_override_minutes,
    device_policy_override, note, completed_at, version, created_at, updated_at
)
SELECT
    id, student_id, template_id, template_version_id, 'ITEMIZED',
    status, start_ordinal, current_ordinal, end_ordinal,
    default_units_per_session, start_date, next_candidate_date,
    NULL, NULL, priority,
    allow_parallel_items, scheduling_policy, duration_override_minutes,
    device_policy_override, note, completed_at, version, created_at, updated_at
FROM student_task_track;

CREATE TABLE task_instance (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES student(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('TRACK', 'AD_HOC', 'IMPORT')),
    track_id TEXT REFERENCES student_task_track_migrated(id) ON DELETE SET NULL,
    template_version_id TEXT REFERENCES task_template_version(id),
    template_item_id TEXT REFERENCES task_template_item(id),
    item_ordinal INTEGER,
    scheduled_date TEXT,
    original_scheduled_date TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'COMPLETED', 'CARRIED_OVER', 'BLOCKED', 'CANCELLED')),
    title_snapshot TEXT NOT NULL,
    short_title_snapshot TEXT,
    duration_minutes_snapshot INTEGER,
    requires_device_snapshot INTEGER CHECK (requires_device_snapshot IS NULL OR requires_device_snapshot IN (0, 1)),
    schedule_origin TEXT,
    manual_override INTEGER NOT NULL DEFAULT 0 CHECK (manual_override IN (0, 1)),
    override_reason TEXT,
    locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
    note TEXT,
    carried_from_instance_id TEXT REFERENCES task_instance(id),
    carried_to_instance_id TEXT REFERENCES task_instance(id),
    completed_at TEXT,
    cancelled_at TEXT,
    parent_task_id TEXT REFERENCES task_instance(id) ON DELETE SET NULL,
    linked_parent_task_id TEXT REFERENCES task_instance(id) ON DELETE SET NULL,
    priority TEXT CHECK (priority IS NULL OR priority IN ('HIGH', 'MEDIUM', 'LOW', 'NONE')),
    sort_order INTEGER,
    star INTEGER NOT NULL DEFAULT 0 CHECK (star IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- TRACK rows identify themselves by (track_id, item_ordinal); only ITEMIZED
    -- tracks carry template_item_id.
    CHECK (
        source_type <> 'TRACK'
        OR (track_id IS NOT NULL AND item_ordinal IS NOT NULL)
    )
);

INSERT INTO task_instance (
    id, student_id, source_type, track_id, template_version_id,
    template_item_id, item_ordinal, scheduled_date, original_scheduled_date,
    status, title_snapshot, short_title_snapshot, duration_minutes_snapshot,
    requires_device_snapshot, schedule_origin, manual_override, override_reason,
    locked, note, carried_from_instance_id, carried_to_instance_id,
    completed_at, cancelled_at, parent_task_id, linked_parent_task_id,
    priority, sort_order, star, version, created_at, updated_at
)
SELECT
    id, student_id, source_type, track_id, template_version_id,
    template_item_id, item_ordinal, scheduled_date, original_scheduled_date,
    status, title_snapshot, short_title_snapshot, duration_minutes_snapshot,
    requires_device_snapshot, schedule_origin, manual_override, override_reason,
    locked, note, carried_from_instance_id, carried_to_instance_id,
    completed_at, cancelled_at, parent_task_id, linked_parent_task_id,
    priority, sort_order, star, version, created_at, updated_at
FROM task_instance_backup;

DROP TABLE task_instance_backup;

CREATE INDEX idx_task_student_date_status
    ON task_instance(student_id, scheduled_date, status);
CREATE INDEX idx_task_track_ordinal ON task_instance(track_id, item_ordinal);

-- One PENDING instance per track+ordinal. For ITEMIZED tracks this is
-- equivalent to the old (track_id, template_item_id) index because
-- task_template_item.ordinal is unique per version.
CREATE UNIQUE INDEX uq_task_pending_track_ordinal
    ON task_instance(track_id, item_ordinal)
    WHERE status = 'PENDING' AND track_id IS NOT NULL;

CREATE UNIQUE INDEX uq_task_carry_target
    ON task_instance(carried_from_instance_id)
    WHERE carried_from_instance_id IS NOT NULL AND status <> 'CANCELLED';

DROP TABLE student_task_track;

ALTER TABLE student_task_track_migrated RENAME TO student_task_track;

CREATE INDEX idx_track_student_status ON student_task_track(student_id, status);
