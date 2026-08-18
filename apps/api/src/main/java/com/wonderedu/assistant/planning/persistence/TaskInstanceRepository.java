package com.wonderedu.assistant.planning.persistence;

import com.wonderedu.assistant.planning.api.TaskInstanceView;
import com.wonderedu.assistant.shared.ActorContext;
import com.wonderedu.assistant.shared.IdGenerator;
import com.wonderedu.assistant.shared.TenantContext;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class TaskInstanceRepository {

    private static final UUID SYSTEM_ACTOR =
            UUID.nameUUIDFromBytes("assistant-system".getBytes(java.nio.charset.StandardCharsets.UTF_8));

    private final NamedParameterJdbcTemplate jdbc;
    private final IdGenerator idGenerator;

    public TaskInstanceRepository(NamedParameterJdbcTemplate jdbc, IdGenerator idGenerator) {
        this.jdbc = jdbc;
        this.idGenerator = idGenerator;
    }

    private static final String SELECT_COLUMNS =
            "id, organization_id, student_id, source_type, track_id, template_version_id, "
                    + "template_item_id, item_ordinal, scheduled_date, original_scheduled_date, "
                    + "status, title_snapshot, short_title_snapshot, duration_minutes_snapshot, "
                    + "requires_device_snapshot, schedule_origin, manual_override, override_reason, "
                    + "locked, note, carried_from_instance_id, carried_to_instance_id, "
                    + "parent_task_id, linked_parent_task_id, priority, sort_order, star, "
                    + "completed_at, completed_by, cancelled_at, cancelled_by, version, updated_at";

    private static final String SELECT_FOR_UPDATE_SUFFIX = " FOR UPDATE";

    public Optional<TaskInstanceView> findPendingForTrackOrdinal(UUID trackId, int itemOrdinal) {
        return jdbc.query(
                        "SELECT " + SELECT_COLUMNS + " FROM task_instance WHERE organization_id = :organizationId "
                                + "AND track_id = :trackId AND item_ordinal = :itemOrdinal AND status = 'PENDING'",
                        new MapSqlParameterSource()
                                .addValue("organizationId", TenantContext.requireOrganizationId())
                                .addValue("trackId", trackId)
                                .addValue("itemOrdinal", itemOrdinal),
                        TaskInstanceRepository::mapRow)
                .stream()
                .findFirst();
    }

    public Optional<TaskInstanceView> findById(UUID id) {
        return jdbc.query(
                        "SELECT " + SELECT_COLUMNS + " FROM task_instance WHERE organization_id = :organizationId AND id = :id",
                        new MapSqlParameterSource()
                                .addValue("organizationId", TenantContext.requireOrganizationId())
                                .addValue("id", id),
                        TaskInstanceRepository::mapRow)
                .stream()
                .findFirst();
    }

    /**
     * Pessimistic-lock variant of {@link #findById(UUID)} (SDD §19.2). Acquires a row-level
     * {@code FOR UPDATE} lock so the read-then-update sequence is serialized within the current
     * transaction, supplementing the optimistic version check. Callers must invoke this inside a
     * transaction; outside a transaction the lock is a no-op.
     */
    public Optional<TaskInstanceView> findByIdForUpdate(UUID id) {
        return jdbc.query(
                        "SELECT " + SELECT_COLUMNS + " FROM task_instance WHERE organization_id = :organizationId AND id = :id"
                                + SELECT_FOR_UPDATE_SUFFIX,
                        new MapSqlParameterSource()
                                .addValue("organizationId", TenantContext.requireOrganizationId())
                                .addValue("id", id),
                        TaskInstanceRepository::mapRow)
                .stream()
                .findFirst();
    }

    public TaskInstanceView insertTrackInstance(
            UUID id,
            UUID studentId,
            UUID trackId,
            UUID templateVersionId,
            UUID templateItemId,
            int itemOrdinal,
            LocalDate scheduledDate,
            String title,
            String shortTitle,
            Integer durationMinutes,
            boolean requiresDevice,
            String scheduleOrigin,
            boolean manualOverride,
            String overrideReason,
            boolean locked,
            String note,
            UUID carriedFromInstanceId,
            Instant now,
            UUID actor) {
        jdbc.update(
                "INSERT INTO task_instance (id, organization_id, student_id, source_type, track_id, "
                        + "template_version_id, template_item_id, item_ordinal, scheduled_date, original_scheduled_date, "
                        + "status, title_snapshot, short_title_snapshot, duration_minutes_snapshot, "
                        + "requires_device_snapshot, schedule_origin, manual_override, override_reason, "
                        + "locked, note, carried_from_instance_id, priority, sort_order, star, "
                        + "created_at, created_by, updated_at, updated_by, version) VALUES "
                        + "(:id, :organizationId, :studentId, 'TRACK', :trackId, :templateVersionId, :templateItemId, "
                        + ":itemOrdinal, :scheduledDate, :scheduledDate, 'PENDING', :title, :shortTitle, "
                        + ":durationMinutes, :requiresDevice, :scheduleOrigin, :manualOverride, :overrideReason, "
                        + ":locked, :note, :carriedFromInstanceId, 'NONE', 0, false, "
                        + ":now, :actor, :now, :actor, 0)",
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("studentId", studentId)
                        .addValue("trackId", trackId)
                        .addValue("templateVersionId", templateVersionId)
                        .addValue("templateItemId", templateItemId)
                        .addValue("itemOrdinal", itemOrdinal)
                        .addValue("scheduledDate", scheduledDate)
                        .addValue("title", title)
                        .addValue("shortTitle", shortTitle)
                        .addValue("durationMinutes", durationMinutes)
                        .addValue("requiresDevice", requiresDevice)
                        .addValue("scheduleOrigin", scheduleOrigin)
                        .addValue("manualOverride", manualOverride)
                        .addValue("overrideReason", overrideReason)
                        .addValue("locked", locked)
                        .addValue("note", note)
                        .addValue("carriedFromInstanceId", carriedFromInstanceId)
                        .addValue("now", now)
                        .addValue("actor", actor));
        return findById(id).orElseThrow();
    }

    public TaskInstanceView insertAdHocInstance(
            UUID id,
            UUID studentId,
            LocalDate scheduledDate,
            String title,
            String shortTitle,
            Integer durationMinutes,
            Boolean requiresDevice,
            boolean locked,
            String note,
            Instant now,
            UUID actor) {
        jdbc.update(
                "INSERT INTO task_instance (id, organization_id, student_id, source_type, track_id, "
                        + "template_version_id, template_item_id, item_ordinal, scheduled_date, original_scheduled_date, "
                        + "status, title_snapshot, short_title_snapshot, duration_minutes_snapshot, "
                        + "requires_device_snapshot, schedule_origin, manual_override, locked, note, "
                        + "priority, sort_order, star, "
                        + "created_at, created_by, updated_at, updated_by, version) VALUES "
                        + "(:id, :organizationId, :studentId, 'AD_HOC', NULL, NULL, NULL, NULL, :scheduledDate, "
                        + ":scheduledDate, 'PENDING', :title, :shortTitle, :durationMinutes, :requiresDevice, "
                        + ":scheduleOrigin, false, :locked, :note, 'NONE', 0, false, "
                        + ":now, :actor, :now, :actor, 0)",
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("studentId", studentId)
                        .addValue("scheduledDate", scheduledDate)
                        .addValue("title", title)
                        .addValue("shortTitle", shortTitle)
                        .addValue("durationMinutes", durationMinutes)
                        .addValue("requiresDevice", requiresDevice)
                        .addValue("scheduleOrigin", "MANUAL")
                        .addValue("locked", locked)
                        .addValue("note", note)
                        .addValue("now", now)
                        .addValue("actor", actor));
        return findById(id).orElseThrow();
    }

    public int completeTask(UUID taskId, long expectedVersion, Instant now, UUID actor) {
        return jdbc.update(
                "UPDATE task_instance SET status = 'COMPLETED', completed_at = :now, completed_by = :actor, "
                        + "updated_at = :now, updated_by = :actor, version = version + 1 "
                        + "WHERE organization_id = :organizationId AND id = :id AND version = :expectedVersion AND status = 'PENDING'",
                new MapSqlParameterSource()
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("id", taskId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("now", now)
                        .addValue("actor", actor));
    }

    public int reopenTask(UUID taskId, long expectedVersion, Instant now, UUID actor) {
        return jdbc.update(
                "UPDATE task_instance SET status = 'PENDING', completed_at = NULL, completed_by = NULL, "
                        + "updated_at = :now, updated_by = :actor, version = version + 1 "
                        + "WHERE organization_id = :organizationId AND id = :id AND version = :expectedVersion AND status = 'COMPLETED'",
                new MapSqlParameterSource()
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("id", taskId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("now", now)
                        .addValue("actor", actor));
    }

    public int cancelTask(UUID taskId, long expectedVersion, Instant now, UUID actor) {
        return jdbc.update(
                "UPDATE task_instance SET status = 'CANCELLED', cancelled_at = :now, cancelled_by = :actor, "
                        + "updated_at = :now, updated_by = :actor, version = version + 1 "
                        + "WHERE organization_id = :organizationId AND id = :id AND version = :expectedVersion "
                        + "AND status IN ('PENDING', 'BLOCKED')",
                new MapSqlParameterSource()
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("id", taskId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("now", now)
                        .addValue("actor", actor));
    }

    public int carryOverTask(UUID sourceTaskId, UUID newInstanceId, long expectedVersion, Instant now, UUID actor) {
        int updated = jdbc.update(
                "UPDATE task_instance SET status = 'CARRIED_OVER', carried_to_instance_id = :newId, "
                        + "updated_at = :now, updated_by = :actor, version = version + 1 "
                        + "WHERE organization_id = :organizationId AND id = :id AND version = :expectedVersion AND status = 'PENDING' AND locked = false",
                new MapSqlParameterSource()
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("id", sourceTaskId)
                        .addValue("newId", newInstanceId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("now", now)
                        .addValue("actor", actor));
        return updated;
    }

    /**
     * Reverts a single carry-over: restores the source instance to PENDING and clears its
     * carried_to_instance_id link. Guarded by version + CARRIED_OVER status + non-null link.
     */
    public int undoCarryOverSource(UUID sourceTaskId, long expectedVersion, Instant now, UUID actor) {
        return jdbc.update(
                "UPDATE task_instance SET status = 'PENDING', carried_to_instance_id = NULL, "
                        + "updated_at = :now, updated_by = :actor, version = version + 1 "
                        + "WHERE organization_id = :organizationId AND id = :id AND version = :expectedVersion "
                        + "AND status = 'CARRIED_OVER' AND carried_to_instance_id IS NOT NULL",
                new MapSqlParameterSource()
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("id", sourceTaskId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("now", now)
                        .addValue("actor", actor));
    }

    /**
     * Cancels the carry-over target instance (the new PENDING instance created by a prior
     * carry-over) and clears its carried_from_instance_id link. Guarded by version + PENDING
     * status + non-null link so only the exact linked instance is affected.
     */
    public int undoCarryOverTarget(UUID targetTaskId, long expectedVersion, Instant now, UUID actor) {
        return jdbc.update(
                "UPDATE task_instance SET status = 'CANCELLED', cancelled_at = :now, cancelled_by = :actor, "
                        + "carried_from_instance_id = NULL, updated_at = :now, updated_by = :actor, version = version + 1 "
                        + "WHERE organization_id = :organizationId AND id = :id AND version = :expectedVersion "
                        + "AND status = 'PENDING' AND carried_from_instance_id IS NOT NULL",
                new MapSqlParameterSource()
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("id", targetTaskId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("now", now)
                        .addValue("actor", actor));
    }

    public int blockTask(UUID taskId, long expectedVersion, Instant now, UUID actor) {
        return jdbc.update(
                "UPDATE task_instance SET status = 'BLOCKED', updated_at = :now, updated_by = :actor, version = version + 1 "
                        + "WHERE organization_id = :organizationId AND id = :id AND version = :expectedVersion AND status = 'PENDING'",
                new MapSqlParameterSource()
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("id", taskId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("now", now)
                        .addValue("actor", actor));
    }

    public List<TaskInstanceView> findPendingByStudentAndDate(UUID studentId, LocalDate date) {
        return jdbc.query(
                        "SELECT " + SELECT_COLUMNS + " FROM task_instance WHERE organization_id = :organizationId "
                                + "AND student_id = :studentId AND scheduled_date = :date AND status = 'PENDING' AND locked = false "
                                + "ORDER BY sort_order, id",
                        new MapSqlParameterSource()
                                .addValue("organizationId", TenantContext.requireOrganizationId())
                                .addValue("studentId", studentId)
                                .addValue("date", date),
                        TaskInstanceRepository::mapRow);
    }

    public List<TaskInstanceView> findPendingByStudentAndDateRange(UUID studentId, LocalDate fromDate, LocalDate toDate) {
        return jdbc.query(
                        "SELECT " + SELECT_COLUMNS + " FROM task_instance WHERE organization_id = :organizationId "
                                + "AND student_id = :studentId AND scheduled_date <= :toDate AND status = 'PENDING' AND locked = false "
                                + "ORDER BY scheduled_date, sort_order, id",
                        new MapSqlParameterSource()
                                .addValue("organizationId", TenantContext.requireOrganizationId())
                                .addValue("studentId", studentId)
                                .addValue("toDate", toDate),
                        TaskInstanceRepository::mapRow);
    }

    public List<TaskInstanceView> findByStudentAndDateRange(UUID studentId, LocalDate fromDate, LocalDate toDate) {
        return jdbc.query(
                        "SELECT " + SELECT_COLUMNS + " FROM task_instance WHERE organization_id = :organizationId "
                                + "AND student_id = :studentId AND scheduled_date BETWEEN :fromDate AND :toDate "
                                + "ORDER BY scheduled_date, sort_order, id",
                        new MapSqlParameterSource()
                                .addValue("organizationId", TenantContext.requireOrganizationId())
                                .addValue("studentId", studentId)
                                .addValue("fromDate", fromDate)
                                .addValue("toDate", toDate),
                        TaskInstanceRepository::mapRow);
    }

    public List<TaskInstanceView> findPendingCarryOverCandidates(UUID organizationId, LocalDate businessDate, int limit, long offset) {
        return jdbc.query(
                        "SELECT " + SELECT_COLUMNS + " FROM task_instance WHERE organization_id = :organizationId "
                                + "AND scheduled_date <= :businessDate AND status = 'PENDING' AND locked = false "
                                + "ORDER BY scheduled_date, sort_order, id "
                                + "LIMIT :limit OFFSET :offset",
                        new MapSqlParameterSource()
                                .addValue("organizationId", organizationId)
                                .addValue("businessDate", businessDate)
                                .addValue("limit", limit)
                                .addValue("offset", offset),
                        TaskInstanceRepository::mapRow);
    }

    public int rescheduleTask(UUID taskId, long expectedVersion, LocalDate targetDate, String overrideReason, Instant now, UUID actor) {
        return jdbc.update(
                "UPDATE task_instance SET scheduled_date = :targetDate, schedule_origin = 'MANUAL', "
                        + "manual_override = true, override_reason = :reason, "
                        + "updated_at = :now, updated_by = :actor, version = version + 1 "
                        + "WHERE organization_id = :organizationId AND id = :id AND version = :expectedVersion "
                        + "AND status IN ('PENDING', 'BLOCKED')",
                new MapSqlParameterSource()
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("id", taskId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("targetDate", targetDate)
                        .addValue("reason", overrideReason)
                        .addValue("now", now)
                        .addValue("actor", actor));
    }

    public int setLocked(UUID taskId, long expectedVersion, boolean locked, Instant now, UUID actor) {
        return jdbc.update(
                "UPDATE task_instance SET locked = :locked, updated_at = :now, updated_by = :actor, version = version + 1 "
                        + "WHERE organization_id = :organizationId AND id = :id AND version = :expectedVersion "
                        + "AND status IN ('PENDING', 'BLOCKED')",
                new MapSqlParameterSource()
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("id", taskId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("locked", locked)
                        .addValue("now", now)
                        .addValue("actor", actor));
    }

    /**
     * TickTick-style task update. Applies user-editable fields (title, note, priority, star) under
     * optimistic-lock guard. Null field values leave the existing column value untouched so callers
     * can issue partial PATCH updates without overwriting fields they did not change.
     */
    public int updateTask(
            UUID taskId,
            long expectedVersion,
            String title,
            String shortTitle,
            String note,
            String priority,
            Boolean star,
            Instant now,
            UUID actor) {
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("organizationId", TenantContext.requireOrganizationId())
                .addValue("id", taskId)
                .addValue("expectedVersion", expectedVersion)
                .addValue("now", now)
                .addValue("actor", actor);
        StringBuilder sql = new StringBuilder(
                "UPDATE task_instance SET updated_at = :now, updated_by = :actor, version = version + 1 ");
        if (title != null) {
            sql.append(", title_snapshot = :title");
            params.addValue("title", title);
        }
        if (shortTitle != null) {
            sql.append(", short_title_snapshot = :shortTitle");
            params.addValue("shortTitle", shortTitle);
        }
        if (note != null) {
            sql.append(", note = :note");
            params.addValue("note", note);
        }
        if (priority != null) {
            sql.append(", priority = :priority");
            params.addValue("priority", priority);
        }
        if (star != null) {
            sql.append(", star = :star");
            params.addValue("star", star);
        }
        sql.append(" WHERE organization_id = :organizationId AND id = :id AND version = :expectedVersion");
        return jdbc.update(sql.toString(), params);
    }

    /**
     * Marks a task instance as physically deleted by issuing a row delete. The deletion is guarded
     * by optimistic version check + tenant scoping. Only callers that have already validated the
     * source-type constraint (AD_HOC or track_id IS NULL) should invoke this; TRACK tasks must be
     * cancelled rather than deleted.
     */
    public int deleteTask(UUID taskId, long expectedVersion, Instant now, UUID actor) {
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("organizationId", TenantContext.requireOrganizationId())
                .addValue("id", taskId)
                .addValue("expectedVersion", expectedVersion)
                .addValue("now", now)
                .addValue("actor", actor);
        // Note: deleted_at audit columns are not present on the table; physical delete is used for
        // AD_HOC/IMPORT tasks only. The before-snapshot is captured by the caller before delete.
        return jdbc.update(
                "DELETE FROM task_instance WHERE organization_id = :organizationId AND id = :id "
                        + "AND version = :expectedVersion "
                        + "AND (source_type = 'AD_HOC' OR source_type = 'IMPORT' OR track_id IS NULL)",
                params);
    }

    /**
     * Reorders a task instance by setting its {@code sort_order}. Guarded by optimistic version +
     * tenant scope. The caller controls the new sort order value (absolute positioning model).
     */
    public int reorderTask(UUID taskId, long expectedVersion, int newSortOrder, Instant now, UUID actor) {
        return jdbc.update(
                "UPDATE task_instance SET sort_order = :sortOrder, updated_at = :now, updated_by = :actor, "
                        + "version = version + 1 "
                        + "WHERE organization_id = :organizationId AND id = :id AND version = :expectedVersion",
                new MapSqlParameterSource()
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("id", taskId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("sortOrder", newSortOrder)
                        .addValue("now", now)
                        .addValue("actor", actor));
    }

    /**
     * Associates a task instance with a linked main task (non-parent-child link) by setting
     * {@code linked_parent_task_id}. Guarded by optimistic version + tenant scope.
     */
    public int linkMainTask(UUID taskId, long expectedVersion, UUID linkedParentTaskId, Instant now, UUID actor) {
        return jdbc.update(
                "UPDATE task_instance SET linked_parent_task_id = :linkedParentId, updated_at = :now, "
                        + "updated_by = :actor, version = version + 1 "
                        + "WHERE organization_id = :organizationId AND id = :id AND version = :expectedVersion",
                new MapSqlParameterSource()
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("id", taskId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("linkedParentId", linkedParentTaskId)
                        .addValue("now", now)
                        .addValue("actor", actor));
    }

    /**
     * Inserts an AD_HOC sub-task that points at a parent task via {@code parent_task_id}. Inherits
     * the parent's student_id and defaults priority/sort_order/star; the caller may override
     * priority. Used by {@code CreateSubTask} command.
     */
    public TaskInstanceView insertSubTaskInstance(
            UUID id,
            UUID studentId,
            UUID parentTaskId,
            LocalDate scheduledDate,
            String title,
            String shortTitle,
            String priority,
            Instant now,
            UUID actor) {
        jdbc.update(
                "INSERT INTO task_instance (id, organization_id, student_id, source_type, track_id, "
                        + "template_version_id, template_item_id, item_ordinal, scheduled_date, original_scheduled_date, "
                        + "status, title_snapshot, short_title_snapshot, duration_minutes_snapshot, "
                        + "requires_device_snapshot, schedule_origin, manual_override, locked, note, "
                        + "parent_task_id, priority, sort_order, star, created_at, created_by, updated_at, updated_by, version) VALUES "
                        + "(:id, :organizationId, :studentId, 'AD_HOC', NULL, NULL, NULL, NULL, :scheduledDate, "
                        + ":scheduledDate, 'PENDING', :title, :shortTitle, NULL, NULL, 'MANUAL', false, false, NULL, "
                        + ":parentTaskId, :priority, 0, false, :now, :actor, :now, :actor, 0)",
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("studentId", studentId)
                        .addValue("parentTaskId", parentTaskId)
                        .addValue("scheduledDate", scheduledDate)
                        .addValue("title", title)
                        .addValue("shortTitle", shortTitle)
                        .addValue("priority", priority)
                        .addValue("now", now)
                        .addValue("actor", actor));
        return findById(id).orElseThrow();
    }

    /**
     * Duplicates a task instance into a new AD_HOC instance on the target date (or the source's
     * scheduled date when the caller omits {@code targetDate}). Copies editable fields (title,
     * note, priority, star) and inherits the source's student_id; the duplicate starts at PENDING
     * and resets all carry-over/completion/cancellation audit columns. Used by {@code DuplicateTask}
     * command.
     */
    public TaskInstanceView duplicateTaskInstance(
            UUID id,
            UUID studentId,
            LocalDate scheduledDate,
            String title,
            String shortTitle,
            Integer durationMinutes,
            Boolean requiresDevice,
            boolean locked,
            String note,
            String priority,
            boolean star,
            Instant now,
            UUID actor) {
        jdbc.update(
                "INSERT INTO task_instance (id, organization_id, student_id, source_type, track_id, "
                        + "template_version_id, template_item_id, item_ordinal, scheduled_date, original_scheduled_date, "
                        + "status, title_snapshot, short_title_snapshot, duration_minutes_snapshot, "
                        + "requires_device_snapshot, schedule_origin, manual_override, locked, note, "
                        + "priority, sort_order, star, created_at, created_by, updated_at, updated_by, version) VALUES "
                        + "(:id, :organizationId, :studentId, 'AD_HOC', NULL, NULL, NULL, NULL, :scheduledDate, "
                        + ":scheduledDate, 'PENDING', :title, :shortTitle, :durationMinutes, :requiresDevice, "
                        + ":scheduleOrigin, false, :locked, :note, :priority, 0, :star, :now, :actor, :now, :actor, 0)",
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("organizationId", TenantContext.requireOrganizationId())
                        .addValue("studentId", studentId)
                        .addValue("scheduledDate", scheduledDate)
                        .addValue("title", title)
                        .addValue("shortTitle", shortTitle)
                        .addValue("durationMinutes", durationMinutes)
                        .addValue("requiresDevice", requiresDevice)
                        .addValue("scheduleOrigin", "MANUAL")
                        .addValue("locked", locked)
                        .addValue("note", note)
                        .addValue("priority", priority)
                        .addValue("star", star)
                        .addValue("now", now)
                        .addValue("actor", actor));
        return findById(id).orElseThrow();
    }

    private static TaskInstanceView mapRow(ResultSet rs, int rowNum) throws SQLException {
        return new TaskInstanceView(
                rs.getObject("id", UUID.class),
                rs.getObject("student_id", UUID.class),
                rs.getString("source_type"),
                rs.getObject("track_id", UUID.class),
                rs.getObject("template_version_id", UUID.class),
                rs.getObject("template_item_id", UUID.class),
                (Integer) rs.getObject("item_ordinal"),
                rs.getObject("scheduled_date", LocalDate.class),
                rs.getObject("original_scheduled_date", LocalDate.class),
                rs.getString("status"),
                rs.getString("title_snapshot"),
                rs.getString("short_title_snapshot"),
                (Integer) rs.getObject("duration_minutes_snapshot"),
                rs.getObject("requires_device_snapshot") == null
                        ? null
                        : rs.getBoolean("requires_device_snapshot"),
                rs.getString("schedule_origin"),
                rs.getBoolean("manual_override"),
                rs.getString("override_reason"),
                rs.getBoolean("locked"),
                rs.getString("note"),
                rs.getObject("carried_from_instance_id", UUID.class),
                rs.getObject("carried_to_instance_id", UUID.class),
                rs.getObject("completed_at") == null
                        ? null
                        : rs.getObject("completed_at", java.time.OffsetDateTime.class).toInstant(),
                rs.getObject("completed_by", UUID.class),
                rs.getObject("cancelled_at") == null
                        ? null
                        : rs.getObject("cancelled_at", java.time.OffsetDateTime.class).toInstant(),
                rs.getObject("cancelled_by", UUID.class),
                rs.getObject("parent_task_id", UUID.class),
                rs.getObject("linked_parent_task_id", UUID.class),
                rs.getString("priority"),
                rs.getInt("sort_order"),
                rs.getBoolean("star"),
                rs.getLong("version"),
                rs.getObject("updated_at", java.time.OffsetDateTime.class).toInstant());
    }

    public static UUID actorId() {
        ActorContext.Actor actor = ActorContext.current();
        return actor == null ? SYSTEM_ACTOR : actor.id();
    }

    public IdGenerator idGenerator() {
        return idGenerator;
    }
}
