package com.wonderedu.assistant.student.api;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Read model for a student week plan (SDD §8.6).
 *
 * <p>A week plan is a dated snapshot for a specific ISO week (weekStart must be a Monday) and holds
 * seven {@link DayAvailability day availabilities}. Only one plan exists per
 * {@code (student_id, week_start_date)}.
 */
public record WeekPlanView(
        UUID id,
        UUID studentId,
        LocalDate weekStartDate,
        String sourceType,
        UUID sourceId,
        String status,
        Instant confirmedAt,
        List<DayAvailability> days,
        long version,
        Instant updatedAt) {

    public record DayAvailability(
            UUID id,
            LocalDate businessDate,
            boolean available,
            int availableMinutes,
            String devicePolicyOverride,
            String note,
            long version) {}
}
