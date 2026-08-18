package com.wonderedu.assistant.execution.web;

import com.wonderedu.assistant.execution.api.ExecutionCommands;
import com.wonderedu.assistant.execution.api.ExecutionViews;
import com.wonderedu.assistant.execution.application.ExecutionService;
import com.wonderedu.assistant.planning.api.TaskInstanceView;
import com.wonderedu.assistant.planning.application.SchedulingService;
import com.wonderedu.assistant.shared.DomainException;
import java.net.URI;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/tasks")
public class ExecutionController {

    private final ExecutionService service;
    private final SchedulingService schedulingService;

    public ExecutionController(ExecutionService service, SchedulingService schedulingService) {
        this.service = service;
        this.schedulingService = schedulingService;
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public ResponseEntity<TaskInstanceView> createAdHocTask(
            @RequestBody ExecutionCommands.CreateAdHocTask command) {
        boolean locked = command.locked() != null && command.locked();
        TaskInstanceView created =
                schedulingService.createAdHocTask(
                        command.studentId(),
                        command.scheduledDate(),
                        command.title(),
                        command.durationMinutes(),
                        command.requiresDevice(),
                        locked,
                        command.note());
        return ResponseEntity.created(URI.create("/api/v1/tasks/" + created.id()))
                .body(created);
    }

    /**
     * SDD §11 — 任务详情. Returns the current state of a task instance including status,
     * scheduling fields, carry-over links, and version for optimistic locking.
     */
    @GetMapping("/{taskId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT', 'VIEWER')")
    public TaskInstanceView get(@PathVariable UUID taskId) {
        return service.getTask(taskId);
    }

    @PostMapping("/{taskId}/complete")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public ExecutionViews.CompleteTaskResult complete(
            @PathVariable UUID taskId, @RequestBody ExecutionCommands.CompleteTask command) {
        requireSameTask(taskId, command.taskId());
        return service.completeTask(new ExecutionCommands.CompleteTask(taskId, command.expectedVersion(), command.idempotencyKey()));
    }

    @PostMapping("/{taskId}/reopen")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public void reopen(
            @PathVariable UUID taskId, @RequestBody ExecutionCommands.ReopenTask command) {
        requireSameTask(taskId, command.taskId());
        service.reopenTask(new ExecutionCommands.ReopenTask(taskId, command.expectedVersion()));
    }

    @PostMapping("/{taskId}/carry-over")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public ExecutionViews.CarryOverResult carryOver(
            @PathVariable UUID taskId, @RequestBody ExecutionCommands.CarryOverTask command) {
        requireSameTask(taskId, command.sourceTaskId());
        return service.carryOverTask(new ExecutionCommands.CarryOverTask(taskId, command.targetDate(), command.reason()));
    }

    @PostMapping("/{taskId}/undo-carryover")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public ExecutionViews.UndoCarryOverResult undoCarryOver(
            @PathVariable UUID taskId, @RequestBody ExecutionCommands.UndoCarryOver command) {
        requireSameTask(taskId, command.sourceTaskId());
        return service.undoCarryOverTask(new ExecutionCommands.UndoCarryOver(taskId, command.expectedVersion(), command.idempotencyKey()));
    }

    @PostMapping("/{taskId}/reschedule")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public void reschedule(
            @PathVariable UUID taskId, @RequestBody ExecutionCommands.RescheduleTask command) {
        requireSameTask(taskId, command.taskId());
        service.rescheduleTask(new ExecutionCommands.RescheduleTask(taskId, command.expectedVersion(), command.targetDate(), command.overrideReason()));
    }

    @PostMapping("/{taskId}/cancel")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public void cancel(
            @PathVariable UUID taskId, @RequestBody ExecutionCommands.CancelTask command) {
        requireSameTask(taskId, command.taskId());
        service.cancelTask(new ExecutionCommands.CancelTask(taskId, command.expectedVersion(), command.reason()));
    }

    @PostMapping("/{taskId}/lock")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public void lock(
            @PathVariable UUID taskId, @RequestBody ExecutionCommands.LockTask command) {
        requireSameTask(taskId, command.taskId());
        service.lockTask(new ExecutionCommands.LockTask(taskId, command.expectedVersion(), command.locked()));
    }

    /**
     * SDD §11 — 解锁任务. Clears the locked flag on a task instance. Implemented as a dedicated
     * endpoint (rather than {@code POST /lock} with {@code locked=false}) so the audit trail
     * records a distinct unlock action.
     */
    @PostMapping("/{taskId}/unlock")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public void unlock(
            @PathVariable UUID taskId, @RequestBody ExecutionCommands.UnlockTask command) {
        requireSameTask(taskId, command.taskId());
        service.unlockTask(new ExecutionCommands.UnlockTask(taskId, command.expectedVersion()));
    }

    /**
     * TickTick-style PATCH. Updates title/note/priority/star under optimistic-lock guard. Null
     * fields are ignored (partial update).
     */
    @PatchMapping("/{taskId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public TaskInstanceView update(
            @PathVariable UUID taskId, @RequestBody ExecutionCommands.UpdateTask command) {
        requireSameTask(taskId, command.taskId());
        return service.updateTask(new ExecutionCommands.UpdateTask(taskId, command.expectedVersion(), command.title(), command.note(), command.priority(), command.star()));
    }

    @PostMapping("/{taskId}/duplicate")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public ExecutionViews.DuplicateTaskResult duplicate(
            @PathVariable UUID taskId, @RequestBody ExecutionCommands.DuplicateTask command) {
        requireSameTask(taskId, command.taskId());
        return service.duplicateTask(new ExecutionCommands.DuplicateTask(taskId, command.expectedVersion(), command.targetDate()));
    }

    @PostMapping("/{taskId}/subtasks")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public ExecutionViews.CreateSubTaskResult createSubTask(
            @PathVariable UUID taskId, @RequestBody ExecutionCommands.CreateSubTask command) {
        requireSameTask(taskId, command.taskId());
        return service.createSubTask(new ExecutionCommands.CreateSubTask(taskId, command.title(), command.scheduledDate(), command.priority()));
    }

    @PostMapping("/{taskId}/link")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public TaskInstanceView link(
            @PathVariable UUID taskId, @RequestBody ExecutionCommands.LinkMainTask command) {
        requireSameTask(taskId, command.taskId());
        return service.linkMainTask(new ExecutionCommands.LinkMainTask(taskId, command.expectedVersion(), command.linkedParentTaskId()));
    }

    @DeleteMapping("/{taskId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public void delete(
            @PathVariable UUID taskId, @RequestBody ExecutionCommands.DeleteTask command) {
        requireSameTask(taskId, command.taskId());
        service.deleteTask(new ExecutionCommands.DeleteTask(taskId, command.expectedVersion()));
    }

    @PostMapping("/{taskId}/reorder")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public TaskInstanceView reorder(
            @PathVariable UUID taskId, @RequestBody ExecutionCommands.ReorderTask command) {
        requireSameTask(taskId, command.taskId());
        return service.reorderTask(new ExecutionCommands.ReorderTask(taskId, command.expectedVersion(), command.newSortOrder()));
    }

    private static void requireSameTask(UUID pathTaskId, UUID bodyTaskId) {
        if (bodyTaskId == null || !pathTaskId.equals(bodyTaskId)) {
            throw new DomainException(400, "TASK_PATH_BODY_MISMATCH", "路径任务 ID 与请求体任务 ID 不一致");
        }
    }
}
