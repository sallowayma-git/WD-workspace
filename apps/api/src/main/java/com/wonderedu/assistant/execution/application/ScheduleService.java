package com.wonderedu.assistant.execution.application;

import com.wonderedu.assistant.execution.api.ScheduleViews;
import com.wonderedu.assistant.execution.api.ScheduleViews.ScheduleDay;
import com.wonderedu.assistant.execution.api.ScheduleViews.ScheduleResponse;
import com.wonderedu.assistant.execution.api.ScheduleViews.ScheduleTaskSummary;
import com.wonderedu.assistant.planning.api.TaskInstanceView;
import com.wonderedu.assistant.planning.persistence.TaskInstanceRepository;
import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.DomainException;
import com.wonderedu.assistant.shared.TenantContext;
import com.wonderedu.assistant.student.application.AvailabilityService;
import com.wonderedu.assistant.student.application.AvailabilityService.EffectiveAvailability;
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
public class ScheduleService {

    private final NamedParameterJdbcTemplate jdbc;
    private final TaskInstanceRepository taskRepo;
    private final AvailabilityService availabilityService;
    private final BusinessClock clock;
    private final String timezone;

    @org.springframework.beans.factory.annotation.Autowired
    public ScheduleService(
            NamedParameterJdbcTemplate jdbc,
            TaskInstanceRepository taskRepo,
            AvailabilityService availabilityService,
            BusinessClock clock,
            com.wonderedu.assistant.identity.IdentityProperties properties) {
        this(jdbc, taskRepo, availabilityService, clock, properties.businessTimezone());
    }

    ScheduleService(
            NamedParameterJdbcTemplate jdbc,
            TaskInstanceRepository taskRepo,
            AvailabilityService availabilityService,
            BusinessClock clock,
            String timezone) {
        this.jdbc = jdbc;
        this.taskRepo = taskRepo;
        this.availabilityService = availabilityService;
        this.clock = clock;
        this.timezone = timezone;
    }

    @Transactional(readOnly = true)
    public ScheduleResponse getSchedule(UUID studentId, LocalDate fromDate, LocalDate toDate, String view) {
        if (studentId == null) {
            throw new DomainException(422, "SCHEDULE_STUDENT_REQUIRED", "学生不能为空");
        }
        LocalDate businessDate = clock.businessDate(ZoneId.of(timezone));
        LocalDate from = fromDate != null ? fromDate : businessDate;
        int defaultDays = "month".equals(view) ? 30 : "week".equals(view) ? 7 : 1;
        LocalDate to = toDate != null ? toDate : from.plusDays(defaultDays - 1);
        if (to.isBefore(from)) {
            throw new DomainException(422, "SCHEDULE_DATE_RANGE_INVALID", "结束日期不能早于开始日期");
        }
        if (to.toEpochDay() - from.toEpochDay() > 366) {
            throw new DomainException(422, "SCHEDULE_RANGE_TOO_LARGE", "日期范围不能超过 366 天");
        }

        Map<String, Object> student = loadStudent(studentId);
        if (student == null) {
            throw new DomainException(404, "STUDENT_NOT_FOUND", "学生不存在");
        }

        List<TaskInstanceView> tasks = taskRepo.findByStudentAndDateRange(studentId, from, to);
        Map<LocalDate, List<ScheduleTaskSummary>> taskMap = groupByDate(tasks);

        List<ScheduleDay> days = new ArrayList<>();
        for (LocalDate date = from; !date.isAfter(to); date = date.plusDays(1)) {
            EffectiveAvailability avail = availabilityService.resolveEffectiveAvailability(studentId, date);
            List<ScheduleTaskSummary> dayTasks = taskMap.getOrDefault(date, List.of());
            days.add(new ScheduleDay(
                    date,
                    avail.available(),
                    avail.availableMinutes(),
                    avail.devicePolicy(),
                    dayTasks));
        }

        return new ScheduleResponse(
                studentId,
                (String) student.get("name"),
                (String) student.get("student_code"),
                (String) student.get("default_device_policy"),
                from,
                to,
                view != null ? view : "day",
                days);
    }

    private Map<String, Object> loadStudent(UUID studentId) {
        try {
            return jdbc.queryForMap(
                    "SELECT name, student_code, default_device_policy FROM student "
                            + "WHERE id = :id AND organization_id = :orgId AND status <> 'ARCHIVED'",
                    new MapSqlParameterSource()
                            .addValue("id", studentId)
                            .addValue("orgId", TenantContext.requireOrganizationId()));
        } catch (Exception e) {
            return null;
        }
    }

    private Map<LocalDate, List<ScheduleTaskSummary>> groupByDate(List<TaskInstanceView> tasks) {
        Map<LocalDate, List<ScheduleTaskSummary>> result = new HashMap<>();
        for (TaskInstanceView task : tasks) {
            ScheduleTaskSummary summary = new ScheduleTaskSummary(
                    task.id(),
                    task.titleSnapshot(),
                    task.shortTitleSnapshot(),
                    task.status(),
                    task.sourceType(),
                    task.itemOrdinal(),
                    task.durationMinutesSnapshot(),
                    task.locked(),
                    task.version());
            result.computeIfAbsent(task.scheduledDate(), k -> new ArrayList<>()).add(summary);
        }
        return result;
    }
}
