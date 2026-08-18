package com.wonderedu.assistant.student.application;

import com.wonderedu.assistant.student.api.WeekPlanView.DayAvailability;
import com.wonderedu.assistant.student.api.WeeklyPatternView;
import com.wonderedu.assistant.student.api.WeeklyPatternView.DayItem;
import com.wonderedu.assistant.student.persistence.WeekPlanRepository;
import com.wonderedu.assistant.shared.TenantContext;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class AvailabilityService {

    private final WeekPlanRepository weekPlanRepo;
    private final NamedParameterJdbcTemplate jdbc;

    public AvailabilityService(WeekPlanRepository weekPlanRepo, NamedParameterJdbcTemplate jdbc) {
        this.weekPlanRepo = weekPlanRepo;
        this.jdbc = jdbc;
    }

    public record EffectiveAvailability(
            boolean available,
            int availableMinutes,
            String devicePolicy,
            String source,
            String note) {}

    public EffectiveAvailability resolveEffectiveAvailability(UUID studentId, LocalDate date) {
        DayAvailability dayAvail = findDayAvailability(studentId, date);
        if (dayAvail != null) {
            String policy = dayAvail.devicePolicyOverride() != null
                    ? dayAvail.devicePolicyOverride()
                    : getStudentDefaultDevicePolicy(studentId);
            return new EffectiveAvailability(
                    dayAvail.available(),
                    dayAvail.availableMinutes(),
                    policy,
                    "WEEK_PLAN",
                    dayAvail.note());
        }

        WeeklyPatternView pattern = weekPlanRepo.findActivePattern(studentId).orElse(null);
        if (pattern != null) {
            int isoDay = date.getDayOfWeek().getValue();
            for (DayItem item : pattern.days()) {
                if (item.dayOfWeek() == isoDay) {
                    String policy = item.devicePolicyOverride() != null
                            ? item.devicePolicyOverride()
                            : getStudentDefaultDevicePolicy(studentId);
                    return new EffectiveAvailability(
                            item.available(),
                            item.availableMinutes(),
                            policy,
                            "WEEKLY_PATTERN",
                            null);
                }
            }
        }

        return new EffectiveAvailability(true, 120, getStudentDefaultDevicePolicy(studentId), "DEFAULT", null);
    }

    public Optional<LocalDate> findNextAvailableDate(
            UUID studentId,
            LocalDate afterDate,
            Boolean requiresDevice,
            int horizonDays,
            List<LocalDate> excludeDates) {
        java.util.Set<LocalDate> excluded =
                excludeDates == null ? java.util.Set.of() : new java.util.HashSet<>(excludeDates);
        for (int i = 1; i <= horizonDays; i++) {
            LocalDate candidate = afterDate.plusDays(i);
            if (excluded.contains(candidate)) continue;
            EffectiveAvailability avail = resolveEffectiveAvailability(studentId, candidate);
            if (!avail.available()) continue;
            if (requiresDevice != null && requiresDevice && !"ALLOWED".equals(avail.devicePolicy())) continue;
            return Optional.of(candidate);
        }
        return Optional.empty();
    }

    private DayAvailability findDayAvailability(UUID studentId, LocalDate date) {
        try {
            return jdbc.queryForObject(
                    "SELECT da.id, da.business_date, da.available, da.available_minutes, "
                            + "da.device_policy_override, da.note, da.version "
                            + "FROM student_day_availability da "
                            + "WHERE da.student_id = :studentId AND da.business_date = :date "
                            + "AND EXISTS (SELECT 1 FROM student s WHERE s.id = da.student_id AND s.organization_id = :orgId)",
                    new MapSqlParameterSource()
                            .addValue("studentId", studentId)
                            .addValue("date", date)
                            .addValue("orgId", TenantContext.requireOrganizationId()),
                    (rs, rowNum) -> new DayAvailability(
                            rs.getObject("id", UUID.class),
                            rs.getObject("business_date", LocalDate.class),
                            rs.getBoolean("available"),
                            rs.getInt("available_minutes"),
                            rs.getString("device_policy_override"),
                            rs.getString("note"),
                            rs.getLong("version")));
        } catch (Exception e) {
            return null;
        }
    }

    private String getStudentDefaultDevicePolicy(UUID studentId) {
        try {
            return jdbc.queryForObject(
                    "SELECT default_device_policy FROM student WHERE id = :id AND organization_id = :orgId",
                    new MapSqlParameterSource()
                            .addValue("id", studentId)
                            .addValue("orgId", TenantContext.requireOrganizationId()),
                    String.class);
        } catch (Exception e) {
            return "CONFIRM";
        }
    }
}
