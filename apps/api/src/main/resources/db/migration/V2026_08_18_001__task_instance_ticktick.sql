-- Extends task_instance with TickTick-style fields: parent/child relationships, linked main
-- task, priority, manual sort order, and star flag. Supports sub-task creation, linked-main
-- association, priority flags, drag-to-reorder, and starring as required by the TickTick-style
-- task interaction model. All additions are nullable or have safe defaults so existing rows and
-- callers continue to work without changes.

ALTER TABLE task_instance ADD COLUMN IF NOT EXISTS parent_task_id uuid;
ALTER TABLE task_instance ADD COLUMN IF NOT EXISTS linked_parent_task_id uuid;
ALTER TABLE task_instance ADD COLUMN IF NOT EXISTS priority varchar(10) NOT NULL DEFAULT 'NONE';
ALTER TABLE task_instance ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE task_instance ADD COLUMN IF NOT EXISTS star boolean NOT NULL DEFAULT false;

-- Priority domain constraint. Mirrors the TickTick NONE/LOW/MEDIUM/HIGH ladder.
ALTER TABLE task_instance DROP CONSTRAINT IF EXISTS ck_task_instance_priority;
ALTER TABLE task_instance ADD CONSTRAINT ck_task_instance_priority
    CHECK (priority IN ('NONE', 'LOW', 'MEDIUM', 'HIGH'));

-- Self-reference guards: a task cannot be its own parent or linked parent.
ALTER TABLE task_instance DROP CONSTRAINT IF EXISTS ck_task_instance_no_self_parent;
ALTER TABLE task_instance ADD CONSTRAINT ck_task_instance_no_self_parent
    CHECK (parent_task_id IS NULL OR parent_task_id <> id);

ALTER TABLE task_instance DROP CONSTRAINT IF EXISTS ck_task_instance_no_self_linked;
ALTER TABLE task_instance ADD CONSTRAINT ck_task_instance_no_self_linked
    CHECK (linked_parent_task_id IS NULL OR linked_parent_task_id <> id);

-- Tenant-scoped lookup indexes for children of a parent and links of a main task.
CREATE INDEX IF NOT EXISTS ix_task_instance_parent
    ON task_instance (organization_id, parent_task_id);
CREATE INDEX IF NOT EXISTS ix_task_instance_linked
    ON task_instance (organization_id, linked_parent_task_id);
