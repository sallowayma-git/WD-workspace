-- Enforce the two business identities used by SEQUENCE long tasks.
-- ITEMIZED courses intentionally remain unrestricted because a student may
-- mount the same published course more than once.

CREATE UNIQUE INDEX uq_active_sequence_definition_key
    ON task_template(normalized_key)
    WHERE generation_mode = 'SEQUENCE'
      AND status = 'ACTIVE'
      AND normalized_key IS NOT NULL;

CREATE UNIQUE INDEX uq_active_sequence_track_definition
    ON student_task_track(student_id, template_id)
    WHERE generation_mode = 'SEQUENCE'
      AND status IN ('NOT_STARTED', 'ACTIVE', 'PAUSED');
