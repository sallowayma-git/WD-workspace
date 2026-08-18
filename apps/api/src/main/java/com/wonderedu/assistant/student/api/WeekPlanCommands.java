package com.wonderedu.assistant.student.api;

import java.time.LocalDate;
import java.util.List;

/** Commands for weekly pattern and week plan endpoints (SDD §11.4). */
public final class WeekPlanCommands {

    private WeekPlanCommands() {}

    /** Replace a student's ACTIVE weekly pattern (SDD §9.1 saveWeeklyPattern). */
    public record SaveWeeklyPattern(
            LocalDate effectiveFrom,
            List<DayItem> days) {

        public record DayItem(
                int dayOfWeek,
                boolean available,
                int availableMinutes,
                String devicePolicyOverride) {}
    }

    /**
     * Create or replace a DRAFT week plan (SDD §9.1 createWeekPlan).
     *
     * <p>{@code sourceType} may be BASE_PATTERN, PREVIOUS_WEEK or MANUAL. When {@code
     * replaceDraft=true} an existing DRAFT plan is replaced; a CONFIRMED/CLOSED plan cannot be
     * overwritten.
     */
    public record SaveWeekPlan(
            String sourceType,
            boolean replaceDraft) {}
}
