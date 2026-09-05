PRAGMA foreign_keys = ON;

CREATE TABLE student (
    id TEXT PRIMARY KEY,
    student_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    alias TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'ARCHIVED')),
    class_type TEXT,
    enrollment_date TEXT,
    default_device_policy TEXT NOT NULL DEFAULT 'CONFIRM'
        CHECK (default_device_policy IN ('ALLOWED', 'NOT_ALLOWED', 'CONFIRM')),
    note TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    subject_preferences_json TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_student_status_name ON student(status, name);

CREATE TABLE student_weekly_pattern (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES student(id) ON DELETE CASCADE,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX uq_student_active_weekly_pattern
    ON student_weekly_pattern(student_id)
    WHERE status = 'ACTIVE';

CREATE TABLE student_weekly_pattern_day (
    pattern_id TEXT NOT NULL REFERENCES student_weekly_pattern(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    available INTEGER NOT NULL CHECK (available IN (0, 1)),
    available_minutes INTEGER NOT NULL DEFAULT 0 CHECK (available_minutes BETWEEN 0 AND 1440),
    device_policy_override TEXT
        CHECK (device_policy_override IS NULL OR device_policy_override IN ('ALLOWED', 'NOT_ALLOWED', 'CONFIRM')),
    PRIMARY KEY (pattern_id, day_of_week)
);

CREATE TABLE student_date_override (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES student(id) ON DELETE CASCADE,
    business_date TEXT NOT NULL,
    available INTEGER NOT NULL CHECK (available IN (0, 1)),
    available_minutes INTEGER NOT NULL DEFAULT 0 CHECK (available_minutes BETWEEN 0 AND 1440),
    device_policy_override TEXT
        CHECK (device_policy_override IS NULL OR device_policy_override IN ('ALLOWED', 'NOT_ALLOWED', 'CONFIRM')),
    source_type TEXT NOT NULL DEFAULT 'MANUAL'
        CHECK (source_type IN ('BASE_PATTERN', 'PREVIOUS_WEEK', 'MANUAL')),
    note TEXT,
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, business_date)
);

CREATE INDEX idx_student_override_date ON student_date_override(student_id, business_date);

CREATE TABLE task_template (
    id TEXT PRIMARY KEY,
    template_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    short_name TEXT,
    subject_code TEXT NOT NULL,
    category_code TEXT,
    unit_label TEXT NOT NULL DEFAULT '项',
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED', 'ARCHIVED')),
    current_published_version_id TEXT,
    default_duration_minutes INTEGER CHECK (default_duration_minutes IS NULL OR default_duration_minutes BETWEEN 1 AND 1440),
    default_requires_device INTEGER CHECK (default_requires_device IS NULL OR default_requires_device IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE task_template_version (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL REFERENCES task_template(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL CHECK (version_number >= 1),
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
    item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
    change_note TEXT,
    published_at TEXT,
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (template_id, version_number)
);

CREATE UNIQUE INDEX uq_template_draft_version
    ON task_template_version(template_id)
    WHERE status = 'DRAFT';

CREATE TABLE task_template_item (
    id TEXT PRIMARY KEY,
    template_version_id TEXT NOT NULL REFERENCES task_template_version(id) ON DELETE CASCADE,
    item_code TEXT,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 1),
    title TEXT NOT NULL,
    short_title TEXT,
    duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440),
    requires_device INTEGER CHECK (requires_device IS NULL OR requires_device IN (0, 1)),
    content_ref TEXT,
    instructions TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (template_version_id, ordinal),
    UNIQUE (template_version_id, item_code)
);

CREATE TABLE student_task_track (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES student(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL REFERENCES task_template(id),
    template_version_id TEXT NOT NULL REFERENCES task_template_version(id),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('NOT_STARTED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')),
    start_ordinal INTEGER NOT NULL CHECK (start_ordinal >= 1),
    current_ordinal INTEGER NOT NULL CHECK (current_ordinal >= 1),
    end_ordinal INTEGER NOT NULL CHECK (end_ordinal >= start_ordinal),
    default_units_per_session INTEGER NOT NULL DEFAULT 1 CHECK (default_units_per_session >= 1),
    start_date TEXT NOT NULL,
    next_candidate_date TEXT,
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
    CHECK (current_ordinal <= end_ordinal + 1)
);

CREATE INDEX idx_track_student_status ON student_task_track(student_id, status);

CREATE TABLE task_instance (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES student(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('TRACK', 'AD_HOC', 'IMPORT')),
    track_id TEXT REFERENCES student_task_track(id) ON DELETE SET NULL,
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
    CHECK (
        source_type <> 'TRACK'
        OR (track_id IS NOT NULL AND template_item_id IS NOT NULL AND item_ordinal IS NOT NULL)
    )
);

CREATE INDEX idx_task_student_date_status ON task_instance(student_id, scheduled_date, status);
CREATE INDEX idx_task_track_ordinal ON task_instance(track_id, item_ordinal);
CREATE UNIQUE INDEX uq_task_pending_track_item
    ON task_instance(track_id, template_item_id)
    WHERE status = 'PENDING' AND track_id IS NOT NULL AND template_item_id IS NOT NULL;
CREATE UNIQUE INDEX uq_task_carry_target
    ON task_instance(carried_from_instance_id)
    WHERE carried_from_instance_id IS NOT NULL AND status <> 'CANCELLED';

CREATE TABLE vocabulary_batch (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES student(id) ON DELETE CASCADE,
    occurred_date TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'MANUAL',
    subject_code TEXT,
    source_label TEXT,
    raw_text TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE vocabulary_entry (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES vocabulary_batch(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES student(id) ON DELETE CASCADE,
    occurred_date TEXT NOT NULL,
    subject_code TEXT,
    term_original TEXT NOT NULL,
    term_normalized TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'MASTERED', 'ARCHIVED')),
    note TEXT,
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_vocabulary_student_date ON vocabulary_entry(student_id, occurred_date);
CREATE INDEX idx_vocabulary_term ON vocabulary_entry(term_normalized);

CREATE TABLE app_setting (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE idempotency_record (
    operation_key TEXT PRIMARY KEY,
    operation_type TEXT NOT NULL,
    result_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
