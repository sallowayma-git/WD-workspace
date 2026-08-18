package com.wonderedu.assistant.search.persistence;

import com.wonderedu.assistant.shared.IdGenerator;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Persistence of {@code search_document} rows (SDD §8.17), the search projection read-model.
 *
 * <p>This repository provides an idempotent {@code INSERT ... ON CONFLICT UPDATE} upsert and a
 * batch rebuild that re-materializes the projection from the master tables
 * ({@code student}, {@code task_template}, {@code task_template_item}, {@code task_instance}).
 *
 * <p>As with {@link com.wonderedu.assistant.search.application.SearchService}, cross-module access
 * to master-table SQL is performed through {@code NamedParameterJdbcTemplate} and does not introduce
 * Spring bean dependencies beyond {@code shared} / {@code identity}, so the module's
 * {@code allowedDependencies} boundary is preserved.
 *
 * <p>This is the local-application (dev profile) baseline: there is no event bus / publication
 * registry; writes are driven directly from the rebuild job and (future) upsert callers. The
 * read path in {@link com.wonderedu.assistant.search.application.SearchService} continues to query
 * the source tables directly until a later milestone switches it to read from this projection.
 */
@Repository
public class SearchDocumentRepository {

    private static final UUID SYSTEM_ACTOR =
            UUID.nameUUIDFromBytes("assistant-system".getBytes(java.nio.charset.StandardCharsets.UTF_8));

    private final NamedParameterJdbcTemplate jdbc;
    private final IdGenerator idGenerator;

    public SearchDocumentRepository(NamedParameterJdbcTemplate jdbc, IdGenerator idGenerator) {
        this.jdbc = jdbc;
        this.idGenerator = idGenerator;
    }

    /**
     * Idempotent upsert of a single search document. Maintains {@code tsv} via a
     * {@code to_tsvector('simple', ...)} expression on {@code normalized_text} so that the GIN index
     * stays usable for FTS queries.
     *
     * @param organizationId tenant scope
     * @param documentType   one of STUDENT / TEMPLATE / TEMPLATE_ITEM / TASK_INSTANCE
     * @param entityId       source entity id
     * @param title          primary display text (nullable)
     * @param subtitle       secondary display text (nullable)
     * @param normalizedText searchable concatenation used to populate the tsvector
     * @param payload        jsonb payload (may be empty)
     * @param now            write timestamp
     * @return number of rows affected
     */
    public int upsert(
            UUID organizationId,
            String documentType,
            UUID entityId,
            String title,
            String subtitle,
            String normalizedText,
            Map<String, Object> payload,
            Instant now) {
        String sql =
                "INSERT INTO search_document "
                        + "(id, organization_id, document_type, entity_id, title, subtitle, "
                        + "normalized_text, tsv, payload, updated_at) "
                        + "VALUES (:id, :organizationId, :documentType, :entityId, :title, :subtitle, "
                        + ":normalizedText, to_tsvector('simple', coalesce(:normalizedText, '')), "
                        + "cast(:payload AS jsonb), :now) "
                        + "ON CONFLICT (organization_id, document_type, entity_id) DO UPDATE SET "
                        + "title = EXCLUDED.title, "
                        + "subtitle = EXCLUDED.subtitle, "
                        + "normalized_text = EXCLUDED.normalized_text, "
                        + "tsv = EXCLUDED.tsv, "
                        + "payload = EXCLUDED.payload, "
                        + "updated_at = EXCLUDED.updated_at";
        MapSqlParameterSource params =
                new MapSqlParameterSource()
                        .addValue("id", idGenerator.next())
                        .addValue("organizationId", organizationId)
                        .addValue("documentType", documentType)
                        .addValue("entityId", entityId)
                        .addValue("title", title)
                        .addValue("subtitle", subtitle)
                        .addValue("normalizedText", normalizedText)
                        .addValue("payload", payloadJson(payload))
                        .addValue("now", now);
        return jdbc.update(sql, params);
    }

    /**
     * Delete existing projection rows for the organization and re-materialize from the master
     * tables. Each source type is rebuilt in its own batch so a failure partway through leaves
     * the projection populated for at least the already-processed types; the caller may re-run.
     *
     * @param organizationId tenant scope
     * @param now            write timestamp applied to every rebuilt row
     * @return total number of rows written across all document types
     */
    public int rebuildAll(UUID organizationId, Instant now) {
        // Clear the prior generation for this tenant so stale rows do not survive.
        jdbc.update(
                "DELETE FROM search_document WHERE organization_id = :organizationId",
                new MapSqlParameterSource("organizationId", organizationId));

        int total = 0;
        total += rebuildStudents(organizationId, now);
        total += rebuildTemplates(organizationId, now);
        total += rebuildTemplateItems(organizationId, now);
        total += rebuildTaskInstances(organizationId, now);
        return total;
    }

    /** Rebuild STUDENT documents from non-archived students. */
    private int rebuildStudents(UUID organizationId, Instant now) {
        String sql =
                "SELECT id, name, alias, student_code, status "
                        + "FROM student "
                        + "WHERE organization_id = :organizationId";
        List<Map<String, Object>> rows =
                jdbc.queryForList(
                        sql,
                        new MapSqlParameterSource("organizationId", organizationId));
        int count = 0;
        for (Map<String, Object> row : rows) {
            UUID id = (UUID) row.get("id");
            String name = (String) row.get("name");
            String alias = (String) row.get("alias");
            String code = (String) row.get("student_code");
            String status = (String) row.get("status");
            String normalized = joinNonBlank(code, name, alias, status);
            Map<String, Object> payload = new HashMap<>();
            payload.put("studentCode", code);
            payload.put("status", status);
            upsert(organizationId, "STUDENT", id, name, alias, normalized, payload, now);
            count++;
        }
        return count;
    }

    /** Rebuild TEMPLATE documents from non-archived task_template rows. */
    private int rebuildTemplates(UUID organizationId, Instant now) {
        String sql =
                "SELECT id, name, template_code, short_name, subject_code, status "
                        + "FROM task_template "
                        + "WHERE organization_id = :organizationId";
        List<Map<String, Object>> rows =
                jdbc.queryForList(
                        sql,
                        new MapSqlParameterSource("organizationId", organizationId));
        int count = 0;
        for (Map<String, Object> row : rows) {
            UUID id = (UUID) row.get("id");
            String name = (String) row.get("name");
            String code = (String) row.get("template_code");
            String shortName = (String) row.get("short_name");
            String subject = (String) row.get("subject_code");
            String status = (String) row.get("status");
            String normalized = joinNonBlank(code, name, shortName, subject, status);
            Map<String, Object> payload = new HashMap<>();
            payload.put("templateCode", code);
            payload.put("subjectCode", subject);
            payload.put("status", status);
            upsert(organizationId, "TEMPLATE", id, name, shortName, normalized, payload, now);
            count++;
        }
        return count;
    }

    /**
     * Rebuild TEMPLATE_ITEM documents from active task_template_item rows. Organization scoping is
     * reached by joining through {@code task_template_version} → {@code task_template} since
     * {@code task_template_item} itself has no {@code organization_id} column (mirrors the read
     * query in {@link com.wonderedu.assistant.search.application.SearchService}).
     */
    private int rebuildTemplateItems(UUID organizationId, Instant now) {
        String sql =
                "SELECT tti.id, tti.title, tti.short_title, tti.item_code, tt.subject_code "
                        + "FROM task_template_item tti "
                        + "JOIN task_template_version ttv ON tti.template_version_id = ttv.id "
                        + "JOIN task_template tt ON ttv.template_id = tt.id "
                        + "WHERE tt.organization_id = :organizationId "
                        + "AND tti.active = true";
        List<Map<String, Object>> rows =
                jdbc.queryForList(
                        sql,
                        new MapSqlParameterSource("organizationId", organizationId));
        int count = 0;
        for (Map<String, Object> row : rows) {
            UUID id = (UUID) row.get("id");
            String title = (String) row.get("title");
            String shortTitle = (String) row.get("short_title");
            String code = (String) row.get("item_code");
            String subject = (String) row.get("subject_code");
            String normalized = joinNonBlank(code, title, shortTitle, subject);
            Map<String, Object> payload = new HashMap<>();
            payload.put("itemCode", code);
            payload.put("subjectCode", subject);
            upsert(organizationId, "TEMPLATE_ITEM", id, title, shortTitle, normalized, payload, now);
            count++;
        }
        return count;
    }

    /** Rebuild TASK_INSTANCE documents from non-archived task_instance rows. */
    private int rebuildTaskInstances(UUID organizationId, Instant now) {
        String sql =
                "SELECT id, title_snapshot, status, scheduled_date "
                        + "FROM task_instance "
                        + "WHERE organization_id = :organizationId "
                        + "AND status IN ('PENDING', 'COMPLETED', 'CARRIED_OVER', 'SKIPPED', 'CANCELLED')";
        List<Map<String, Object>> rows =
                jdbc.queryForList(
                        sql,
                        new MapSqlParameterSource("organizationId", organizationId));
        int count = 0;
        for (Map<String, Object> row : rows) {
            UUID id = (UUID) row.get("id");
            String title = (String) row.get("title_snapshot");
            String status = (String) row.get("status");
            Object scheduled = row.get("scheduled_date");
            String normalized = joinNonBlank(title, status, scheduled == null ? null : scheduled.toString());
            Map<String, Object> payload = new HashMap<>();
            payload.put("status", status);
            if (scheduled != null) {
                payload.put("scheduledDate", scheduled.toString());
            }
            upsert(organizationId, "TASK_INSTANCE", id, title, status, normalized, payload, now);
            count++;
        }
        return count;
    }

    /**
     * Resolve the actor id for audit columns, falling back to the system actor when no interactive
     * actor is present (e.g. a scheduled / manual rebuild).
     */
    public static UUID systemActorId() {
        return SYSTEM_ACTOR;
    }

    private static String joinNonBlank(String... parts) {
        if (parts == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (String part : parts) {
            if (part != null && !part.isBlank()) {
                if (sb.length() > 0) {
                    sb.append(' ');
                }
                sb.append(part);
            }
        }
        return sb.toString();
    }

    private static String payloadJson(Map<String, Object> payload) {
        if (payload == null || payload.isEmpty()) {
            return "{}";
        }
        // Minimal hand-rolled json for the flat key→string payloads used here; avoids pulling in
        // a JSON library into the search module. Values are expected to be simple scalars.
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Object> entry : payload.entrySet()) {
            if (!first) {
                sb.append(',');
            }
            first = false;
            sb.append('"').append(escape(entry.getKey())).append("\":");
            Object value = entry.getValue();
            if (value == null) {
                sb.append("null");
            } else if (value instanceof Number || value instanceof Boolean) {
                sb.append(value);
            } else {
                sb.append('"').append(escape(value.toString())).append('"');
            }
        }
        sb.append('}');
        return sb.toString();
    }

    private static String escape(String value) {
        if (value == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> sb.append(c);
            }
        }
        return sb.toString();
    }
}
