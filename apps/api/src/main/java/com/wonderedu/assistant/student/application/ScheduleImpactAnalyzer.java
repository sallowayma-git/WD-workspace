package com.wonderedu.assistant.student.application;

import com.wonderedu.assistant.shared.DomainException;
import com.wonderedu.assistant.shared.TenantContext;
import com.wonderedu.assistant.student.api.ScheduleImpactView;
import com.wonderedu.assistant.student.api.ScheduleImpactView.AffectedTask;
import com.wonderedu.assistant.student.api.ScheduleImpactView.Summary;
import com.wonderedu.assistant.student.persistence.StudentRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Analyzes the impact of a student's weekly-pattern / availability changes on already-scheduled
 * pending tasks (SDD §9.8).
 *
 * <p>The analyzer does not mutate any task: it returns a preview of the pending tasks whose
 * scheduled date has become non-learnable under the current effective availability, plus a
 * suggested reschedule date. The caller (typically the frontend) must later issue an explicit
 * {@code applyScheduleImpactResolution} command choosing KEEP, MOVE_SUGGESTED or CUSTOM per task.
 *
 * <p>A task is considered affected when, on its {@code scheduled_date}, the resolved effective
 * availability reports either {@code available=false} or {@code availableMinutes=0}, or (when the
 * task requires a device) the resolved device policy is not {@code ALLOWED}. The {@code conflicts}
 * list carries the matching reason codes ({@code DAY_UNAVAILABLE}, {@code DAY_NO_CAPACITY},
 * {@code DEVICE_NOT_ALLOWED}). Locked tasks are reported but flagged {@code locked=true} so the
 * frontend can warn they cannot be auto-moved.
 *
 * <p><b>Module boundary (no planning dependency).</b> This service reads pending task instances
 * directly via {@link NamedParameterJdbcTemplate} (own {@link PendingTask} projection) so the
 * student module does not depend on the planning module — the analyzer only needs task fields
 * (id/status/scheduledDate/locked/requiresDevice) that are owned by the student's schedule view.
 * Tenant isolation is enforced by joining on {@code task_instance.organization_id} from
 * {@link TenantContext}, matching the rest of the student module.
 */
@Service
public class ScheduleImpactAnalyzer {

    static final String CONFLICT_DAY_UNAVAILABLE = "DAY_UNAVAILABLE";
    static final String CONFLICT_DAY_NO_CAPACITY = "DAY_NO_CAPACITY";
    static final String CONFLICT_DEVICE_NOT_ALLOWED = "DEVICE_NOT_ALLOWED";

    /** Horizon (days) for the suggested reschedule date search. */
    static final int SUGGESTION_HORIZON_DAYS = 14;

    /** Local projection of the task fields the analyzer needs (avoids a planning-module dependency). */
    record PendingTask(UUID id, String status, LocalDate scheduledDate, boolean locked, boolean requiresDevice) {}

    private final StudentRepository studentRepository;
    private final NamedParameterJdbcTemplate jdbc;
    private final AvailabilityService availabilityService;

    public ScheduleImpactAnalyzer(
            StudentRepository studentRepository,
            NamedParameterJdbcTemplate jdbc,
            AvailabilityService availabilityService) {
        this.studentRepository = studentRepository;
        this.jdbc = jdbc;
        this.availabilityService = availabilityService;
    }

    /**
     * Returns the pending tasks scheduled in {@code [from, to]} that conflict with the student's
     * current effective availability.
     *
     * @param studentId the student whose schedule is being analyzed
     * @param from inclusive lower bound of the analysis window (must not be null)
     * @param to inclusive upper bound of the analysis window (must not be null, must not be before
     *     {@code from})
     */
    @Transactional(readOnly = true)
    public ScheduleImpactView analyzeImpact(UUID studentId, LocalDate from, LocalDate to) {
        if (studentId == null) {
            throw new DomainException(422, "STUDENT_ID_REQUIRED", "学生 ID 不能为空");
        }
        if (from == null) {
            throw new DomainException(422, "SCHEDULE_IMPACT_FROM_REQUIRED", "起始日期不能为空");
        }
        if (to == null) {
            throw new DomainException(422, "SCHEDULE_IMPACT_TO_REQUIRED", "结束日期不能为空");
        }
        if (to.isBefore(from)) {
            throw new DomainException(
                    422, "SCHEDULE_IMPACT_RANGE_INVALID", "结束日期不能早于起始日期");
        }
        if (studentRepository.findById(studentId).isEmpty()) {
            throw new DomainException(404, "STUDENT_NOT_FOUND", "学生不存在");
        }

        List<PendingTask> tasks = findPendingTasks(studentId, from, to);

        List<AffectedTask> affected = new ArrayList<>();
        for (PendingTask task : tasks) {
            if (!"PENDING".equals(task.status())) {
                continue;
            }
            List<String> conflicts = conflictsFor(studentId, task);
            if (conflicts.isEmpty()) {
                continue;
            }
            LocalDate suggestedDate = suggestDate(studentId, task, to).orElse(null);
            affected.add(
                    new AffectedTask(
                            task.id(),
                            task.scheduledDate(),
                            conflicts,
                            task.locked(),
                            suggestedDate));
        }

        int lockedCount = (int) affected.stream().filter(AffectedTask::locked).count();
        int movableCount = affected.size() - lockedCount;
        Summary summary = new Summary(affected.size(), lockedCount, movableCount);
        return new ScheduleImpactView(List.copyOf(affected), summary);
    }

    /**
     * Loads pending tasks for the student in the analysis window, scoped to the caller's
     * organization. Reads {@code task_instance} directly so the student module does not depend on
     * the planning module's repository.
     */
    private List<PendingTask> findPendingTasks(UUID studentId, LocalDate from, LocalDate to) {
        String sql =
                "SELECT id, status, scheduled_date, locked, requires_device_snapshot "
                        + "FROM task_instance "
                        + "WHERE organization_id = :orgId "
                        + "AND student_id = :studentId "
                        + "AND scheduled_date BETWEEN :fromDate AND :toDate "
                        + "ORDER BY scheduled_date, id";
        return jdbc.query(
                sql,
                new MapSqlParameterSource()
                        .addValue("orgId", TenantContext.requireOrganizationId())
                        .addValue("studentId", studentId)
                        .addValue("fromDate", from)
                        .addValue("toDate", to),
                (rs, rowNum) ->
                        new PendingTask(
                                rs.getObject("id", UUID.class),
                                rs.getString("status"),
                                rs.getDate("scheduled_date") != null
                                        ? rs.getDate("scheduled_date").toLocalDate()
                                        : null,
                                rs.getBoolean("locked"),
                                rs.getBoolean("requires_device_snapshot")));
    }

    private List<String> conflictsFor(UUID studentId, PendingTask task) {
        List<String> conflicts = new ArrayList<>();
        AvailabilityService.EffectiveAvailability avail =
                availabilityService.resolveEffectiveAvailability(studentId, task.scheduledDate());
        if (!avail.available()) {
            conflicts.add(CONFLICT_DAY_UNAVAILABLE);
        } else if (avail.availableMinutes() <= 0) {
            conflicts.add(CONFLICT_DAY_NO_CAPACITY);
        }
        if (task.requiresDevice() && !"ALLOWED".equals(avail.devicePolicy())) {
            conflicts.add(CONFLICT_DEVICE_NOT_ALLOWED);
        }
        return conflicts;
    }

    private Optional<LocalDate> suggestDate(UUID studentId, PendingTask task, LocalDate analysisTo) {
        boolean requiresDevice = task.requiresDevice();
        LocalDate searchFrom = analysisTo.isAfter(task.scheduledDate())
                ? analysisTo
                : task.scheduledDate();
        return availabilityService.findNextAvailableDate(
                studentId,
                searchFrom,
                requiresDevice,
                SUGGESTION_HORIZON_DAYS,
                List.of());
    }
}
