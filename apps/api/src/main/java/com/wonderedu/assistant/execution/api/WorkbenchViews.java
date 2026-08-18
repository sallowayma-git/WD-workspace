package com.wonderedu.assistant.execution.api;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class WorkbenchViews {

    private WorkbenchViews() {}

    public record WorkbenchResponse(LocalDateRange range, List<WorkbenchStudentRow> students) {}

    public record LocalDateRange(LocalDate from, LocalDate to) {}

    public record WorkbenchStudentRow(
            UUID id,
            String name,
            String code,
            String devicePolicy,
            List<WorkbenchStudentTag> tags,
            int vocabularyCountThisWeek,
            Map<LocalDate, WorkbenchDayCell> days) {}

    public record WorkbenchStudentTag(String code, String name) {}

    public record WorkbenchDayCell(
            LocalDate date,
            boolean available,
            int availableMinutes,
            List<WorkbenchTaskSummary> tasks) {}

    public record WorkbenchTaskSummary(
            UUID id,
            String shortTitle,
            String status,
            long version) {}
}
