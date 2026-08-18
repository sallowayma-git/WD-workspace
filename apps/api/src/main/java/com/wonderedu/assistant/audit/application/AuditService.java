package com.wonderedu.assistant.audit.application;

import com.wonderedu.assistant.audit.api.AuditAction;
import com.wonderedu.assistant.audit.api.AuditEventView;
import com.wonderedu.assistant.audit.persistence.AuditEventRepository;
import com.wonderedu.assistant.shared.ActorContext;
import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.IdGenerator;
import com.wonderedu.assistant.shared.TenantContext;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Records and queries audit events.
 *
 * <p>Recording is idempotent: when an {@code idempotencyKey} is supplied, the underlying unique
 * index on {@code (organization_id, idempotency_key)} rejects duplicate inserts. The service
 * treats such rejections as a successful no-op and returns {@code false} from
 * {@link #recordEvent}, so callers that retry a logical operation (e.g. a job re-running
 * after a crash) do not produce duplicate events and do not surface an error.
 *
 * <p>The actor is resolved from {@link ActorContext} when present; otherwise the insert falls
 * back to {@code SYSTEM} actor semantics (nullable actor id). The actor role is resolved
 * from the current Spring Security {@link Authentication} unless the caller overrides it.
 */
@Service
public class AuditService {

    /** Stable placeholder actor id used when no authenticated actor is on the thread. */
    static final UUID SYSTEM_ACTOR =
            UUID.nameUUIDFromBytes("assistant-system".getBytes(java.nio.charset.StandardCharsets.UTF_8));

    private static final int MAX_PAGE_SIZE = 200;

    private final AuditEventRepository repository;
    private final IdGenerator idGenerator;
    private final BusinessClock clock;

    public AuditService(
            AuditEventRepository repository,
            IdGenerator idGenerator,
            BusinessClock clock) {
        this.repository = repository;
        this.idGenerator = idGenerator;
        this.clock = clock;
    }

    /**
     * Record an audit event, deduplicating by {@code idempotencyKey} when supplied. The
     * {@code before_data}/{@code after_data} columns are written as empty JSON objects; use
     * {@link #recordEvent(AuditAction, String, UUID, Map, Map, Map, String, String)} when a
     * before/after snapshot is available.
     *
     * @param action the action code; stored verbatim
     * @param targetType free-form target type label (e.g. {@code TASK_INSTANCE})
     * @param targetId nullable target id
     * @param metadata additional structured context; never {@code null}
     * @param idempotencyKey optional idempotency key. When non-null, a duplicate insert for the
     *     same {@code (organization, key)} is silently dropped and this method returns {@code false}
     * @return {@code true} if a new event was inserted; {@code false} if it was deduplicated as
     *     a duplicate of an existing event with the same idempotency key
     */
    @Transactional
    public boolean recordEvent(
            AuditAction action,
            String targetType,
            UUID targetId,
            Map<String, Object> metadata,
            String idempotencyKey) {
        return recordEvent(
                action,
                targetType,
                targetId,
                metadata,
                Map.of(),
                Map.of(),
                idempotencyKey,
                /* actorRoleOverride */ null);
    }

    /**
     * Variant that allows the caller to override the resolved actor role. Useful for
     * system-initiated jobs where the role is a known constant rather than the
     * thread-bound authenticated user. Before/after snapshots are written as empty JSON objects;
     * use {@link #recordEvent(AuditAction, String, UUID, Map, Map, Map, String, String)} when a
     * before/after snapshot is available.
     */
    @Transactional
    public boolean recordEvent(
            AuditAction action,
            String targetType,
            UUID targetId,
            Map<String, Object> metadata,
            String idempotencyKey,
            String actorRoleOverride) {
        return recordEvent(
                action,
                targetType,
                targetId,
                metadata,
                Map.of(),
                Map.of(),
                idempotencyKey,
                actorRoleOverride);
    }

    /**
     * Record an audit event with explicit before/after state snapshots, deduplicating by
     * {@code idempotencyKey} when supplied. Satisfies BR-015/AC-008/AC-014 which require audit
     * events to capture the real field values that changed (e.g. status, scheduledDate, version)
     * rather than empty placeholders.
     *
     * @param action the action code; stored verbatim
     * @param targetType free-form target type label (e.g. {@code TASK_INSTANCE})
     * @param targetId nullable target id
     * @param metadata additional structured context; never {@code null}
     * @param before snapshot of the target's relevant fields before the mutation; may be empty
     *     but not {@code null}
     * @param after snapshot of the target's relevant fields after the mutation; may be empty
     *     but not {@code null}
     * @param idempotencyKey optional idempotency key
     * @param actorRoleOverride optional actor role override
     * @return {@code true} if a new event was inserted; {@code false} if it was deduplicated
     */
    @Transactional
    public boolean recordEvent(
            AuditAction action,
            String targetType,
            UUID targetId,
            Map<String, Object> metadata,
            Map<String, Object> before,
            Map<String, Object> after,
            String idempotencyKey,
            String actorRoleOverride) {
        UUID organizationId = TenantContext.requireOrganizationId();
        Instant occurredAt = clock.now();
        ActorContext.Actor actor = ActorContext.current();
        UUID actorId = actor == null ? SYSTEM_ACTOR : actor.id();
        String actorRole = actorRoleOverride != null ? actorRoleOverride : resolveActorRole();
        Map<String, Object> safeMetadata = metadata == null ? Map.of() : new LinkedHashMap<>(metadata);
        Map<String, Object> safeBefore = before == null ? Map.of() : new LinkedHashMap<>(before);
        Map<String, Object> safeAfter = after == null ? Map.of() : new LinkedHashMap<>(after);
        String metadataJson = toJson(safeMetadata);
        String beforeJson = toJson(safeBefore);
        String afterJson = toJson(safeAfter);

        try {
            int rows = repository.insert(
                    idGenerator.next(),
                    organizationId,
                    occurredAt,
                    "USER",
                    actorId,
                    actorRole,
                    action.name(),
                    targetType,
                    targetId,
                    metadataJson,
                    beforeJson,
                    afterJson,
                    idempotencyKey);
            return rows > 0;
        } catch (DuplicateKeyException ex) {
            // Idempotency constraint fired — a prior insert for the same key already won.
            return false;
        }
    }

    /**
     * Page through audit events for the current tenant, newest first.
     *
     * @param page zero-based page index
     * @param size page size, clamped to {@code [1, 200]}
     */
    @Transactional(readOnly = true)
    public AuditPage findPage(int page, int size) {
        int safeSize = Math.max(1, Math.min(MAX_PAGE_SIZE, size));
        long safePage = Math.max(0, page);
        long offset = safePage * safeSize;
        List<AuditEventView> events = repository.findPage(offset, safeSize);
        long total = repository.count();
        int totalPages = (int) Math.min(Integer.MAX_VALUE, (total + safeSize - 1) / safeSize);
        return new AuditPage(events, safePage, safeSize, total, totalPages);
    }

    private String resolveActorRole() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null) {
            return null;
        }
        return auth.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .filter(a -> a.startsWith("ROLE_"))
                .map(a -> a.substring(5))
                .findFirst()
                .orElse(null);
    }

    /** Minimal JSON serializer for flat metadata maps. Avoids a Jackson dependency at this layer. */
    private static String toJson(Map<String, Object> map) {
        if (map.isEmpty()) {
            return "{}";
        }
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Object> e : map.entrySet()) {
            if (!first) {
                sb.append(',');
            }
            first = false;
            sb.append('"').append(escape(e.getKey())).append("\":");
            appendValue(sb, e.getValue());
        }
        sb.append('}');
        return sb.toString();
    }

    private static void appendValue(StringBuilder sb, Object value) {
        if (value == null) {
            sb.append("null");
        } else if (value instanceof Number || value instanceof Boolean) {
            sb.append(value);
        } else if (value instanceof UUID) {
            sb.append('"').append(value).append('"');
        } else {
            sb.append('"').append(escape(String.valueOf(value))).append('"');
        }
    }

    private static String escape(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        return sb.toString();
    }

    /**
     * Paginated result envelope for audit event queries.
     *
     * @param events the page rows
     * @param page zero-based page index
     * @param size page size actually used
     * @param total total row count for the tenant
     * @param totalPages total number of pages
     */
    public record AuditPage(
            List<AuditEventView> events, long page, int size, long total, int totalPages) {}
}
