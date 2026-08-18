package com.wonderedu.assistant.execution.api;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class ScheduleViews {

    private ScheduleViews() {}

    public record ScheduleResponse(
            UUID studentId,
            String studentName,
            String studentCode,
            String devicePolicy,
            LocalDate fromDate,
            LocalDate toDate,
            String view,
            List<ScheduleDay> days) {}

    public record ScheduleDay(
            LocalDate date,
            boolean available,
            int availableMinutes,
            String devicePolicy,
            List<ScheduleTaskSummary> tasks) {}

    public record ScheduleTaskSummary(
            UUID id,
            String title,
            String shortTitle,
            String status,
            String sourceType,
            Integer itemOrdinal,
            Integer durationMinutes,
            boolean locked,
            long version) {}
}
