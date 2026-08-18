package com.wonderedu.assistant.student.api;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Read model for a student's weekly pattern (SDD §8.5).
 *
 * <p>A pattern is ACTIVE or RETIRED. The ACTIVE pattern plus its seven {@link DayItem day items} is
 * the read projection used by the schedule UI; replacements always retire the previous ACTIVE
 * pattern and create a new one.
 */
public record WeeklyPatternView(
        UUID id,
        UUID studentId,
        LocalDate effectiveFrom,
        LocalDate effectiveTo,
        String status,
        List<DayItem> days,
        long version,
        Instant updatedAt) {

    /** ISO 1-7 day item (Monday-Sunday). */
    public record DayItem(
            int dayOfWeek,
            boolean available,
            int availableMinutes,
            String devicePolicyOverride) {}
}
