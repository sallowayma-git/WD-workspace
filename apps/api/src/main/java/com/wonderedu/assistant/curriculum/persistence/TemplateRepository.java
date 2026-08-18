package com.wonderedu.assistant.curriculum.persistence;

import com.wonderedu.assistant.curriculum.api.TemplateCommands;
import com.wonderedu.assistant.curriculum.api.TemplateDetailView;
import com.wonderedu.assistant.curriculum.api.TemplateItemUsageView;
import com.wonderedu.assistant.curriculum.api.TemplateItemView;
import com.wonderedu.assistant.curriculum.api.TemplateUsageView;
import com.wonderedu.assistant.curriculum.api.TemplateVersionView;
import com.wonderedu.assistant.curriculum.api.TemplateView;
import com.wonderedu.assistant.shared.ActorContext;
import com.wonderedu.assistant.shared.IdGenerator;
import com.wonderedu.assistant.shared.TenantContext;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class TemplateRepository {

    private static final UUID SYSTEM_ACTOR =
            UUID.nameUUIDFromBytes("assistant-system".getBytes(java.nio.charset.StandardCharsets.UTF_8));

    private final NamedParameterJdbcTemplate jdbc;
    private final IdGenerator idGenerator;

    public TemplateRepository(NamedParameterJdbcTemplate jdbc, IdGenerator idGenerator) {
        this.jdbc = jdbc;
        this.idGenerator = idGenerator;
    }

    public List<TemplateView> findPage(String search, String status, int limit, int offset) {
        StringBuilder sql = new StringBuilder(baseSelect());
        MapSqlParameterSource params = baseParams();
        if (search != null && !search.isBlank()) {
            sql.append(" AND (t.name ILIKE :search OR t.template_code ILIKE :search OR t.short_name ILIKE :search)");
            params.addValue("search", "%" + search.trim() + "%");
        }
        if (status != null && !status.isBlank()) {
            sql.append(" AND t.status = :status");
            params.addValue("status", status);
        } else {
            sql.append(" AND t.status <> 'ARCHIVED'");
        }
        sql.append(" ORDER BY t.name, t.id LIMIT :limit OFFSET :offset");
        params.addValue("limit", limit).addValue("offset", offset);
        return jdbc.query(sql.toString(), params, TemplateRepository::mapRow);
    }

    public long count(String search, String status) {
        StringBuilder sql = new StringBuilder("SELECT count(*) FROM task_template t WHERE t.organization_id = :organizationId");
        MapSqlParameterSource params = baseParams();
        if (search != null && !search.isBlank()) {
            sql.append(" AND (t.name ILIKE :search OR t.template_code ILIKE :search OR t.short_name ILIKE :search)");
            params.addValue("search", "%" + search.trim() + "%");
        }
        if (status != null && !status.isBlank()) {
            sql.append(" AND t.status = :status");
            params.addValue("status", status);
        } else {
            sql.append(" AND t.status <> 'ARCHIVED'");
        }
        Long value = jdbc.queryForObject(sql.toString(), params, Long.class);
        return value == null ? 0 : value;
    }

    public TemplateView insert(UUID templateId, UUID versionId, TemplateCommands.Create command, Instant now) {
        UUID actor = actorId();
        jdbc.update(
                "INSERT INTO task_template (id, organization_id, template_code, name, short_name, subject_code, category_code, unit_label, "
                        + "default_duration_minutes, default_requires_device, status, description, created_at, created_by, updated_at, updated_by, version) "
                        + "VALUES (:id, :organizationId, :code, :name, :shortName, :subjectCode, :categoryCode, :unitLabel, :duration, :requiresDevice, 'DRAFT', :description, :now, :actor, :now, :actor, 0)",
                new MapSqlParameterSource()
                        .addValue("id", templateId)
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("code", command.templateCode())
                        .addValue("name", command.name())
                        .addValue("shortName", command.shortName())
                        .addValue("subjectCode", command.subjectCode())
                        .addValue("categoryCode", command.categoryCode())
                        .addValue("unitLabel", command.unitLabel() == null ? "单元" : command.unitLabel())
                        .addValue("duration", command.defaultDurationMinutes())
                        .addValue("requiresDevice", command.defaultRequiresDevice())
                        .addValue("description", command.description())
                        .addValue("now", now)
                        .addValue("actor", actor));
        jdbc.update(
                "INSERT INTO task_template_version (id, template_id, version_number, status, item_count, created_at, created_by, updated_at, updated_by, version) "
                        + "VALUES (:id, :templateId, 1, 'DRAFT', 0, :now, :actor, :now, :actor, 0)",
                new MapSqlParameterSource()
                        .addValue("id", versionId)
                        .addValue("templateId", templateId)
                        .addValue("now", now)
                        .addValue("actor", actor));
        return findById(templateId).orElseThrow();
    }

    public Optional<TemplateView> findById(UUID id) {
        return jdbc.query(
                        baseSelect() + " AND t.id = :id",
                        baseParams().addValue("id", id),
                        TemplateRepository::mapRow)
                .stream()
                .findFirst();
    }

    public Optional<TemplateDetailView> findDetailById(UUID id) {
        Optional<TemplateView> template = findById(id);
        if (template.isEmpty()) {
            return Optional.empty();
        }
        List<TemplateVersionView> versions = findVersionsByTemplate(id);
        TemplateView view = template.get();
        return Optional.of(
                new TemplateDetailView(
                        view.id(),
                        view.templateCode(),
                        view.name(),
                        view.shortName(),
                        view.subjectCode(),
                        view.categoryCode(),
                        view.unitLabel(),
                        view.defaultDurationMinutes(),
                        view.defaultRequiresDevice(),
                        view.status(),
                        view.currentPublishedVersionId(),
                        view.currentPublishedVersionNumber(),
                        view.currentItemCount(),
                        versions,
                        view.version(),
                        view.updatedAt()));
    }

    public List<TemplateVersionView> findVersionsByTemplate(UUID templateId) {
        return jdbc.query(
                "SELECT v.id, v.template_id, v.version_number, v.status, v.item_count, v.change_note, "
                        + "v.published_at, v.version, v.updated_at FROM task_template_version v "
                        + "JOIN task_template t ON t.id = v.template_id "
                        + "WHERE t.organization_id = :organizationId AND v.template_id = :templateId "
                        + "ORDER BY v.version_number DESC",
                baseParams().addValue("templateId", templateId),
                TemplateRepository::mapVersionRow);
    }

    public List<TemplateItemView> findItemsByVersion(UUID versionId) {
        return jdbc.query(
                "SELECT i.id, i.ordinal, i.item_code, i.title, i.short_title, i.duration_minutes, "
                        + "i.requires_device, i.content_ref, i.instructions, i.active "
                        + "FROM task_template_item i "
                        + "JOIN task_template_version v ON v.id = i.template_version_id "
                        + "JOIN task_template t ON t.id = v.template_id "
                        + "WHERE t.organization_id = :organizationId AND i.template_version_id = :versionId "
                        + "ORDER BY i.ordinal",
                baseParams().addValue("versionId", versionId),
                TemplateRepository::mapItemRow);
    }

    public Optional<TemplateVersionState> findVersion(UUID versionId) {
        return jdbc.query(
                        "SELECT v.id, v.template_id, v.version_number, v.status, v.item_count FROM task_template_version v "
                                + "JOIN task_template t ON t.id = v.template_id WHERE t.organization_id = :organizationId AND v.id = :id",
                        baseParams().addValue("id", versionId),
                        (rs, rowNum) ->
                                new TemplateVersionState(
                                        rs.getObject("id", UUID.class),
                                        rs.getObject("template_id", UUID.class),
                                        rs.getInt("version_number"),
                                        rs.getString("status"),
                                        rs.getInt("item_count")))
                .stream()
                .findFirst();
    }

    /**
     * Locks the template + draft version rows with SELECT ... FOR UPDATE so that
     * concurrent publish attempts on the same draft serialize at the DB layer.
     * Callers must invoke this inside the publish transaction before flipping
     * status to PUBLISHED to prevent double-publish races (BR-012 / AC-012).
     *
     * <p>Locking {@code task_template} guards the {@code current_published_version_id}
     * pointer; locking the {@code task_template_version} row guards the DRAFT→PUBLISHED
     * transition. Both are tenant-scoped to avoid cross-tenant lock contention.
     */
    public void lockForPublish(UUID versionId) {
        // Lock the version row first (the granular, contended resource).
        jdbc.query(
                "SELECT v.id FROM task_template_version v "
                        + "JOIN task_template t ON t.id = v.template_id "
                        + "WHERE t.organization_id = :organizationId AND v.id = :versionId "
                        + "FOR UPDATE",
                baseParams().addValue("versionId", versionId),
                rs -> null);
        // Then lock the parent template row so the current_published_version_id
        // pointer cannot be advanced by a concurrent publish of another version.
        jdbc.query(
                "SELECT t.id FROM task_template t "
                        + "JOIN task_template_version v ON v.id = :versionId AND v.template_id = t.id "
                        + "WHERE t.organization_id = :organizationId "
                        + "FOR UPDATE",
                baseParams().addValue("versionId", versionId),
                rs -> null);
    }

    /**
     * Returns the count of {@code active = true} items attached to the given version,
     * tenant-scoped. Used by publish validation to enforce "at least one active item"
     * (SDD §9.2 step 2) rather than relying solely on the denormalized item_count.
     */
    public int countActiveItems(UUID versionId) {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM task_template_item i "
                        + "JOIN task_template_version v ON v.id = i.template_version_id "
                        + "JOIN task_template t ON t.id = v.template_id "
                        + "WHERE t.organization_id = :organizationId AND i.template_version_id = :versionId AND i.active = true",
                baseParams().addValue("versionId", versionId),
                Integer.class);
        return count == null ? 0 : count;
    }

    public UUID createDraftFromPublished(UUID templateId, UUID publishedVersionId, Instant now) {
        UUID actor = actorId();
        UUID draftVersionId = idGenerator.next();
        Integer nextVersionNumber = jdbc.queryForObject(
                "SELECT COALESCE(MAX(version_number), 0) + 1 FROM task_template_version WHERE template_id = :templateId",
                Map.of("templateId", templateId),
                Integer.class);
        jdbc.update(
                "INSERT INTO task_template_version (id, template_id, version_number, status, item_count, created_at, created_by, updated_at, updated_by, version) "
                        + "VALUES (:id, :templateId, :versionNumber, 'DRAFT', 0, :now, :actor, :now, :actor, 0)",
                new MapSqlParameterSource()
                        .addValue("id", draftVersionId)
                        .addValue("templateId", templateId)
                        .addValue("versionNumber", nextVersionNumber)
                        .addValue("now", now)
                        .addValue("actor", actor));
        List<TemplateItemView> sourceItems = findItemsByVersion(publishedVersionId);
        for (TemplateItemView item : sourceItems) {
            jdbc.update(
                    "INSERT INTO task_template_item (id, template_version_id, ordinal, item_code, title, short_title, duration_minutes, requires_device, content_ref, instructions, active, created_at, created_by, updated_at, updated_by, version) "
                            + "VALUES (:id, :versionId, :ordinal, :itemCode, :title, :shortTitle, :duration, :requiresDevice, :contentRef, :instructions, :active, :now, :actor, :now, :actor, 0)",
                    new MapSqlParameterSource()
                            .addValue("id", idGenerator.next())
                            .addValue("versionId", draftVersionId)
                            .addValue("ordinal", item.ordinal())
                            .addValue("itemCode", item.itemCode())
                            .addValue("title", item.title())
                            .addValue("shortTitle", item.shortTitle())
                            .addValue("duration", item.durationMinutes())
                            .addValue("requiresDevice", item.requiresDevice())
                            .addValue("contentRef", item.contentRef())
                            .addValue("instructions", item.instructions())
                            .addValue("active", item.active())
                            .addValue("now", now)
                            .addValue("actor", actor));
        }
        jdbc.update(
                "UPDATE task_template_version SET item_count = :itemCount, updated_at = :now, updated_by = :actor, version = version + 1 "
                        + "WHERE id = :versionId",
                new MapSqlParameterSource()
                        .addValue("versionId", draftVersionId)
                        .addValue("itemCount", sourceItems.size())
                        .addValue("now", now)
                        .addValue("actor", actor));
        return draftVersionId;
    }

    public void replaceItems(UUID versionId, TemplateCommands.ReplaceItems command, String checksum, Instant now) {
        UUID actor = actorId();
        MapSqlParameterSource versionParams =
                baseParams().addValue("versionId", versionId);
        jdbc.update(
                "DELETE FROM task_template_item WHERE template_version_id = :versionId "
                        + "AND EXISTS (SELECT 1 FROM task_template_version v JOIN task_template t ON t.id = v.template_id "
                        + "WHERE v.id = :versionId AND t.organization_id = :organizationId AND v.status = 'DRAFT')",
                versionParams);
        for (TemplateCommands.Item item : command.items()) {
            jdbc.update(
                    "INSERT INTO task_template_item (id, template_version_id, ordinal, item_code, title, short_title, duration_minutes, requires_device, content_ref, instructions, active, created_at, created_by, updated_at, updated_by, version) "
                            + "VALUES (:id, :versionId, :ordinal, :itemCode, :title, :shortTitle, :duration, :requiresDevice, :contentRef, :instructions, :active, :now, :actor, :now, :actor, 0)",
                    new MapSqlParameterSource()
                            .addValue("id", idGenerator.next())
                            .addValue("versionId", versionId)
                            .addValue("ordinal", item.ordinal())
                            .addValue("itemCode", item.itemCode())
                            .addValue("title", item.title())
                            .addValue("shortTitle", item.shortTitle())
                            .addValue("duration", item.durationMinutes())
                            .addValue("requiresDevice", item.requiresDevice())
                            .addValue("contentRef", item.contentRef())
                            .addValue("instructions", item.instructions())
                            .addValue("active", item.active())
                            .addValue("now", now)
                            .addValue("actor", actor));
        }
        jdbc.update(
                "UPDATE task_template_version SET item_count = :itemCount, checksum = :checksum, change_note = :changeNote, updated_at = :now, updated_by = :actor, version = version + 1 "
                        + "WHERE id = :versionId AND status = 'DRAFT' AND EXISTS (SELECT 1 FROM task_template t WHERE t.id = template_id AND t.organization_id = :organizationId)",
                versionParams
                        .addValue("itemCount", command.items().size())
                        .addValue("checksum", checksum)
                        .addValue("changeNote", command.changeNote())
                        .addValue("now", now)
                        .addValue("actor", actor));
    }

    public void publish(UUID versionId, Instant now) {
        UUID actor = actorId();
        MapSqlParameterSource params = baseParams().addValue("versionId", versionId).addValue("now", now).addValue("actor", actor);
        // SDD §9.2 step 5: retire any other currently-PUBLISHED version of the same template
        // before promoting this draft, so at most one version is PUBLISHED at a time.
        jdbc.update(
                "UPDATE task_template_version SET status = 'RETIRED', updated_at = :now, updated_by = :actor, version = version + 1 "
                        + "WHERE status = 'PUBLISHED' AND template_id = (SELECT template_id FROM task_template_version WHERE id = :versionId) "
                        + "AND id <> :versionId "
                        + "AND EXISTS (SELECT 1 FROM task_template t WHERE t.id = template_id AND t.organization_id = :organizationId)",
                params);
        // TODO(BR-012): publish is not yet idempotent. Re-publishing the same draft after a
        // network retry or double-submit can re-fire side effects (RETIRED flip, audit rows).
        // An idempotency_record keyed by (templateId, versionId, 'PUBLISH') should guard this
        // method; tracked as a separate engineering effort.
        jdbc.update(
                "UPDATE task_template_version SET status = 'PUBLISHED', published_at = :now, published_by = :actor, updated_at = :now, updated_by = :actor, version = version + 1 "
                        + "WHERE id = :versionId AND status = 'DRAFT' AND item_count > 0 AND EXISTS (SELECT 1 FROM task_template t WHERE t.id = template_id AND t.organization_id = :organizationId)",
                params);
        jdbc.update(
                "UPDATE task_template SET status = 'ACTIVE', current_published_version_id = :versionId, updated_at = :now, updated_by = :actor, version = version + 1 "
                        + "WHERE organization_id = :organizationId AND id = (SELECT template_id FROM task_template_version WHERE id = :versionId)",
                params);
    }

    /**
     * Mounted students + current progress + next date for a template (PRD FR-SEARCH-004). Tenant-
     * scoped via {@code student_task_track.organization_id}; the template itself is also verified
     * to belong to the current organization so usage for a foreign template never leaks.
     */
    public List<TemplateUsageView> findTemplateUsage(UUID templateId) {
        return jdbc.query(
                "SELECT tr.id AS track_id, tr.student_id, tr.current_ordinal, tr.end_ordinal, tr.status, "
                        + "tr.next_candidate_date, s.name, s.student_code "
                        + "FROM student_task_track tr "
                        + "JOIN student s ON s.id = tr.student_id "
                        + "JOIN task_template t ON t.id = tr.template_id "
                        + "WHERE tr.organization_id = :organizationId AND tr.template_id = :templateId "
                        + "AND t.organization_id = :organizationId "
                        + "ORDER BY s.name, tr.id",
                baseParams().addValue("templateId", templateId),
                TemplateRepository::mapUsageRow);
    }

    /**
     * Per-item student status + dates for a template item (PRD FR-SEARCH-004). Joins {@code
     * task_instance} to {@code student} and {@code task_template_item} by {@code template_item_id};
     * tenant-scoped via {@code task_instance.organization_id}.
     */
    public List<TemplateItemUsageView> findTemplateItemUsage(UUID itemId) {
        return jdbc.query(
                "SELECT ti.id AS task_id, ti.student_id, ti.status, ti.scheduled_date, "
                        + "ti.original_scheduled_date, ti.item_ordinal, s.name, s.student_code "
                        + "FROM task_instance ti "
                        + "JOIN student s ON s.id = ti.student_id "
                        + "JOIN task_template_item i ON i.id = ti.template_item_id "
                        + "WHERE ti.organization_id = :organizationId AND ti.template_item_id = :itemId "
                        + "ORDER BY ti.scheduled_date DESC NULLS LAST, s.name, ti.id",
                baseParams().addValue("itemId", itemId),
                TemplateRepository::mapItemUsageRow);
    }

    private String baseSelect() {
        return "SELECT t.id, t.template_code, t.name, t.short_name, t.subject_code, t.category_code, t.unit_label, t.default_duration_minutes, t.default_requires_device, t.status, t.current_published_version_id, t.version, t.updated_at, v.version_number AS current_version_number, v.item_count AS current_item_count FROM task_template t LEFT JOIN task_template_version v ON v.id = t.current_published_version_id WHERE t.organization_id = :organizationId";
    }

    private MapSqlParameterSource baseParams() {
        return new MapSqlParameterSource("organizationId", TenantContext.requireOrganizationId());
    }

    private static TemplateView mapRow(ResultSet rs, int rowNum) throws SQLException {
        return new TemplateView(
                rs.getObject("id", UUID.class),
                rs.getString("template_code"),
                rs.getString("name"),
                rs.getString("short_name"),
                rs.getString("subject_code"),
                rs.getString("category_code"),
                rs.getString("unit_label"),
                (Integer) rs.getObject("default_duration_minutes"),
                rs.getBoolean("default_requires_device"),
                rs.getString("status"),
                rs.getObject("current_published_version_id", UUID.class),
                (Integer) rs.getObject("current_version_number"),
                (Integer) rs.getObject("current_item_count"),
                rs.getLong("version"),
                rs.getObject("updated_at", java.time.OffsetDateTime.class).toInstant());
    }

    private static TemplateVersionView mapVersionRow(ResultSet rs, int rowNum) throws SQLException {
        return new TemplateVersionView(
                rs.getObject("id", UUID.class),
                rs.getObject("template_id", UUID.class),
                rs.getInt("version_number"),
                rs.getString("status"),
                rs.getInt("item_count"),
                rs.getString("change_note"),
                rs.getObject("published_at", java.time.OffsetDateTime.class) == null
                        ? null
                        : rs.getObject("published_at", java.time.OffsetDateTime.class).toInstant(),
                rs.getLong("version"),
                rs.getObject("updated_at", java.time.OffsetDateTime.class).toInstant());
    }

    private static TemplateItemView mapItemRow(ResultSet rs, int rowNum) throws SQLException {
        return new TemplateItemView(
                rs.getObject("id", UUID.class),
                rs.getInt("ordinal"),
                rs.getString("item_code"),
                rs.getString("title"),
                rs.getString("short_title"),
                (Integer) rs.getObject("duration_minutes"),
                (Boolean) rs.getObject("requires_device"),
                rs.getString("content_ref"),
                rs.getString("instructions"),
                rs.getBoolean("active"));
    }

    private static TemplateUsageView mapUsageRow(ResultSet rs, int rowNum) throws SQLException {
        return new TemplateUsageView(
                rs.getObject("track_id", UUID.class),
                rs.getObject("student_id", UUID.class),
                rs.getString("name"),
                rs.getString("student_code"),
                rs.getInt("current_ordinal"),
                rs.getInt("end_ordinal"),
                rs.getString("status"),
                rs.getObject("next_candidate_date", java.time.LocalDate.class));
    }

    private static TemplateItemUsageView mapItemUsageRow(ResultSet rs, int rowNum) throws SQLException {
        java.time.LocalDate scheduled = rs.getObject("scheduled_date", java.time.LocalDate.class);
        if (scheduled == null) {
            scheduled = rs.getObject("original_scheduled_date", java.time.LocalDate.class);
        }
        return new TemplateItemUsageView(
                rs.getObject("task_id", UUID.class),
                rs.getObject("student_id", UUID.class),
                rs.getString("name"),
                rs.getString("student_code"),
                rs.getString("status"),
                scheduled,
                (Integer) rs.getObject("item_ordinal"));
    }

    private static UUID actorId() {
        ActorContext.Actor actor = ActorContext.current();
        return actor == null ? SYSTEM_ACTOR : actor.id();
    }

    public record TemplateVersionState(UUID id, UUID templateId, int versionNumber, String status, int itemCount) {}
}
