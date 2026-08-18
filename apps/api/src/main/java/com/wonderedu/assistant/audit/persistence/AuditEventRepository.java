package com.wonderedu.assistant.audit.persistence;

import com.wonderedu.assistant.audit.api.AuditEventView;
import com.wonderedu.assistant.shared.TenantContext;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * JDBC repository for {@code audit_event}.
 *
 * <p>All reads and writes are tenant-scoped via {@link TenantContext}. The repository writes
 * both the legacy {@code aggregate_type}/{@code aggregate_id} columns (kept so the existing
 * {@code ExecutionService.writeAuditEvent} path remains consistent) and the PRD-aligned
 * {@code target_type}/{@code target_id} columns. On read, {@code target_type}/{@code target_id}
 * fall back to the legacy columns when null, so historical rows written before the schema
 * extension remain queryable through the new API.
 */
@Repository
public class AuditEventRepository {

    /** Sentinel used to satisfy the NOT NULL {@code aggregate_id} legacy column when no target exists. */
    private static final UUID NIL_UUID = new UUID(0L, 0L);

    private final NamedParameterJdbcTemplate jdbc;

    public AuditEventRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Insert a new audit event. Returns the number of rows affected (0 or 1). A return value
     * of 0 indicates the insert was rejected by the unique {@code idempotency_key} constraint,
     * which callers should treat as a successful no-op rather than an error.
     *
     * <p>The legacy {@code aggregate_type}/{@code aggregate_id} columns are NOT NULL in the schema,
     * while the PRD-aligned {@code target_type}/{@code target_id} columns are nullable. To satisfy
     * the NOT NULL constraint when a caller has no concrete target (e.g. a system-wide event),
     * the legacy columns are back-filled with the provided {@code targetType} (defaulting to
     * {@code "SYSTEM"} when null) and a zero-UUID placeholder when {@code targetId} is null.
     * The {@code target_*} columns always store the caller's true values, including null.
     *
     * @param id event id
     * @param organizationId tenant (must match {@link TenantContext#requireOrganizationId()})
     * @param occurredAt event timestamp
     * @param actorType {@code USER} or {@code SYSTEM}
     * @param actorId nullable actor id
     * @param actorRole nullable actor role code (e.g. {@code ADMIN})
     * @param action action code
     * @param targetType PRD-aligned target type
     * @param targetId PRD-aligned target id
     * @param metadata JSON-encoded metadata string, never {@code null} (use {@code "{}"})
     * @param idempotencyKey optional idempotency key; when present the unique constraint
     *     deduplicates concurrent retries of the same logical operation
     */
    /**
     * Insert a new audit event with empty {@code before_data}/{@code after_data}. Delegates to
     * {@link #insert(UUID, UUID, Instant, String, UUID, String, String, String, UUID, String, String,
     * String, String)} passing empty JSON objects for the before/after snapshots. Kept for
     * callers that have no before/after payload (e.g. {@code ExportService}).
     */
    public int insert(
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
        return insert(
                id,
                organizationId,
                occurredAt,
                actorType,
                actorId,
                actorRole,
                action,
                targetType,
                targetId,
                metadata,
                "{}",
                "{}",
                idempotencyKey);
    }

    /**
     * Insert a new audit event with explicit before/after snapshots. Returns the number of rows
     * affected (0 or 1). A return value of 0 indicates the insert was rejected by the unique
     * {@code idempotency_key} constraint, which callers should treat as a successful no-op rather
     * than an error.
     *
     * <p>The legacy {@code aggregate_type}/{@code aggregate_id} columns are NOT NULL in the schema,
     * while the PRD-aligned {@code target_type}/{@code target_id} columns are nullable. To satisfy
     * the NOT NULL constraint when a caller has no concrete target (e.g. a system-wide event),
     * the legacy columns are back-filled with the provided {@code targetType} (defaulting to
     * {@code "SYSTEM"} when null) and a zero-UUID placeholder when {@code targetId} is null.
     * The {@code target_*} columns always store the caller's true values, including null.
     *
     * <p>{@code beforeJson} and {@code afterJson} are written verbatim to the {@code before_data}
     * and {@code after_data} columns (both {@code jsonb}). Callers are responsible for supplying
     * valid JSON; pass {@code "{}"} when no snapshot is available.
     *
     * @param id event id
     * @param organizationId tenant (must match {@link TenantContext#requireOrganizationId()})
     * @param occurredAt event timestamp
     * @param actorType {@code USER} or {@code SYSTEM}
     * @param actorId nullable actor id
     * @param actorRole nullable actor role code (e.g. {@code ADMIN})
     * @param action action code
     * @param targetType PRD-aligned target type
     * @param targetId PRD-aligned target id
     * @param metadata JSON-encoded metadata string, never {@code null} (use {@code "{}"})
     * @param beforeJson JSON-encoded before-state snapshot, never {@code null} (use {@code "{}"})
     * @param afterJson JSON-encoded after-state snapshot, never {@code null} (use {@code "{}"})
     * @param idempotencyKey optional idempotency key; when present the unique constraint
     *     deduplicates concurrent retries of the same logical operation
     */
    public int insert(
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
            String beforeJson,
            String afterJson,
            String idempotencyKey) {
        // Legacy aggregate_id is NOT NULL; use a stable placeholder when the caller has no target.
        UUID legacyAggregateId = targetId != null ? targetId : NIL_UUID;
        String legacyAggregateType = targetType != null ? targetType : "SYSTEM";
        return jdbc.update(
                "INSERT INTO audit_event (id, organization_id, occurred_at, actor_type, actor_id, "
                        + "actor_role, action, aggregate_type, aggregate_id, target_type, target_id, "
                        + "correlation_id, before_data, after_data, metadata, idempotency_key) VALUES "
                        + "(:id, :organizationId, :occurredAt, :actorType, :actorId, :actorRole, :action, "
                        + ":legacyAggregateType, :legacyAggregateId, :targetType, :targetId, '', "
                        + ":beforeData, :afterData, :metadata, :idempotencyKey)",
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("organizationId", organizationId)
                        .addValue("occurredAt", occurredAt)
                        .addValue("actorType", actorType)
                        .addValue("actorId", actorId)
                        .addValue("actorRole", actorRole)
                        .addValue("action", action)
                        .addValue("legacyAggregateType", legacyAggregateType)
                        .addValue("legacyAggregateId", legacyAggregateId)
                        .addValue("targetType", targetType)
                        .addValue("targetId", targetId)
                        .addValue("beforeData", beforeJson)
                        .addValue("afterData", afterJson)
                        .addValue("metadata", metadata)
                        .addValue("idempotencyKey", idempotencyKey));
    }

    /**
     * Page through audit events for the current tenant, newest first.
     *
     * @param offset zero-based row offset
     * @param limit page size
     */
    public List<AuditEventView> findPage(long offset, int limit) {
        return jdbc.query(
                "SELECT id, organization_id, occurred_at, actor_type, actor_id, actor_role, action, "
                        + "aggregate_type, aggregate_id, target_type, target_id, metadata, idempotency_key "
                        + "FROM audit_event WHERE organization_id = :organizationId "
                        + "ORDER BY occurred_at DESC, id DESC LIMIT :limit OFFSET :offset",
                new MapSqlParameterSource()
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("limit", limit)
                        .addValue("offset", offset),
                AuditEventRepository::mapRow);
    }

    /** Total event count for the current tenant, used for page metadata. */
    public long count() {
        Long total = jdbc.queryForObject(
                "SELECT COUNT(*) FROM audit_event WHERE organization_id = :organizationId",
                new MapSqlParameterSource()
                        .addValue("organizationId", TenantContext.requireOrganizationId()),
                Long.class);
        return total == null ? 0L : total;
    }

    private static AuditEventView mapRow(ResultSet rs, int rowNum) throws SQLException {
        String targetType = rs.getString("target_type");
        if (targetType == null) {
            targetType = rs.getString("aggregate_type");
        }
        UUID targetId = rs.getObject("target_id", UUID.class);
        if (targetId == null) {
            targetId = rs.getObject("aggregate_id", UUID.class);
        }
        return new AuditEventView(
                rs.getObject("id", UUID.class),
                rs.getObject("organization_id", UUID.class),
                rs.getObject("occurred_at", java.time.OffsetDateTime.class).toInstant(),
                rs.getString("actor_type"),
                rs.getObject("actor_id", UUID.class),
                rs.getString("actor_role"),
                rs.getString("action"),
                targetType,
                targetId,
                rs.getString("metadata"),
                rs.getString("idempotency_key"));
    }
}
