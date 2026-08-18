-- Extends audit_event with PRD-required columns: actor_role, target_type, target_id,
-- idempotency_key. The original audit_event table (V2026_08_16_001) used aggregate_type/
-- aggregate_id and had no actor_role or idempotency enforcement. These additions allow
-- idempotent audit recording (unique idempotency_key per organization) and richer
-- export metadata ("操作者、生成时间和范围审计").

ALTER TABLE audit_event ADD COLUMN IF NOT EXISTS actor_role varchar(40);
ALTER TABLE audit_event ADD COLUMN IF NOT EXISTS target_type varchar(50);
ALTER TABLE audit_event ADD COLUMN IF NOT EXISTS target_id uuid;
ALTER TABLE audit_event ADD COLUMN IF NOT EXISTS idempotency_key varchar(200);

-- Idempotency: at most one event per (organization, idempotency_key). NULL keys do not
-- conflict, so legacy callers that omit the key remain unrestricted.
CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_event_idempotency
    ON audit_event (organization_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Backfill target_type/target_id from the legacy aggregate columns so existing rows remain
-- queryable through the new fields. aggregate_type/aggregate_id are retained for backward
-- compatibility with ExecutionService.writeAuditEvent.
UPDATE audit_event
SET target_type = aggregate_type,
    target_id = aggregate_id
WHERE target_type IS NULL AND aggregate_type IS NOT NULL;
