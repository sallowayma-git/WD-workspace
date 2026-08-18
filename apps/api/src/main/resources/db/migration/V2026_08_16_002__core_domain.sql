CREATE TABLE student (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    student_code varchar(50) NOT NULL,
    name varchar(100) NOT NULL,
    alias varchar(100),
    status varchar(20) NOT NULL DEFAULT 'ACTIVE',
    class_type varchar(100),
    enrollment_date date,
    default_device_policy varchar(20) NOT NULL DEFAULT 'CONFIRM',
    primary_assistant_id uuid,
    note text,
    search_text text,
    archived_at timestamptz,
    created_at timestamptz NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT fk_student_organization FOREIGN KEY (organization_id) REFERENCES organization(id),
    CONSTRAINT ck_student_status CHECK (status IN ('ACTIVE', 'PAUSED', 'ARCHIVED')),
    CONSTRAINT ck_student_device_policy CHECK (default_device_policy IN ('ALLOWED', 'NOT_ALLOWED', 'CONFIRM')),
    CONSTRAINT uq_student_org_code UNIQUE (organization_id, student_code)
);
CREATE INDEX ix_student_org_status_assistant ON student (organization_id, status, primary_assistant_id);
CREATE INDEX ix_student_name_trgm ON student USING gin (name gin_trgm_ops);
CREATE INDEX ix_student_alias_trgm ON student USING gin (alias gin_trgm_ops);

CREATE TABLE student_tag (
    id uuid PRIMARY KEY,
    student_id uuid NOT NULL,
    tag_code varchar(50) NOT NULL,
    tag_name_snapshot varchar(100) NOT NULL,
    created_at timestamptz NOT NULL,
    created_by uuid NOT NULL,
    CONSTRAINT fk_student_tag_student FOREIGN KEY (student_id) REFERENCES student(id),
    CONSTRAINT uq_student_tag_code UNIQUE (student_id, tag_code)
);

CREATE TABLE student_subject_preference (
    student_id uuid NOT NULL,
    subject_code varchar(30) NOT NULL,
    priority smallint NOT NULL,
    target_ratio numeric(5, 2),
    note varchar(500),
    CONSTRAINT pk_student_subject_preference PRIMARY KEY (student_id, subject_code),
    CONSTRAINT fk_student_subject_preference_student FOREIGN KEY (student_id) REFERENCES student(id),
    CONSTRAINT ck_student_subject_preference_priority CHECK (priority BETWEEN 1 AND 5),
    CONSTRAINT ck_student_subject_preference_ratio CHECK (target_ratio IS NULL OR (target_ratio >= 0 AND target_ratio <= 100))
);

CREATE TABLE student_weekly_pattern (
    id uuid PRIMARY KEY,
    student_id uuid NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    status varchar(20) NOT NULL DEFAULT 'ACTIVE',
    created_at timestamptz NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT fk_student_weekly_pattern_student FOREIGN KEY (student_id) REFERENCES student(id),
    CONSTRAINT ck_student_weekly_pattern_status CHECK (status IN ('ACTIVE', 'RETIRED')),
    CONSTRAINT ck_student_weekly_pattern_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX uq_student_active_weekly_pattern ON student_weekly_pattern (student_id) WHERE status = 'ACTIVE';

CREATE TABLE student_weekly_pattern_day (
    pattern_id uuid NOT NULL,
    day_of_week smallint NOT NULL,
    available boolean NOT NULL DEFAULT true,
    available_minutes integer NOT NULL DEFAULT 0,
    device_policy_override varchar(20),
    CONSTRAINT pk_student_weekly_pattern_day PRIMARY KEY (pattern_id, day_of_week),
    CONSTRAINT fk_student_weekly_pattern_day_pattern FOREIGN KEY (pattern_id) REFERENCES student_weekly_pattern(id),
    CONSTRAINT ck_student_weekly_pattern_day_number CHECK (day_of_week BETWEEN 1 AND 7),
    CONSTRAINT ck_student_weekly_pattern_day_minutes CHECK (available_minutes BETWEEN 0 AND 1440),
    CONSTRAINT ck_student_weekly_pattern_day_policy CHECK (device_policy_override IS NULL OR device_policy_override IN ('ALLOWED', 'NOT_ALLOWED', 'CONFIRM'))
);

CREATE TABLE student_week_plan (
    id uuid PRIMARY KEY,
    student_id uuid NOT NULL,
    week_start_date date NOT NULL,
    source_type varchar(20) NOT NULL,
    source_id uuid,
    status varchar(20) NOT NULL DEFAULT 'DRAFT',
    confirmed_at timestamptz,
    confirmed_by uuid,
    created_at timestamptz NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT fk_student_week_plan_student FOREIGN KEY (student_id) REFERENCES student(id),
    CONSTRAINT uq_student_week_plan_student_week UNIQUE (student_id, week_start_date),
    CONSTRAINT ck_student_week_plan_source CHECK (source_type IN ('BASE_PATTERN', 'PREVIOUS_WEEK', 'MANUAL', 'IMPORT')),
    CONSTRAINT ck_student_week_plan_status CHECK (status IN ('DRAFT', 'CONFIRMED', 'CLOSED')),
    CONSTRAINT ck_student_week_plan_monday CHECK (EXTRACT(ISODOW FROM week_start_date) = 1)
);

CREATE TABLE student_day_availability (
    id uuid PRIMARY KEY,
    week_plan_id uuid NOT NULL,
    student_id uuid NOT NULL,
    business_date date NOT NULL,
    available boolean NOT NULL DEFAULT true,
    available_minutes integer NOT NULL DEFAULT 0,
    device_policy_override varchar(20),
    note varchar(500),
    created_at timestamptz NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT fk_student_day_availability_week_plan FOREIGN KEY (week_plan_id) REFERENCES student_week_plan(id),
    CONSTRAINT fk_student_day_availability_student FOREIGN KEY (student_id) REFERENCES student(id),
    CONSTRAINT uq_student_day_availability_student_date UNIQUE (student_id, business_date),
    CONSTRAINT ck_student_day_availability_minutes CHECK (available_minutes BETWEEN 0 AND 1440),
    CONSTRAINT ck_student_day_availability_policy CHECK (device_policy_override IS NULL OR device_policy_override IN ('ALLOWED', 'NOT_ALLOWED', 'CONFIRM'))
);

CREATE TABLE task_template (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    template_code varchar(80) NOT NULL,
    name varchar(200) NOT NULL,
    short_name varchar(50),
    subject_code varchar(30) NOT NULL,
    category_code varchar(50),
    unit_label varchar(20) NOT NULL DEFAULT '单元',
    default_duration_minutes integer,
    default_requires_device boolean NOT NULL DEFAULT false,
    status varchar(20) NOT NULL DEFAULT 'DRAFT',
    current_published_version_id uuid,
    description text,
    tags jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT fk_task_template_organization FOREIGN KEY (organization_id) REFERENCES organization(id),
    CONSTRAINT uq_task_template_org_code UNIQUE (organization_id, template_code),
    CONSTRAINT ck_task_template_status CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED', 'ARCHIVED')),
    CONSTRAINT ck_task_template_duration CHECK (default_duration_minutes IS NULL OR default_duration_minutes BETWEEN 1 AND 1440)
);
CREATE INDEX ix_task_template_org_subject_status ON task_template (organization_id, subject_code, status);

CREATE TABLE task_template_version (
    id uuid PRIMARY KEY,
    template_id uuid NOT NULL,
    version_number integer NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'DRAFT',
    item_count integer NOT NULL DEFAULT 0,
    change_note text,
    published_at timestamptz,
    published_by uuid,
    checksum varchar(64),
    created_at timestamptz NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT fk_task_template_version_template FOREIGN KEY (template_id) REFERENCES task_template(id),
    CONSTRAINT uq_task_template_version_number UNIQUE (template_id, version_number),
    CONSTRAINT ck_task_template_version_number CHECK (version_number >= 1),
    CONSTRAINT ck_task_template_version_status CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
    CONSTRAINT ck_task_template_version_item_count CHECK (item_count >= 0)
);
CREATE UNIQUE INDEX uq_task_template_one_draft ON task_template_version (template_id) WHERE status = 'DRAFT';
ALTER TABLE task_template
    ADD CONSTRAINT fk_task_template_current_published_version
    FOREIGN KEY (current_published_version_id) REFERENCES task_template_version(id);

CREATE TABLE task_template_item (
    id uuid PRIMARY KEY,
    template_version_id uuid NOT NULL,
    ordinal integer NOT NULL,
    item_code varchar(80),
    title varchar(500) NOT NULL,
    short_title varchar(80),
    duration_minutes integer,
    requires_device boolean,
    content_ref varchar(500),
    instructions text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT fk_task_template_item_version FOREIGN KEY (template_version_id) REFERENCES task_template_version(id),
    CONSTRAINT uq_task_template_item_ordinal UNIQUE (template_version_id, ordinal),
    CONSTRAINT uq_task_template_item_code UNIQUE (template_version_id, item_code),
    CONSTRAINT ck_task_template_item_ordinal CHECK (ordinal >= 1),
    CONSTRAINT ck_task_template_item_duration CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440)
);

CREATE TABLE student_task_track (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    student_id uuid NOT NULL,
    template_id uuid NOT NULL,
    template_version_id uuid NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'NOT_STARTED',
    start_ordinal integer NOT NULL,
    current_ordinal integer NOT NULL,
    end_ordinal integer NOT NULL,
    default_units_per_session integer NOT NULL DEFAULT 1,
    start_date date NOT NULL,
    next_candidate_date date,
    priority smallint NOT NULL DEFAULT 50,
    allow_parallel_items boolean NOT NULL DEFAULT false,
    scheduling_policy varchar(30) NOT NULL DEFAULT 'MANUAL',
    duration_override_minutes integer,
    device_policy_override varchar(20),
    note text,
    completed_at timestamptz,
    completed_by uuid,
    created_at timestamptz NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT fk_student_task_track_organization FOREIGN KEY (organization_id) REFERENCES organization(id),
    CONSTRAINT fk_student_task_track_student FOREIGN KEY (student_id) REFERENCES student(id),
    CONSTRAINT fk_student_task_track_template FOREIGN KEY (template_id) REFERENCES task_template(id),
    CONSTRAINT fk_student_task_track_version FOREIGN KEY (template_version_id) REFERENCES task_template_version(id),
    CONSTRAINT ck_student_task_track_status CHECK (status IN ('NOT_STARTED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')),
    CONSTRAINT ck_student_task_track_ordinals CHECK (start_ordinal >= 1 AND current_ordinal >= start_ordinal AND current_ordinal <= end_ordinal + 1),
    CONSTRAINT ck_student_task_track_units CHECK (default_units_per_session >= 1),
    CONSTRAINT ck_student_task_track_priority CHECK (priority BETWEEN 1 AND 100),
    CONSTRAINT ck_student_task_track_policy CHECK (scheduling_policy IN ('MANUAL', 'ROLLING', 'AUTO_CAPACITY')),
    CONSTRAINT ck_student_task_track_device_policy CHECK (device_policy_override IS NULL OR device_policy_override IN ('ALLOWED', 'NOT_ALLOWED', 'CONFIRM'))
);
CREATE INDEX ix_student_task_track_student_status ON student_task_track (student_id, status);
CREATE INDEX ix_student_task_track_template_status ON student_task_track (template_id, status);
CREATE INDEX ix_student_task_track_org_status_candidate ON student_task_track (organization_id, status, next_candidate_date);
