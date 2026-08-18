CREATE TABLE search_document (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    document_type varchar(30) NOT NULL,
    entity_id uuid NOT NULL,
    title varchar(500),
    subtitle varchar(500),
    normalized_text text,
    tsv tsvector,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL,
    CONSTRAINT uq_search_document UNIQUE (organization_id, document_type, entity_id),
    CONSTRAINT ck_search_document_type CHECK (document_type IN ('STUDENT', 'TEMPLATE', 'TEMPLATE_ITEM', 'TASK_INSTANCE'))
);
CREATE INDEX ix_search_document_tsv ON search_document USING gin (tsv);
CREATE INDEX ix_search_document_trgm ON search_document USING gin (title gin_trgm_ops);
CREATE INDEX ix_search_document_org_type ON search_document (organization_id, document_type);

CREATE TABLE vocabulary_batch (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    student_id uuid NOT NULL,
    occurred_date date NOT NULL,
    source_type varchar(30) NOT NULL DEFAULT 'MANUAL',
    subject_code varchar(30),
    source_label varchar(200),
    note text,
    raw_input text,
    created_at timestamptz NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT fk_vocabulary_batch_student FOREIGN KEY (student_id) REFERENCES student(id),
    CONSTRAINT ck_vocabulary_batch_source CHECK (source_type IN ('LISTENING_TEST', 'READING', 'HOMEWORK', 'MANUAL', 'RETEST', 'OTHER'))
);
CREATE INDEX ix_vocabulary_batch_student_date ON vocabulary_batch (student_id, occurred_date);

CREATE TABLE vocabulary_entry (
    id uuid PRIMARY KEY,
    batch_id uuid NOT NULL,
    student_id uuid NOT NULL,
    term_original varchar(300) NOT NULL,
    term_normalized varchar(300) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'ACTIVE',
    source_entry_id uuid,
    note varchar(1000),
    created_at timestamptz NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT fk_vocabulary_entry_batch FOREIGN KEY (batch_id) REFERENCES vocabulary_batch(id),
    CONSTRAINT fk_vocabulary_entry_student FOREIGN KEY (student_id) REFERENCES student(id),
    CONSTRAINT ck_vocabulary_entry_status CHECK (status IN ('ACTIVE', 'MASTERED', 'ARCHIVED'))
);
CREATE INDEX ix_vocabulary_entry_student_created ON vocabulary_entry (student_id, created_at);
CREATE INDEX ix_vocabulary_entry_student_normalized ON vocabulary_entry (student_id, term_normalized);
