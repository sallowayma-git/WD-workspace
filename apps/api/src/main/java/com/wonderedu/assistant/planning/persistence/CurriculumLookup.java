package com.wonderedu.assistant.planning.persistence;

import com.wonderedu.assistant.shared.TenantContext;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/** Read-only access to curriculum/student tables for planning validations and snapshots. */
@Repository
public class CurriculumLookup {

    private final NamedParameterJdbcTemplate jdbc;

    public CurriculumLookup(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean studentExistsInOrg(UUID studentId) {
        Integer count =
                jdbc.queryForObject(
                        "SELECT count(*) FROM student WHERE organization_id = :organizationId AND id = :studentId",
                        new MapSqlParameterSource()
                                .addValue("organizationId", TenantContext.requireOrganizationId())
                                .addValue("studentId", studentId),
                        Integer.class);
        return count != null && count > 0;
    }

    public record TemplateState(
            UUID templateId,
            UUID versionId,
            String versionStatus,
            String templateStatus,
            int itemCount) {}

    public Optional<TemplateState> findTemplateState(UUID templateId, UUID versionId) {
        return jdbc.query(
                        "SELECT v.id AS version_id, v.status AS version_status, v.item_count, t.status AS template_status "
                                + "FROM task_template_version v JOIN task_template t ON t.id = v.template_id "
                                + "WHERE t.organization_id = :organizationId AND t.id = :templateId AND v.id = :versionId",
                        new MapSqlParameterSource()
                                .addValue("organizationId", TenantContext.requireOrganizationId())
                                .addValue("templateId", templateId)
                                .addValue("versionId", versionId),
                        (rs, rowNum) ->
                                new TemplateState(
                                        templateId,
                                        rs.getObject("version_id", UUID.class),
                                        rs.getString("version_status"),
                                        rs.getString("template_status"),
                                        rs.getInt("item_count")))
                .stream()
                .findFirst();
    }

    public record ItemSnapshot(
            UUID itemId,
            int ordinal,
            String title,
            String shortTitle,
            Integer durationMinutes,
            boolean requiresDevice) {}

    public Optional<ItemSnapshot> findItemByOrdinal(UUID versionId, int ordinal) {
        return jdbc.query(
                        "SELECT id, ordinal, title, short_title, duration_minutes, requires_device "
                                + "FROM task_template_item WHERE template_version_id = :versionId AND ordinal = :ordinal",
                        new MapSqlParameterSource()
                                .addValue("versionId", versionId)
                                .addValue("ordinal", ordinal),
                        (rs, rowNum) ->
                                new ItemSnapshot(
                                        rs.getObject("id", UUID.class),
                                        rs.getInt("ordinal"),
                                        rs.getString("title"),
                                        rs.getString("short_title"),
                                        (Integer) rs.getObject("duration_minutes"),
                                        rs.getBoolean("requires_device")))
                .stream()
                .findFirst();
    }

    public List<ItemSnapshot> findItemsByOrdinalRange(UUID versionId, int fromOrdinal, int toOrdinal) {
        return jdbc.query(
                        "SELECT id, ordinal, title, short_title, duration_minutes, requires_device "
                                + "FROM task_template_item WHERE template_version_id = :versionId "
                                + "AND ordinal BETWEEN :fromOrdinal AND :toOrdinal ORDER BY ordinal",
                        new MapSqlParameterSource()
                                .addValue("versionId", versionId)
                                .addValue("fromOrdinal", fromOrdinal)
                                .addValue("toOrdinal", toOrdinal),
                        (rs, rowNum) ->
                                new ItemSnapshot(
                                        rs.getObject("id", UUID.class),
                                        rs.getInt("ordinal"),
                                        rs.getString("title"),
                                        rs.getString("short_title"),
                                        (Integer) rs.getObject("duration_minutes"),
                                        rs.getBoolean("requires_device")));
    }

    public int countItemsInOrdinalRange(UUID versionId, int fromOrdinal, int toOrdinal) {
        Integer count =
                jdbc.queryForObject(
                        "SELECT count(*) FROM task_template_item WHERE template_version_id = :versionId "
                                + "AND ordinal BETWEEN :fromOrdinal AND :toOrdinal",
                        new MapSqlParameterSource()
                                .addValue("versionId", versionId)
                                .addValue("fromOrdinal", fromOrdinal)
                                .addValue("toOrdinal", toOrdinal),
                        Integer.class);
        return count == null ? 0 : count;
    }
}
