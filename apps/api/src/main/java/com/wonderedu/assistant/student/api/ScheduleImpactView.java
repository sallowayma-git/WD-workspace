package com.wonderedu.assistant.student.api;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Read model returned by the schedule-impact preview endpoint (SDD §9.8).
 *
 * <p>When a student's weekly pattern or day availability changes, the {@code
 * ScheduleImpactAnalyzer} reports the pending tasks whose scheduled date is no longer learnable,
 * without silently moving them. The frontend then issues {@code applyScheduleImpactResolution} to
 * explicitly KEEP, MOVE_SUGGESTED or CUSTOM each affected task. This view is the preview payload
 * only; resolution is a separate, future command.
 */
public record ScheduleImpactView(List<AffectedTask> affectedTasks, Summary summary) {

    /** A single pending task that conflicts with the updated availability. */
    public record AffectedTask(
            UUID taskId,
            LocalDate date,
            List<String> conflicts,
            boolean locked,
            LocalDate suggestedDate) {}

    /** Aggregate counts derived from {@link #affectedTasks()}. */
    public record Summary(int total, int locked, int movable) {}
}
