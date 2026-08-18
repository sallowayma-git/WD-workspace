-- Asynchronous export jobs (SDD §11.10 ExportController). The minimal viable export path is
-- synchronous and does not write here, but the table exists for the planned async upgrade so
-- the schema is in place before the feature is wired up. Mirrors the import_job shape and
-- keeps h2-schema.sql and the production migration in lockstep.

CREATE TABLE export_job (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    type varchar(30) NOT NULL DEFAULT 'VOCABULARY_CSV',
    status varchar(20) NOT NULL DEFAULT 'PENDING',
    target_type varchar(40) NOT NULL,
    target_id uuid,
    params jsonb NOT NULL DEFAULT '{}'::jsonb,
    file_name varchar(255),
    storage_key varchar(500),
    row_count integer,
    error_code varchar(50),
    error_message varchar(500),
    requested_by uuid,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT fk_export_job_organization FOREIGN KEY (organization_id) REFERENCES organization(id),
    CONSTRAINT ck_export_job_type CHECK (type IN ('VOCABULARY_CSV', 'STUDENT_XLSX', 'ATTENDANCE_CSV')),
    CONSTRAINT ck_export_job_status CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    CONSTRAINT ck_export_job_row_count CHECK (row_count IS NULL OR row_count >= 0)
);
CREATE INDEX ix_export_job_org_status ON export_job (organization_id, status);
CREATE INDEX ix_export_job_target ON export_job (organization_id, target_type, target_id);
