package com.wonderedu.assistant.audit.api;

import java.time.Instant;
import java.util.UUID;

/**
 * Recorded audit event for a significant write operation.
 *
 * <p>This record mirrors the {@code audit_event} table and is the canonical read model
 * returned by {@code GET /api/v1/audit-events}. The {@code aggregateType}/{@code aggregateId}
 * fields are retained for backward compatibility with the legacy {@code ExecutionService}
 * audit writes; {@code targetType}/{@code targetId} are the PRD-aligned names.
 */
public record AuditEventView(
        UUID id,
        UUID organizationId,
        Instant occurredAt,
        String actorType,
        UUID actorId,
        String actorRole,
        String action,
        String targetType,
        UUID targetId,
        String metadata,
        String idempotencyKey) {

    /** Compact canonical constructor reserved for future validation hooks. */
    public AuditEventView {}
}
