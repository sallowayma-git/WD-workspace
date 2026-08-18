package com.wonderedu.assistant.student.application;

import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.DomainException;
import com.wonderedu.assistant.student.api.WeekPlanCommands;
import com.wonderedu.assistant.student.api.WeekPlanView;
import com.wonderedu.assistant.student.api.WeeklyPatternView;
import com.wonderedu.assistant.student.persistence.StudentRepository;
import com.wonderedu.assistant.student.persistence.WeekPlanRepository;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Application service for weekly pattern and week plan management (SDD §9.1).
 *
 * <p>Implements the four endpoints in SDD §11.4: GET/PUT weekly-pattern and GET/PUT week-plans.
 * The service relies on {@link StudentRepository} to verify the student exists and on {@link
 * WeekPlanRepository} for the schedule persistence.
 */
@Service
public class WeekPlanService {

    private static final Set<String> DEVICE_POLICIES = Set.of("ALLOWED", "NOT_ALLOWED", "CONFIRM");
    private static final Set<String> WEEK_PLAN_SOURCES = Set.of("BASE_PATTERN", "PREVIOUS_WEEK", "MANUAL");

    private final WeekPlanRepository repository;
    private final StudentRepository studentRepository;
    private final BusinessClock clock;
    private final String timezone;

    @org.springframework.beans.factory.annotation.Autowired
    public WeekPlanService(
            WeekPlanRepository repository,
            StudentRepository studentRepository,
            BusinessClock clock,
            com.wonderedu.assistant.identity.IdentityProperties properties) {
        this(repository, studentRepository, clock, properties.businessTimezone());
    }

    WeekPlanService(
            WeekPlanRepository repository,
            StudentRepository studentRepository,
            BusinessClock clock,
            String timezone) {
        this.repository = repository;
        this.studentRepository = studentRepository;
        this.clock = clock;
        this.timezone = timezone;
    }

    // ------------------------------------------------------------------
    // Weekly pattern
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public WeeklyPatternView getWeeklyPattern(UUID studentId) {
        requireStudent(studentId);
        return repository
                .findActivePattern(studentId)
                .orElseThrow(
                        () -> new DomainException(404, "WEEKLY_PATTERN_NOT_FOUND", "学生常规周不存在"));
    }

    @Transactional
    public WeeklyPatternView saveWeeklyPattern(
            UUID studentId, WeekPlanCommands.SaveWeeklyPattern command) {
        requireStudent(studentId);
        validateWeeklyPattern(command);
        Instant now = clock.now();
        LocalDate effectiveFrom = command.effectiveFrom();
        if (effectiveFrom == null) {
            effectiveFrom = clock.businessDate(ZoneId.of(timezone));
        }
        repository.retireActivePattern(studentId, effectiveFrom, now);
        repository.insertPattern(studentId, effectiveFrom, command.days(), now);
        return repository
                .findActivePattern(studentId)
                .orElseThrow(
                        () -> new DomainException(500, "WEEKLY_PATTERN_SAVE_FAILED", "常规周保存失败"));
    }

    private void validateWeeklyPattern(WeekPlanCommands.SaveWeeklyPattern command) {
        if (command == null || command.days() == null || command.days().size() != 7) {
            throw new DomainException(422, "WEEKLY_PATTERN_DAYS_REQUIRED", "常规周必须提供 7 天数据");
        }
        Set<Integer> seen = new HashSet<>();
        for (WeekPlanCommands.SaveWeeklyPattern.DayItem day : command.days()) {
            if (day.dayOfWeek() < 1 || day.dayOfWeek() > 7) {
                throw new DomainException(
                        422, "WEEKLY_PATTERN_DAY_INVALID", "星期序号必须在 1 到 7 之间");
            }
            if (!seen.add(day.dayOfWeek())) {
                throw new DomainException(
                        422, "WEEKLY_PATTERN_DAY_DUPLICATE", "星期序号不能重复");
            }
            if (day.availableMinutes() < 0 || day.availableMinutes() > 1440) {
                throw new DomainException(
                        422, "WEEKLY_PATTERN_MINUTES_INVALID", "可用分钟必须在 0 到 1440 之间");
            }
            if (day.devicePolicyOverride() != null
                    && !DEVICE_POLICIES.contains(day.devicePolicyOverride())) {
                throw new DomainException(
                        422, "WEEKLY_PATTERN_DEVICE_POLICY_INVALID", "设备策略无效");
            }
        }
    }

    // ------------------------------------------------------------------
    // Week plan
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public WeekPlanView getWeekPlan(UUID studentId, LocalDate weekStart) {
        requireStudent(studentId);
        requireMonday(weekStart);
        return repository
                .findWeekPlan(studentId, weekStart)
                .orElseThrow(() -> new DomainException(404, "WEEK_PLAN_NOT_FOUND", "周计划不存在"));
    }

    @Transactional
    public WeekPlanView saveWeekPlan(UUID studentId, LocalDate weekStart, WeekPlanCommands.SaveWeekPlan command) {
        requireStudent(studentId);
        requireMonday(weekStart);
        if (command == null) {
            throw new DomainException(422, "WEEK_PLAN_COMMAND_REQUIRED", "周计划命令不能为空");
        }
        String sourceType = command.sourceType();
        if (sourceType == null || !WEEK_PLAN_SOURCES.contains(sourceType)) {
            throw new DomainException(422, "WEEK_PLAN_SOURCE_INVALID", "周计划来源类型无效");
        }
        Instant now = clock.now();

        Optional<WeekPlanView> existing = repository.findWeekPlan(studentId, weekStart);
        if (existing.isPresent()) {
            WeekPlanView existingPlan = existing.get();
            String status = existingPlan.status();
            if ("DRAFT".equals(status)) {
                if (!command.replaceDraft()) {
                    throw new DomainException(
                            409,
                            "WEEK_PLAN_DRAFT_EXISTS",
                            "该周已存在草稿，需显式确认替换");
                }
                repository.deleteWeekPlan(existingPlan.id(), now);
            } else {
                throw new DomainException(
                        409,
                        "WEEK_PLAN_NOT_DRAFT",
                        "已确认或已关闭的周计划不允许覆盖");
            }
        }

        UUID sourceId = null;
        List<WeekPlanRepository.DayAvailabilitySeed> seeds = generateSeeds(studentId, weekStart, sourceType);
        if (sourceType.equals("BASE_PATTERN")) {
            sourceId = repository
                    .findActivePattern(studentId)
                    .map(WeeklyPatternView::id)
                    .orElse(null);
        } else if (sourceType.equals("PREVIOUS_WEEK")) {
            sourceId = repository
                    .findPreviousWeekPlan(studentId, weekStart)
                    .map(WeekPlanView::id)
                    .orElse(null);
        }
        repository.insertWeekPlan(studentId, weekStart, sourceType, sourceId, seeds, now);
        return repository
                .findWeekPlan(studentId, weekStart)
                .orElseThrow(() -> new DomainException(500, "WEEK_PLAN_SAVE_FAILED", "周计划保存失败"));
    }

    private List<WeekPlanRepository.DayAvailabilitySeed> generateSeeds(
            UUID studentId, LocalDate weekStart, String sourceType) {
        List<WeekPlanRepository.DayAvailabilitySeed> seeds = new ArrayList<>(7);
        switch (sourceType) {
            case "BASE_PATTERN" -> {
                WeeklyPatternView pattern =
                        repository
                                .findActivePattern(studentId)
                                .orElseThrow(
                                        () ->
                                                new DomainException(
                                                        409,
                                                        "WEEKLY_PATTERN_NOT_FOUND",
                                                        "学生常规周不存在，无法从常规周复制"));
                for (WeeklyPatternView.DayItem day : pattern.days()) {
                    LocalDate businessDate = weekStart.plusDays(day.dayOfWeek() - 1);
                    seeds.add(
                            new WeekPlanRepository.DayAvailabilitySeed(
                                    businessDate,
                                    day.available(),
                                    day.availableMinutes(),
                                    day.devicePolicyOverride(),
                                    null));
                }
            }
            case "PREVIOUS_WEEK" -> {
                WeekPlanView previous =
                        repository
                                .findPreviousWeekPlan(studentId, weekStart)
                                .orElseThrow(
                                        () ->
                                                new DomainException(
                                                        409,
                                                        "PREVIOUS_WEEK_PLAN_NOT_FOUND",
                                                        "上周计划不存在，无法从上周复制"));
                for (WeekPlanView.DayAvailability day : previous.days()) {
                    // Map the previous week's day onto the equivalent day-of-week in the target
                    // week so the copied availability carries the same ISO weekday slot.
                    int dayOfWeek = day.businessDate().getDayOfWeek().getValue();
                    LocalDate targetDate = weekStart.plusDays(dayOfWeek - 1);
                    seeds.add(
                            new WeekPlanRepository.DayAvailabilitySeed(
                                    targetDate,
                                    day.available(),
                                    day.availableMinutes(),
                                    day.devicePolicyOverride(),
                                    day.note()));
                }
            }
            default -> {
                for (int dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek++) {
                    LocalDate businessDate = weekStart.plusDays(dayOfWeek - 1);
                    seeds.add(
                            new WeekPlanRepository.DayAvailabilitySeed(
                                    businessDate, true, 0, null, null));
                }
            }
        }
        return normalizeDates(seeds, weekStart);
    }

    private List<WeekPlanRepository.DayAvailabilitySeed> normalizeDates(
            List<WeekPlanRepository.DayAvailabilitySeed> seeds, LocalDate weekStart) {
        LocalDate weekEnd = weekStart.plusDays(6);
        List<WeekPlanRepository.DayAvailabilitySeed> normalized = new ArrayList<>(seeds.size());
        for (WeekPlanRepository.DayAvailabilitySeed seed : seeds) {
            LocalDate businessDate = seed.businessDate();
            if (businessDate == null) {
                throw new DomainException(
                        422, "WEEK_PLAN_DATE_REQUIRED", "日可用性日期不能为空");
            }
            if (businessDate.isBefore(weekStart) || businessDate.isAfter(weekEnd)) {
                throw new DomainException(
                        422,
                        "WEEK_PLAN_DATE_OUT_OF_RANGE",
                        "日可用性日期必须落在对应周内");
            }
            normalized.add(seed);
        }
        return normalized;
    }

    private void requireStudent(UUID studentId) {
        if (studentRepository.findById(studentId).isEmpty()) {
            throw new DomainException(404, "STUDENT_NOT_FOUND", "学生不存在");
        }
    }

    private void requireMonday(LocalDate weekStart) {
        if (weekStart == null || weekStart.getDayOfWeek() != DayOfWeek.MONDAY) {
            throw new DomainException(422, "WEEK_START_NOT_MONDAY", "weekStart 必须为周一");
        }
    }
}
