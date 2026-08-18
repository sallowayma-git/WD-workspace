CREATE TABLE task_instance (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    student_id uuid NOT NULL,
    source_type varchar(20) NOT NULL,
    track_id uuid,
    template_version_id uuid,
    template_item_id uuid,
    item_ordinal integer,
    scheduled_date date NOT NULL,
    original_scheduled_date date NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'PENDING',
    title_snapshot varchar(500) NOT NULL,
    short_title_snapshot varchar(80),
    duration_minutes_snapshot integer,
    requires_device_snapshot boolean,
    schedule_origin varchar(20) NOT NULL DEFAULT 'AUTO',
    manual_override boolean NOT NULL DEFAULT false,
    override_reason varchar(500),
    locked boolean NOT NULL DEFAULT false,
    note text,
    carried_from_instance_id uuid,
    carried_to_instance_id uuid,
    completed_at timestamptz,
    completed_by uuid,
    cancelled_at timestamptz,
    cancelled_by uuid,
    created_at timestamptz NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT fk_task_instance_organization FOREIGN KEY (organization_id) REFERENCES organization(id),
    CONSTRAINT fk_task_instance_student FOREIGN KEY (student_id) REFERENCES student(id),
    CONSTRAINT fk_task_instance_track FOREIGN KEY (track_id) REFERENCES student_task_track(id),
    CONSTRAINT fk_task_instance_template_version FOREIGN KEY (template_version_id) REFERENCES task_template_version(id),
    CONSTRAINT fk_task_instance_template_item FOREIGN KEY (template_item_id) REFERENCES task_template_item(id),
    CONSTRAINT fk_task_instance_carried_from FOREIGN KEY (carried_from_instance_id) REFERENCES task_instance(id),
    CONSTRAINT fk_task_instance_carried_to FOREIGN KEY (carried_to_instance_id) REFERENCES task_instance(id),
    CONSTRAINT ck_task_instance_source_type CHECK (source_type IN ('TRACK', 'AD_HOC', 'IMPORT')),
    CONSTRAINT ck_task_instance_status CHECK (status IN ('PENDING', 'COMPLETED', 'CARRIED_OVER', 'CANCELLED', 'SKIPPED', 'BLOCKED')),
    CONSTRAINT ck_task_instance_schedule_origin CHECK (schedule_origin IN ('AUTO', 'MANUAL', 'IMPORT', 'CARRYOVER')),
    CONSTRAINT ck_task_instance_track_source CHECK (
        (source_type = 'TRACK' AND track_id IS NOT NULL AND template_item_id IS NOT NULL AND item_ordinal IS NOT NULL)
        OR (source_type <> 'TRACK')
    ),
    CONSTRAINT ck_task_instance_adhoc_source CHECK (
        source_type <> 'AD_HOC' OR (track_id IS NULL AND template_item_id IS NULL AND item_ordinal IS NULL)
    ),
    CONSTRAINT ck_task_instance_no_self_carry_from CHECK (carried_from_instance_id IS NULL OR carried_from_instance_id <> id),
    CONSTRAINT ck_task_instance_no_self_carry_to CHECK (carried_to_instance_id IS NULL OR carried_to_instance_id <> id),
    CONSTRAINT ck_task_instance_completed_audit CHECK (status <> 'COMPLETED' OR (completed_at IS NOT NULL AND completed_by IS NOT NULL)),
    CONSTRAINT ck_task_instance_cancelled_audit CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)),
    CONSTRAINT ck_task_instance_duration CHECK (duration_minutes_snapshot IS NULL OR duration_minutes_snapshot BETWEEN 1 AND 1440),
    CONSTRAINT ck_task_instance_override_reason CHECK (manual_override IS FALSE OR override_reason IS NOT NULL)
);
CREATE UNIQUE INDEX uq_task_instance_track_pending ON task_instance (track_id, template_item_id) WHERE status = 'PENDING';
CREATE INDEX ix_task_instance_student_date_status ON task_instance (student_id, scheduled_date, status);
CREATE INDEX ix_task_instance_org_date_status ON task_instance (organization_id, scheduled_date, status);
CREATE INDEX ix_task_instance_track_ordinal_status ON task_instance (track_id, item_ordinal, status);
CREATE INDEX ix_task_instance_carried_from ON task_instance (carried_from_instance_id);
