CREATE TABLE import_job (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    type varchar(30) NOT NULL DEFAULT 'TEMPLATE_XLSX',
    status varchar(20) NOT NULL DEFAULT 'UPLOADED',
    file_name varchar(255) NOT NULL,
    file_sha256 varchar(64) NOT NULL,
    storage_key varchar(500),
    mapping_config jsonb NOT NULL DEFAULT '{}'::jsonb,
    summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    requested_by uuid,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT fk_import_job_organization FOREIGN KEY (organization_id) REFERENCES organization(id),
    CONSTRAINT ck_import_job_type CHECK (type IN ('TEMPLATE_XLSX', 'STUDENT_XLSX')),
    CONSTRAINT ck_import_job_status CHECK (status IN ('UPLOADED', 'PREVIEWED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED'))
);
CREATE INDEX ix_import_job_org_status ON import_job (organization_id, status);

CREATE TABLE import_row_error (
    id uuid PRIMARY KEY,
    import_job_id uuid NOT NULL,
    sheet varchar(100),
    row_number integer,
    column_label varchar(100),
    error_code varchar(50) NOT NULL,
    message varchar(500) NOT NULL,
    raw_value varchar(500),
    created_at timestamptz NOT NULL,
    CONSTRAINT fk_import_row_error_job FOREIGN KEY (import_job_id) REFERENCES import_job(id),
    CONSTRAINT ck_import_row_error_row CHECK (row_number IS NULL OR row_number >= 0)
);
CREATE INDEX ix_import_row_error_job ON import_row_error (import_job_id);
