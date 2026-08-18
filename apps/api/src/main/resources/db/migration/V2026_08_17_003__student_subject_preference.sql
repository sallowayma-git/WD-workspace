-- FR-PROFILE-006 学科倾向 (student_subject_preference). The table was first sketched in
-- V2026_08_16_002__core_domain.sql as a minimal placeholder (student_id + subject_code PK),
-- but the full SDD §8.4 shape calls for an organization-scoped row with its own surrogate id,
-- optimistic-lock version, and audit columns so preferences can be managed as a first-class
-- resource. Drop and recreate so both fresh installs and already-migrated environments land on
-- the same shape; the table held no production data (no CRUD or API existed before this change).

DROP TABLE IF EXISTS student_subject_preference;

CREATE TABLE student_subject_preference (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    student_id uuid NOT NULL,
    subject_code varchar(30) NOT NULL,
    priority smallint NOT NULL,
    target_ratio numeric(5, 2),
    note varchar(500),
    created_at timestamptz NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT fk_student_subject_preference_organization FOREIGN KEY (organization_id) REFERENCES organization(id),
    CONSTRAINT fk_student_subject_preference_student FOREIGN KEY (student_id) REFERENCES student(id),
    CONSTRAINT uq_student_subject_preference_student_subject UNIQUE (student_id, subject_code),
    CONSTRAINT ck_student_subject_preference_priority CHECK (priority BETWEEN 1 AND 5),
    CONSTRAINT ck_student_subject_preference_ratio CHECK (target_ratio IS NULL OR (target_ratio >= 0 AND target_ratio <= 100))
);
CREATE INDEX ix_student_subject_preference_org_student ON student_subject_preference (organization_id, student_id);
