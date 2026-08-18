package com.wonderedu.assistant.execution.application;

import com.wonderedu.assistant.execution.api.WorkbenchViews;
import com.wonderedu.assistant.execution.api.WorkbenchViews.LocalDateRange;
import com.wonderedu.assistant.execution.api.WorkbenchViews.WorkbenchDayCell;
import com.wonderedu.assistant.execution.api.WorkbenchViews.WorkbenchResponse;
import com.wonderedu.assistant.execution.api.WorkbenchViews.WorkbenchStudentRow;
import com.wonderedu.assistant.execution.api.WorkbenchViews.WorkbenchStudentTag;
import com.wonderedu.assistant.execution.api.WorkbenchViews.WorkbenchTaskSummary;
import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.TenantContext;
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
public class WorkbenchService {

    private final NamedParameterJdbcTemplate jdbc;
    private final BusinessClock clock;
    private final String timezone;

    public WorkbenchService(
            NamedParameterJdbcTemplate jdbc,
            BusinessClock clock,
            com.wonderedu.assistant.identity.IdentityProperties properties) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.timezone = properties.businessTimezone();
    }

    @Transactional(readOnly = true)
    public WorkbenchResponse getWorkbench(LocalDate fromDate, LocalDate toDate) {
        LocalDate businessDate = clock.businessDate(ZoneId.of(timezone));
        LocalDate from = fromDate != null ? fromDate : businessDate;
        LocalDate to = toDate != null ? toDate : from.plusDays(6);
        if (to.toEpochDay() - from.toEpochDay() > 31) {
            to = from.plusDays(30);
        }
        UUID orgId = TenantContext.requireOrganizationId();

        List<WorkbenchStudentRow> rows = buildStudentRows(orgId, from, to);
        return new WorkbenchResponse(new LocalDateRange(from, to), rows);
    }

    private List<WorkbenchStudentRow> buildStudentRows(UUID orgId, LocalDate from, LocalDate to) {
        List<StudentInfo> students = jdbc.query(
                "SELECT s.id, s.name, s.student_code, s.default_device_policy FROM student s "
                        + "WHERE s.organization_id = :orgId AND s.status = 'ACTIVE' ORDER BY s.name, s.id",
                new MapSqlParameterSource("orgId", orgId),
                (rs, rowNum) -> new StudentInfo(
                        rs.getObject("id", UUID.class),
                        rs.getString("name"),
                        rs.getString("student_code"),
                        rs.getString("default_device_policy")));

        if (students.isEmpty()) return List.of();

        List<UUID> studentIds = students.stream().map(StudentInfo::id).toList();

        Map<UUID, List<WorkbenchStudentTag>> tagMap = loadTags(orgId, studentIds);
        Map<UUID, Integer> vocabMap = loadVocabCounts(orgId, studentIds, from, to);
        Map<UUID, Map<LocalDate, List<WorkbenchTaskSummary>>> taskMap = loadTasks(orgId, studentIds, from, to);

        List<WorkbenchStudentRow> rows = new ArrayList<>();
        for (StudentInfo student : students) {
            Map<LocalDate, WorkbenchDayCell> dayCells = new HashMap<>();
            for (LocalDate date = from; !date.isAfter(to); date = date.plusDays(1)) {
                List<WorkbenchTaskSummary> tasks = taskMap
                        .getOrDefault(student.id(), Map.of())
                        .getOrDefault(date, List.of());
                dayCells.put(date, new WorkbenchDayCell(date, true, 0, tasks));
            }
            rows.add(new WorkbenchStudentRow(
                    student.id(),
                    student.name(),
                    student.studentCode(),
                    student.devicePolicy(),
                    tagMap.getOrDefault(student.id(), List.of()),
                    vocabMap.getOrDefault(student.id(), 0),
                    dayCells));
        }
        return rows;
    }

    private Map<UUID, List<WorkbenchStudentTag>> loadTags(UUID orgId, List<UUID> studentIds) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT st.student_id, st.tag_code, st.tag_name_snapshot FROM student_tag st "
                        + "JOIN student s ON s.id = st.student_id AND s.organization_id = :orgId "
                        + "WHERE st.student_id IN (:studentIds)",
                new MapSqlParameterSource()
                        .addValue("orgId", orgId)
                        .addValue("studentIds", studentIds));
        Map<UUID, List<WorkbenchStudentTag>> result = new HashMap<>();
        for (Map<String, Object> row : rows) {
            UUID studentId = (UUID) row.get("student_id");
            result.computeIfAbsent(studentId, k -> new ArrayList<>())
                    .add(new WorkbenchStudentTag(
                            (String) row.get("tag_code"),
                            (String) row.get("tag_name_snapshot")));
        }
        return result;
    }

    private Map<UUID, Integer> loadVocabCounts(UUID orgId, List<UUID> studentIds, LocalDate from, LocalDate to) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT ve.student_id, count(*) AS cnt FROM vocabulary_entry ve "
                        + "JOIN vocabulary_batch vb ON vb.id = ve.batch_id AND vb.organization_id = :orgId "
                        + "WHERE ve.student_id IN (:studentIds) AND ve.status <> 'ARCHIVED' "
                        + "AND vb.occurred_date BETWEEN :from AND :to "
                        + "GROUP BY ve.student_id",
                new MapSqlParameterSource()
                        .addValue("orgId", orgId)
                        .addValue("studentIds", studentIds)
                        .addValue("from", from)
                        .addValue("to", to));
        Map<UUID, Integer> result = new HashMap<>();
        for (Map<String, Object> row : rows) {
            result.put((UUID) row.get("student_id"), ((Number) row.get("cnt")).intValue());
        }
        return result;
    }

    private Map<UUID, Map<LocalDate, List<WorkbenchTaskSummary>>> loadTasks(UUID orgId, List<UUID> studentIds, LocalDate from, LocalDate to) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, student_id, short_title_snapshot, status, scheduled_date, version "
                        + "FROM task_instance WHERE organization_id = :orgId AND student_id IN (:studentIds) "
                        + "AND scheduled_date BETWEEN :from AND :to "
                        + "AND status IN ('PENDING', 'COMPLETED', 'CARRIED_OVER', 'BLOCKED') ORDER BY student_id, scheduled_date, id",
                new MapSqlParameterSource()
                        .addValue("orgId", orgId)
                        .addValue("studentIds", studentIds)
                        .addValue("from", from)
                        .addValue("to", to));
        Map<UUID, Map<LocalDate, List<WorkbenchTaskSummary>>> result = new HashMap<>();
        for (Map<String, Object> row : rows) {
            UUID studentId = (UUID) row.get("student_id");
            java.sql.Date sqlDate = (java.sql.Date) row.get("scheduled_date");
            LocalDate date = sqlDate != null ? sqlDate.toLocalDate() : null;
            if (date == null) continue;
            WorkbenchTaskSummary task = new WorkbenchTaskSummary(
                    (UUID) row.get("id"),
                    (String) row.get("short_title_snapshot"),
                    (String) row.get("status"),
                    ((Number) row.get("version")).longValue());
            result.computeIfAbsent(studentId, k -> new HashMap<>())
                    .computeIfAbsent(date, k -> new ArrayList<>())
                    .add(task);
        }
        return result;
    }

    private record StudentInfo(UUID id, String name, String studentCode, String devicePolicy) {}
}
