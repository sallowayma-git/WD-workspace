package com.wonderedu.assistant.execution.api;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class TodayViews {

    private TodayViews() {}

    public record TodayResponse(
            LocalDate businessDate,
            TodayMetrics metrics,
            List<TodayStudentGroup> students) {}

    public record TodayMetrics(
            int totalStudents,
            int totalPendingTasks,
            int totalCompletedTasks,
            int carriedOverTasks,
            int blockedTasks,
            int conflictCount) {}

    public record TodayStudentGroup(
            UUID studentId,
            String studentName,
            String studentCode,
            String devicePolicy,
            List<TodayTaskSummary> tasks) {}

    public record TodayTaskSummary(
            UUID id,
            String title,
            String shortTitle,
            String status,
            String sourceType,
            Integer itemOrdinal,
            Integer durationMinutes,
            boolean locked,
            boolean carriedOver,
            LocalDate scheduledDate,
            long version) {}

    /**
     * A single carry-over record visible on Today's "昨日顺延" list (PRD AC-006/014, FR-TODAY-006).
     * Links the original (now CARRIED_OVER) instance to the new PENDING instance at the target date.
     */
    public record CarryOverItem(
            UUID sourceTaskId,
            UUID targetTaskId,
            UUID studentId,
            String studentName,
            LocalDate originalDate,
            LocalDate targetDate,
            String title,
            String reason,
            String rule,
            String scheduleOrigin,
            java.time.Instant executedAt,
            long version) {}
}
