package com.wonderedu.assistant.execution.api;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class ExecutionCommands {

    private ExecutionCommands() {}

    public record CompleteTask(UUID taskId, long expectedVersion, String idempotencyKey) {}

    public record ReopenTask(UUID taskId, long expectedVersion) {}

    public record CarryOverTask(UUID sourceTaskId, LocalDate targetDate, String reason) {}

    public record UndoCarryOver(UUID sourceTaskId, long expectedVersion, String idempotencyKey) {}

    public record RescheduleTask(UUID taskId, long expectedVersion, LocalDate targetDate, String overrideReason) {}

    public record CancelTask(UUID taskId, long expectedVersion, String reason) {}

    public record LockTask(UUID taskId, long expectedVersion, boolean locked) {}

    /**
     * SDD §11 POST /tasks/{taskId}/unlock — 解锁任务. Sets {@code locked = false} on the task
     * instance. Implemented as a dedicated command (rather than {@link LockTask} with {@code
     * locked=false}) so the audit trail records a distinct unlock action.
     */
    public record UnlockTask(UUID taskId, long expectedVersion) {}

    public record CreateAdHocTask(
            UUID studentId,
            LocalDate scheduledDate,
            String title,
            Integer durationMinutes,
            Boolean requiresDevice,
            Boolean locked,
            String note) {}

    /** PATCH /tasks/{taskId} — TickTick-style edit. Null fields are ignored (partial update). */
    public record UpdateTask(
            UUID taskId,
            long expectedVersion,
            String title,
            String note,
            String priority,
            Boolean star) {}

    /** POST /tasks/{taskId}/duplicate — body {targetDate?} copies a task to a new AD_HOC instance. */
    public record DuplicateTask(UUID taskId, long expectedVersion, LocalDate targetDate) {}

    /**
     * POST /tasks/{taskId}/subtasks — body {title, scheduledDate?, priority?} creates a child
     * AD_HOC task pointing at the parent via {@code parent_task_id}.
     */
    public record CreateSubTask(
            UUID taskId,
            String title,
            LocalDate scheduledDate,
            String priority) {}

    /** POST /tasks/{taskId}/link — body {linkedParentTaskId} associates a non-parent main task. */
    public record LinkMainTask(UUID taskId, long expectedVersion, UUID linkedParentTaskId) {}

    /** DELETE /tasks/{taskId} — physical delete (AD_HOC/IMPORT only; TRACK rejected with 409). */
    public record DeleteTask(UUID taskId, long expectedVersion) {}

    /** POST /tasks/{taskId}/reorder — body {newSortOrder} adjusts manual sort order. */
    public record ReorderTask(UUID taskId, long expectedVersion, int newSortOrder) {}
}
