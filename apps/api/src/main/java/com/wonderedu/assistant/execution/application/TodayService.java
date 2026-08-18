package com.wonderedu.assistant.execution.application;

import com.wonderedu.assistant.execution.api.TodayViews;
import com.wonderedu.assistant.execution.api.TodayViews.CarryOverItem;
import com.wonderedu.assistant.execution.api.TodayViews.TodayMetrics;
import com.wonderedu.assistant.execution.api.TodayViews.TodayResponse;
import com.wonderedu.assistant.execution.api.TodayViews.TodayStudentGroup;
import com.wonderedu.assistant.execution.api.TodayViews.TodayTaskSummary;
import com.wonderedu.assistant.planning.api.TaskInstanceView;
import com.wonderedu.assistant.planning.persistence.TaskInstanceRepository;
import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.TenantContext;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TodayService {

    private final NamedParameterJdbcTemplate jdbc;
    private final TaskInstanceRepository taskRepo;
    private final BusinessClock clock;
    private final String timezone;

    @org.springframework.beans.factory.annotation.Autowired
    public TodayService(
            NamedParameterJdbcTemplate jdbc,
            TaskInstanceRepository taskRepo,
            BusinessClock clock,
            com.wonderedu.assistant.identity.IdentityProperties properties) {
        this(jdbc, taskRepo, clock, properties.businessTimezone());
    }

    TodayService(
            NamedParameterJdbcTemplate jdbc,
            TaskInstanceRepository taskRepo,
            BusinessClock clock,
            String timezone) {
        this.jdbc = jdbc;
        this.taskRepo = taskRepo;
        this.clock = clock;
        this.timezone = timezone;
    }

    @Transactional(readOnly = true)
    public TodayResponse getToday(LocalDate date, UUID assistantId) {
        LocalDate businessDate = date != null ? date : clock.businessDate(ZoneId.of(timezone));
        UUID orgId = TenantContext.requireOrganizationId();

        List<TodayStudentGroup> groups = buildStudentGroups(orgId, businessDate, assistantId);
        TodayMetrics metrics = buildMetrics(orgId, businessDate);

        return new TodayResponse(businessDate, metrics, groups);
    }

    /**
     * Returns the carry-over list for a target date (PRD AC-006/014, FR-TODAY-006).
     * Each row is a task instance with status=CARRIED_OVER whose new PENDING instance
     * was scheduled on {@code targetDate}. We join student (for the name) and the
     * carried_to target instance (for the target date / schedule origin).
     */
    @Transactional(readOnly = true)
    public List<CarryOverItem> getCarryovers(LocalDate targetDate) {
        if (targetDate == null) {
            targetDate = clock.businessDate(ZoneId.of(timezone));
        }
        UUID orgId = TenantContext.requireOrganizationId();
        String sql = "SELECT src.id AS source_id, tgt.id AS target_id, tgt.scheduled_date AS target_date, "
                + "src.scheduled_date AS original_date, src.student_id AS student_id, s.name AS student_name, "
                + "src.title_snapshot AS title, src.override_reason AS reason, tgt.schedule_origin AS schedule_origin, "
                + "src.updated_at AS executed_at, src.version AS version "
                + "FROM task_instance src "
                + "JOIN student s ON s.id = src.student_id "
                + "LEFT JOIN task_instance tgt ON tgt.id = src.carried_to_instance_id "
                + "AND tgt.scheduled_date = :targetDate "
                + "WHERE src.organization_id = :orgId "
                + "AND src.status = 'CARRIED_OVER' "
                + "ORDER BY src.updated_at DESC, src.id";

        return jdbc.query(sql, new MapSqlParameterSource()
                        .addValue("orgId", orgId)
                        .addValue("targetDate", targetDate),
                (rs, rowNum) -> {
                    String scheduleOrigin = rs.getString("schedule_origin");
                    java.sql.Date targetDateRs = rs.getDate("target_date");
                    return new CarryOverItem(
                            rs.getObject("source_id", UUID.class),
                            rs.getObject("target_id", UUID.class),
                            rs.getObject("student_id", UUID.class),
                            rs.getString("student_name"),
                            rs.getDate("original_date") != null
                                    ? rs.getDate("original_date").toLocalDate()
                                    : null,
                            targetDateRs != null
                                    ? targetDateRs.toLocalDate()
                                    : null,
                            rs.getString("title"),
                            rs.getString("reason"),
                            inferRule(scheduleOrigin, targetDateRs),
                            scheduleOrigin,
                            rs.getTimestamp("executed_at") != null
                                    ? rs.getTimestamp("executed_at").toInstant()
                                    : null,
                            rs.getLong("version"));
                });
    }

    /**
     * Infers the carry-over rule identifier (PRD AC-014 transparency requirement).
     * BR-007: AUTO-scheduled targets on the next available learnable day map to
     * NEXT_AVAILABLE_DAY. MANUAL overrides expose the origin verbatim; CARRYOVER
     * lineage or orphaned rows fall back to CARRYOVER.
     */
    private static String inferRule(String scheduleOrigin, java.sql.Date targetDate) {
        if ("AUTO".equals(scheduleOrigin) && targetDate != null) {
            return "NEXT_AVAILABLE_DAY";
        }
        if ("MANUAL".equals(scheduleOrigin)) {
            return "MANUAL";
        }
        return "CARRYOVER";
    }

    private List<TodayStudentGroup> buildStudentGroups(UUID orgId, LocalDate date, UUID assistantId) {
        StringBuilder studentSql = new StringBuilder(
                "SELECT s.id, s.name, s.student_code, s.default_device_policy "
                        + "FROM student s WHERE s.organization_id = :orgId AND s.status = 'ACTIVE'");
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("orgId", orgId)
                .addValue("date", date);
        if (assistantId != null) {
            studentSql.append(" AND s.primary_assistant_id = :assistantId");
            params.addValue("assistantId", assistantId);
        }
        studentSql.append(" ORDER BY s.name, s.id");

        List<StudentRow> students = jdbc.query(studentSql.toString(), params, (rs, rowNum) ->
                new StudentRow(
                        rs.getObject("id", UUID.class),
                        rs.getString("name"),
                        rs.getString("student_code"),
                        rs.getString("default_device_policy")));

        if (students.isEmpty()) {
            return List.of();
        }

        List<UUID> studentIds = students.stream().map(StudentRow::id).toList();
        Map<UUID, List<TodayTaskSummary>> taskMap = loadTasks(orgId, date, studentIds);

        List<TodayStudentGroup> groups = new ArrayList<>();
        for (StudentRow student : students) {
            List<TodayTaskSummary> tasks = taskMap.getOrDefault(student.id(), List.of());
            groups.add(new TodayStudentGroup(
                    student.id(),
                    student.name(),
                    student.studentCode(),
                    student.devicePolicy(),
                    tasks));
        }
        return groups;
    }

    private Map<UUID, List<TodayTaskSummary>> loadTasks(UUID orgId, LocalDate date, List<UUID> studentIds) {
        String taskSql = "SELECT id, student_id, title_snapshot, short_title_snapshot, status, source_type, "
                + "item_ordinal, duration_minutes_snapshot, locked, scheduled_date, version "
                + "FROM task_instance WHERE organization_id = :orgId AND scheduled_date = :date "
                + "AND student_id IN (:studentIds) AND status IN ('PENDING', 'COMPLETED', 'CARRIED_OVER', 'BLOCKED') "
                + "ORDER BY student_id, CASE WHEN status = 'BLOCKED' THEN 0 WHEN status = 'PENDING' THEN 1 ELSE 2 END, id";

        List<Map<String, Object>> rows = jdbc.queryForList(taskSql, new MapSqlParameterSource()
                .addValue("orgId", orgId)
                .addValue("date", date)
                .addValue("studentIds", studentIds));

        Map<UUID, List<TodayTaskSummary>> result = new HashMap<>();
        for (Map<String, Object> row : rows) {
            UUID studentId = (UUID) row.get("student_id");
            TodayTaskSummary task = new TodayTaskSummary(
                    (UUID) row.get("id"),
                    (String) row.get("title_snapshot"),
                    (String) row.get("short_title_snapshot"),
                    (String) row.get("status"),
                    (String) row.get("source_type"),
                    (Integer) row.get("item_ordinal"),
                    (Integer) row.get("duration_minutes_snapshot"),
                    (Boolean) row.get("locked"),
                    "CARRIED_OVER".equals(row.get("status")),
                    (java.sql.Date) row.get("scheduled_date") != null
                            ? ((java.sql.Date) row.get("scheduled_date")).toLocalDate()
                            : null,
                    ((Number) row.get("version")).longValue());
            result.computeIfAbsent(studentId, k -> new ArrayList<>()).add(task);
        }
        return result;
    }

    private TodayMetrics buildMetrics(UUID orgId, LocalDate date) {
        String sql = "SELECT "
                + "COUNT(DISTINCT student_id) FILTER (WHERE status IN ('PENDING','COMPLETED','CARRIED_OVER','BLOCKED')) AS total_students, "
                + "COUNT(*) FILTER (WHERE status = 'PENDING') AS pending, "
                + "COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed, "
                + "COUNT(*) FILTER (WHERE status = 'CARRIED_OVER') AS carried, "
                + "COUNT(*) FILTER (WHERE status = 'BLOCKED') AS blocked "
                + "FROM task_instance WHERE organization_id = :orgId AND scheduled_date = :date";

        Map<String, Object> row = jdbc.queryForList(sql, new MapSqlParameterSource()
                        .addValue("orgId", orgId)
                        .addValue("date", date))
                .stream()
                .findFirst()
                .orElse(Map.of());

        return new TodayMetrics(
                toInt(row.get("total_students")),
                toInt(row.get("pending")),
                toInt(row.get("completed")),
                toInt(row.get("carried")),
                toInt(row.get("blocked")),
                0);
    }

    private static int toInt(Object value) {
        if (value == null) return 0;
        if (value instanceof Number n) return n.intValue();
        return 0;
    }

    private record StudentRow(UUID id, String name, String studentCode, String devicePolicy) {}
}
