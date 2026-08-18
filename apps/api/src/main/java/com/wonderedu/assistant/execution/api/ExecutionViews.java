package com.wonderedu.assistant.execution.api;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class ExecutionViews {

    private ExecutionViews() {}

    public record CompleteTaskResult(
            UUID taskId,
            String taskStatus,
            UUID trackId,
            Integer trackCurrentOrdinal,
            String trackStatus,
            Integer nextCandidateOrdinal,
            LocalDate nextCandidateDate,
            long version,
            Instant updatedAt) {}

    public record CarryOverResult(
            UUID sourceTaskId,
            UUID targetTaskId,
            LocalDate targetDate,
            String status,
            String reason) {}

    public record UndoCarryOverResult(
            UUID sourceTaskId,
            UUID targetTaskId,
            String sourceStatus,
            String targetStatus,
            String reason) {}

    public record TaskHistoryEntry(
            UUID id,
            LocalDate scheduledDate,
            String status,
            String titleSnapshot,
            Instant completedAt,
            UUID completedBy,
            Instant updatedAt) {}

    public record TaskDetail(
            UUID id,
            UUID studentId,
            String sourceType,
            UUID trackId,
            Integer itemOrdinal,
            LocalDate scheduledDate,
            LocalDate originalScheduledDate,
            String status,
            String titleSnapshot,
            String shortTitleSnapshot,
            Integer durationMinutesSnapshot,
            Boolean requiresDeviceSnapshot,
            String scheduleOrigin,
            boolean manualOverride,
            String overrideReason,
            boolean locked,
            String note,
            UUID carriedFromInstanceId,
            UUID carriedToInstanceId,
            Instant completedAt,
            UUID completedBy,
            long version,
            Instant updatedAt,
            List<TaskHistoryEntry> history) {}

    public record DuplicateTaskResult(
            UUID sourceTaskId,
            UUID newTaskId,
            LocalDate scheduledDate,
            long version,
            Instant updatedAt) {}

    public record CreateSubTaskResult(
            UUID parentTaskId,
            UUID subTaskId,
            long version,
            Instant updatedAt) {}
}
