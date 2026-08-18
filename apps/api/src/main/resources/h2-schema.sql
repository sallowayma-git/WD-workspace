-- H2-compatible schema for development mode (PostgreSQL mode)
-- Consolidates V001-V006 migrations, removing PostgreSQL-specific syntax

CREATE TABLE IF NOT EXISTS organization (
    id uuid PRIMARY KEY,
    code varchar(50) NOT NULL,
    name varchar(200) NOT NULL,
    business_timezone varchar(64) NOT NULL,
    day_close_time time NOT NULL DEFAULT '05:00:00',
    carryover_horizon_days integer NOT NULL DEFAULT 90,
    status varchar(20) NOT NULL DEFAULT 'ACTIVE',
    settings clob NOT NULL DEFAULT '{}'::json,
    created_at timestamp NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamp NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_account (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    username varchar(100) NOT NULL,
    display_name varchar(100) NOT NULL,
    email varchar(255),
    password_hash varchar(255) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'ACTIVE',
    locale varchar(20) NOT NULL DEFAULT 'zh-CN',
    timezone varchar(64),
    last_login_at timestamp,
    failed_login_attempts integer NOT NULL DEFAULT 0,
    locked_until timestamp,
    password_changed_at timestamp,
    created_at timestamp NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamp NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS auth_session (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    access_token_hash varchar(64) NOT NULL,
    refresh_token_hash varchar(64) NOT NULL,
    access_expires_at timestamp NOT NULL,
    refresh_expires_at timestamp NOT NULL,
    revoked_at timestamp,
    revoked_reason varchar(40),
    rotated_from_session_id uuid,
    replaced_by_session_id uuid,
    created_at timestamp NOT NULL,
    updated_at timestamp NOT NULL,
    version bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_role_assignment (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role_code varchar(40) NOT NULL,
    scope_type varchar(30) NOT NULL,
    scope_id uuid,
    created_at timestamp NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamp NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_event (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    occurred_at timestamp NOT NULL,
    actor_type varchar(20) NOT NULL,
    actor_id uuid,
    actor_role varchar(40),
    action varchar(80) NOT NULL,
    aggregate_type varchar(50) NOT NULL,
    aggregate_id uuid NOT NULL,
    target_type varchar(50),
    target_id uuid,
    correlation_id varchar(100) NOT NULL,
    before_data clob,
    after_data clob,
    metadata clob,
    idempotency_key varchar(200)
);
-- Idempotency: at most one event per (organization, idempotency_key). H2 does not support
-- partial unique indexes, so the constraint applies to NULL keys as well. Callers that omit
-- the key in dev mode therefore share a single NULL slot — acceptable for the dev profile,
-- which is single-user. Production uses Flyway with a WHERE idempotency_key IS NOT NULL guard.
CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_event_idempotency
    ON audit_event (organization_id, idempotency_key);
CREATE INDEX IF NOT EXISTS ix_audit_event_org_occurred
    ON audit_event (organization_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_record (
    organization_id uuid NOT NULL,
    idempotency_key varchar(200) NOT NULL,
    command_type varchar(80) NOT NULL,
    actor_id uuid NOT NULL,
    request_hash varchar(64) NOT NULL,
    status varchar(20) NOT NULL,
    result_type varchar(50),
    result_id uuid,
    response_snapshot clob,
    expires_at timestamp NOT NULL,
    PRIMARY KEY (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS student (
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
    archived_at timestamp,
    created_at timestamp NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamp NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS student_tag (
    id uuid PRIMARY KEY,
    student_id uuid NOT NULL,
    tag_code varchar(50) NOT NULL,
    tag_name_snapshot varchar(100) NOT NULL,
    created_at timestamp NOT NULL,
    created_by uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS student_subject_preference (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    student_id uuid NOT NULL,
    subject_code varchar(30) NOT NULL,
    priority smallint NOT NULL,
    target_ratio numeric(5, 2),
    note varchar(500),
    created_at timestamp NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamp NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_student_subject_preference_org_student
    ON student_subject_preference (organization_id, student_id);

CREATE TABLE IF NOT EXISTS student_weekly_pattern (
    id uuid PRIMARY KEY,
    student_id uuid NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    status varchar(20) NOT NULL DEFAULT 'ACTIVE',
    created_at timestamp NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamp NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS student_weekly_pattern_day (
    pattern_id uuid NOT NULL,
    day_of_week smallint NOT NULL,
    available boolean NOT NULL DEFAULT true,
    available_minutes integer NOT NULL DEFAULT 0,
    device_policy_override varchar(20),
    PRIMARY KEY (pattern_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS student_week_plan (
    id uuid PRIMARY KEY,
    student_id uuid NOT NULL,
    week_start_date date NOT NULL,
    source_type varchar(20) NOT NULL,
    source_id uuid,
    status varchar(20) NOT NULL DEFAULT 'DRAFT',
    confirmed_at timestamp,
    confirmed_by uuid,
    created_at timestamp NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamp NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS student_day_availability (
    id uuid PRIMARY KEY,
    week_plan_id uuid NOT NULL,
    student_id uuid NOT NULL,
    business_date date NOT NULL,
    available boolean NOT NULL DEFAULT true,
    available_minutes integer NOT NULL DEFAULT 0,
    device_policy_override varchar(20),
    note varchar(500),
    created_at timestamp NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamp NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_template (
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
    tags clob NOT NULL DEFAULT '{}'::json,
    created_at timestamp NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamp NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_template_version (
    id uuid PRIMARY KEY,
    template_id uuid NOT NULL,
    version_number integer NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'DRAFT',
    item_count integer NOT NULL DEFAULT 0,
    change_note text,
    published_at timestamp,
    published_by uuid,
    checksum varchar(64),
    created_at timestamp NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamp NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_template_item (
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
    metadata clob NOT NULL DEFAULT '{}'::json,
    active boolean NOT NULL DEFAULT true,
    created_at timestamp NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamp NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS student_task_track (
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
    completed_at timestamp,
    completed_by uuid,
    created_at timestamp NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamp NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_instance (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    student_id uuid NOT NULL,
    source_type varchar(20) NOT NULL,
    track_id uuid,
    template_version_id uuid,
    template_item_id uuid,
    item_ordinal integer,
    scheduled_date date,
    original_scheduled_date date,
    status varchar(20) NOT NULL DEFAULT 'PENDING',
    title_snapshot varchar(500),
    short_title_snapshot varchar(80),
    duration_minutes_snapshot integer,
    requires_device_snapshot boolean,
    schedule_origin varchar(20),
    manual_override boolean NOT NULL DEFAULT false,
    override_reason varchar(500),
    locked boolean NOT NULL DEFAULT false,
    note text,
    carried_from_instance_id uuid,
    carried_to_instance_id uuid,
    parent_task_id uuid,
    linked_parent_task_id uuid,
    priority varchar(10) NOT NULL DEFAULT 'NONE',
    sort_order integer NOT NULL DEFAULT 0,
    star boolean NOT NULL DEFAULT false,
    completed_at timestamp,
    completed_by uuid,
    cancelled_at timestamp,
    cancelled_by uuid,
    created_at timestamp NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamp NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT ck_task_instance_no_self_parent CHECK (parent_task_id IS NULL OR parent_task_id <> id),
    CONSTRAINT ck_task_instance_no_self_linked CHECK (linked_parent_task_id IS NULL OR linked_parent_task_id <> id)
);
CREATE INDEX IF NOT EXISTS ix_task_instance_parent ON task_instance (organization_id, parent_task_id);
CREATE INDEX IF NOT EXISTS ix_task_instance_linked ON task_instance (organization_id, linked_parent_task_id);

CREATE TABLE IF NOT EXISTS import_job (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    type varchar(30) NOT NULL DEFAULT 'TEMPLATE_XLSX',
    status varchar(20) NOT NULL DEFAULT 'UPLOADED',
    file_name varchar(255) NOT NULL,
    file_sha256 varchar(64) NOT NULL,
    storage_key varchar(500),
    mapping_config clob NOT NULL DEFAULT '{}'::json,
    summary clob NOT NULL DEFAULT '{}'::json,
    requested_by uuid,
    started_at timestamp,
    finished_at timestamp,
    created_at timestamp NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamp NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS import_row_error (
    id uuid PRIMARY KEY,
    import_job_id uuid NOT NULL,
    sheet varchar(100),
    row_number integer,
    column_label varchar(100),
    error_code varchar(50) NOT NULL,
    message varchar(500) NOT NULL,
    raw_value varchar(500),
    created_at timestamp NOT NULL
);

-- Asynchronous export jobs (SDD §11.10 ExportController). The minimal viable export path is
-- synchronous and does not write here, but the table exists for the planned async upgrade.
CREATE TABLE IF NOT EXISTS export_job (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    type varchar(30) NOT NULL DEFAULT 'VOCABULARY_CSV',
    status varchar(20) NOT NULL DEFAULT 'PENDING',
    target_type varchar(40) NOT NULL,
    target_id uuid,
    params clob NOT NULL DEFAULT '{}'::json,
    file_name varchar(255),
    storage_key varchar(500),
    row_count integer,
    error_code varchar(50),
    error_message varchar(500),
    requested_by uuid,
    started_at timestamp,
    finished_at timestamp,
    created_at timestamp NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamp NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ix_export_job_org_status
    ON export_job (organization_id, status);

CREATE TABLE IF NOT EXISTS search_document (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    document_type varchar(30) NOT NULL,
    entity_id uuid NOT NULL,
    title varchar(500),
    subtitle varchar(500),
    normalized_text text,
    tsv text,
    payload clob NOT NULL DEFAULT '{}'::json,
    updated_at timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS vocabulary_batch (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    student_id uuid NOT NULL,
    occurred_date date NOT NULL,
    source_type varchar(30) NOT NULL DEFAULT 'MANUAL',
    subject_code varchar(30),
    source_label varchar(200),
    note text,
    raw_input text,
    created_at timestamp NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamp NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vocabulary_entry (
    id uuid PRIMARY KEY,
    batch_id uuid NOT NULL,
    student_id uuid NOT NULL,
    term_original varchar(300) NOT NULL,
    term_normalized varchar(300) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'ACTIVE',
    source_entry_id uuid,
    note varchar(1000),
    created_at timestamp NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamp NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0
);

-- Seed default organization
MERGE INTO organization (id, code, name, business_timezone, day_close_time, carryover_horizon_days, status, settings, created_at, created_by, updated_at, updated_by, version)
KEY(id)
VALUES ('00000000-0000-4000-8000-000000000001', 'LOCAL', '本地开发机构', 'Asia/Shanghai', '05:00:00', 90, 'ACTIVE', '{}'::json, CURRENT_TIMESTAMP, '00000000-0000-4000-8000-000000000010', CURRENT_TIMESTAMP, '00000000-0000-4000-8000-000000000010', 0);
