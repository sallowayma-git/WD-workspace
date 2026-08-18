package com.wonderedu.assistant.execution.application;

import com.wonderedu.assistant.audit.api.AuditAction;
import com.wonderedu.assistant.audit.application.AuditService;
import com.wonderedu.assistant.execution.api.ExecutionCommands;
import com.wonderedu.assistant.execution.api.ExecutionViews;
import com.wonderedu.assistant.execution.api.ExecutionViews.CarryOverResult;
import com.wonderedu.assistant.execution.api.ExecutionViews.CompleteTaskResult;
import com.wonderedu.assistant.planning.api.TaskInstanceView;
import com.wonderedu.assistant.planning.application.TrackService;
import com.wonderedu.assistant.planning.persistence.TaskInstanceRepository;
import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.DomainException;
import com.wonderedu.assistant.shared.IdGenerator;
import com.wonderedu.assistant.student.application.AvailabilityService;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ExecutionService {

    private static final String TARGET_TYPE_TASK_INSTANCE = "TASK_INSTANCE";

    private final TaskInstanceRepository taskRepo;
    private final TrackService trackService;
    private final AvailabilityService availabilityService;
    private final BusinessClock clock;
    private final IdGenerator idGenerator;
    private final AuditService auditService;
    private final String timezone;

    @org.springframework.beans.factory.annotation.Autowired
    public ExecutionService(
            TaskInstanceRepository taskRepo,
            TrackService trackService,
            AvailabilityService availabilityService,
            BusinessClock clock,
            IdGenerator idGenerator,
            AuditService auditService,
            com.wonderedu.assistant.identity.IdentityProperties properties) {
        this(
                taskRepo,
                trackService,
                availabilityService,
                clock,
                idGenerator,
                auditService,
                properties.businessTimezone());
    }

    ExecutionService(
            TaskInstanceRepository taskRepo,
            TrackService trackService,
            AvailabilityService availabilityService,
            BusinessClock clock,
            IdGenerator idGenerator,
            AuditService auditService,
            String timezone) {
        this.taskRepo = taskRepo;
        this.trackService = trackService;
        this.availabilityService = availabilityService;
        this.clock = clock;
        this.idGenerator = idGenerator;
        this.auditService = auditService;
        this.timezone = timezone;
    }

    @Transactional
    public CompleteTaskResult completeTask(ExecutionCommands.CompleteTask command) {
        TaskInstanceView task = taskRepo
                .findById(command.taskId())
                .orElseThrow(() -> new DomainException(404, "TASK_NOT_FOUND", "任务不存在"));

        // BR-012: idempotency. If the task is already COMPLETED and an idempotency key was
        // supplied, treat the repeat submission as a no-op and return the existing result.
        // A persistent idempotency_record entry is not required for this command because the
        // COMPLETED status on the aggregate itself is the durable proof of execution.
        if ("COMPLETED".equals(task.status()) && command.idempotencyKey() != null && !command.idempotencyKey().isBlank()) {
            return buildCompleteResult(task);
        }

        if (!"PENDING".equals(task.status())) {
            throw new DomainException(409, "TASK_NOT_COMPLETABLE", "只能完成待处理的任务");
        }

        // SDD §19.2: lock the track before the task instance so concurrent complete/carry-over
        // operations on the same track acquire locks in a consistent order (track → task). The
        // pessimistic task-instance lock (FOR UPDATE) supplements the optimistic version check
        // and serializes the read-then-update sequence.
        if ("TRACK".equals(task.sourceType()) && task.trackId() != null) {
            trackService.lockTrack(task.trackId());
        }
        taskRepo.findByIdForUpdate(command.taskId());

        int updated = taskRepo.completeTask(
                command.taskId(), command.expectedVersion(), clock.now(), actorId());
        if (updated == 0) {
            TaskInstanceView current = taskRepo.findById(command.taskId()).orElseThrow();
            throw new DomainException(
                    409,
                    "TASK_VERSION_CONFLICT",
                    "任务已被其他用户修改",
                    List.of(),
                    Map.of("id", current.id(), "version", current.version(), "status", current.status()));
        }

        TaskInstanceView completed = taskRepo.findById(command.taskId()).orElseThrow();

        UUID trackId = null;
        Integer trackCurrentOrdinal = null;
        Integer nextOrdinal = null;
        LocalDate nextDate = null;
        String trackStatus = null;

        if ("TRACK".equals(completed.sourceType()) && completed.trackId() != null) {
            trackId = completed.trackId();
            var track = trackService.recalculateAndPersist(trackId);
            trackCurrentOrdinal = track.currentOrdinal();
            nextOrdinal = track.currentOrdinal() <= track.endOrdinal() ? track.currentOrdinal() : null;
            nextDate = track.nextCandidateDate();
            trackStatus = track.status();
        }

        writeAuditEvent(
                AuditAction.TASK_COMPLETED,
                completed.id(),
                Map.of("completedAt", String.valueOf(completed.completedAt())),
                taskSnapshot(task),
                taskSnapshot(completed),
                command.idempotencyKey());

        return new CompleteTaskResult(
                completed.id(),
                completed.status(),
                trackId,
                trackCurrentOrdinal,
                trackStatus,
                nextOrdinal,
                nextDate,
                completed.version(),
                completed.updatedAt());
    }

    @Transactional
    public void reopenTask(ExecutionCommands.ReopenTask command) {
        TaskInstanceView task = taskRepo
                .findById(command.taskId())
                .orElseThrow(() -> new DomainException(404, "TASK_NOT_FOUND", "任务不存在"));

        if (!"COMPLETED".equals(task.status())) {
            throw new DomainException(409, "TASK_NOT_COMPLETED", "只能重新打开已完成的任务");
        }

        if ("TRACK".equals(task.sourceType()) && task.trackId() != null) {
            int currentPointer = trackService.calculateTrackPointer(task.trackId());
            if (task.itemOrdinal() != null && currentPointer > task.itemOrdinal()) {
                throw new DomainException(
                        409,
                        "TASK_REOPEN_REQUIRES_CORRECTION",
                        "后续单元已完成，无法直接重新打开，需通过纠错流程处理");
            }
        }

        // SDD §19.2: lock track → task before the state transition. The FOR UPDATE lock
        // supplements the optimistic version check and serializes the read-then-update sequence.
        if ("TRACK".equals(task.sourceType()) && task.trackId() != null) {
            trackService.lockTrack(task.trackId());
        }
        taskRepo.findByIdForUpdate(command.taskId());

        int updated = taskRepo.reopenTask(
                command.taskId(), command.expectedVersion(), clock.now(), actorId());
        if (updated == 0) {
            TaskInstanceView current = taskRepo.findById(command.taskId()).orElseThrow();
            throw new DomainException(
                    409,
                    "TASK_VERSION_CONFLICT",
                    "任务已被其他用户修改",
                    List.of(),
                    Map.of("id", current.id(), "version", current.version(), "status", current.status()));
        }

        if ("TRACK".equals(task.sourceType()) && task.trackId() != null) {
            trackService.recalculateAndPersist(task.trackId());
        }

        TaskInstanceView reopened = taskRepo.findById(command.taskId()).orElseThrow();
        writeAuditEvent(
                AuditAction.TASK_REOPENED,
                reopened.id(),
                Map.of(),
                taskSnapshot(task),
                taskSnapshot(reopened),
                /* idempotencyKey */ null);
    }

    @Transactional
    public CarryOverResult carryOverTask(ExecutionCommands.CarryOverTask command) {
        TaskInstanceView source = taskRepo
                .findById(command.sourceTaskId())
                .orElseThrow(() -> new DomainException(404, "TASK_NOT_FOUND", "任务不存在"));

        if (!"PENDING".equals(source.status())) {
            return new CarryOverResult(source.id(), null, null, source.status(), "任务非待处理状态，无需顺延");
        }

        if (source.locked()) {
            return new CarryOverResult(source.id(), null, null, source.status(), "任务已锁定，跳过顺延");
        }

        LocalDate targetDate = command.targetDate();
        if (targetDate == null) {
            targetDate = findNextAvailableDate(source.studentId(), source.requiresDeviceSnapshot(), source.scheduledDate());
        }

        if (targetDate == null) {
            taskRepo.blockTask(source.id(), source.version(), clock.now(), actorId());
            return new CarryOverResult(source.id(), null, null, "BLOCKED", "找不到下一可学习日");
        }

        // AC-007 / BR-008: when the caller pins an explicit target date, the auto-resolver above
        // was bypassed, so verify the day is learnable and that the device policy allows the
        // task's required device. An explicit carry-over onto an incompatible day is BLOCKED
        // (with a distinct reason) rather than forcibly scheduled, mirroring the auto path.
        AvailabilityService.EffectiveAvailability carryAvail =
                availabilityService.resolveEffectiveAvailability(source.studentId(), targetDate);
        if (!carryAvail.available()) {
            taskRepo.blockTask(source.id(), source.version(), clock.now(), actorId());
            return new CarryOverResult(source.id(), null, null, "BLOCKED", "目标日期不可学习");
        }
        if (requiresDevice(source) && !isDeviceAllowed(carryAvail)) {
            taskRepo.blockTask(source.id(), source.version(), clock.now(), actorId());
            return new CarryOverResult(
                    source.id(), null, null, "BLOCKED", "目标日期设备条件不符，无法顺延");
        }

        // BR-012: idempotency. DayCloseJob should issue carry-over commands with a stable
        // idempotency key such as "carryover:{sourceTaskId}:{targetDate}". Because the carry-over
        // operation creates a new PENDING instance at the target date for the same track+ordinal,
        // we guard against duplicate execution by checking that no PENDING instance already exists
        // at the target date for the same track and item ordinal before creating a new one.
        if (source.trackId() != null && source.itemOrdinal() != null) {
            Optional<TaskInstanceView> duplicate =
                    taskRepo.findPendingForTrackOrdinal(source.trackId(), source.itemOrdinal());
            if (duplicate.isPresent()
                    && targetDate.equals(duplicate.get().scheduledDate())
                    && duplicate.get().studentId().equals(source.studentId())) {
                TaskInstanceView existing = duplicate.get();
                return new CarryOverResult(
                        source.id(), existing.id(), existing.scheduledDate(), "CARRIED_OVER", "目标日已存在顺延实例，跳过重复顺延");
            }
        }

        // SDD §19.2: lock track → task before the state transition. The FOR UPDATE lock
        // supplements the optimistic version check and serializes the read-then-update sequence.
        if (source.trackId() != null) {
            trackService.lockTrack(source.trackId());
        }
        taskRepo.findByIdForUpdate(source.id());

        UUID newInstanceId = idGenerator.next();
        int updated = taskRepo.carryOverTask(
                source.id(), newInstanceId, source.version(), clock.now(), actorId());
        if (updated == 0) {
            TaskInstanceView current = taskRepo.findById(source.id()).orElseThrow();
            throw new DomainException(
                    409,
                    "TASK_VERSION_CONFLICT",
                    "任务已被其他用户修改",
                    List.of(),
                    Map.of("id", current.id(), "version", current.version(), "status", current.status()));
        }

        taskRepo.insertTrackInstance(
                newInstanceId,
                source.studentId(),
                source.trackId(),
                source.templateVersionId(),
                source.templateItemId(),
                source.itemOrdinal(),
                targetDate,
                source.titleSnapshot(),
                source.shortTitleSnapshot(),
                source.durationMinutesSnapshot(),
                source.requiresDeviceSnapshot() != null && source.requiresDeviceSnapshot(),
                "CARRYOVER",
                true,
                command.reason(),
                source.locked(),
                source.note(),
                source.id(),
                clock.now(),
                actorId());

        TaskInstanceView newInstance = taskRepo.findById(newInstanceId).orElseThrow();
        Map<String, Object> carryMetadata = new LinkedHashMap<>();
        carryMetadata.put("sourceTaskId", String.valueOf(source.id()));
        carryMetadata.put("targetDate", String.valueOf(targetDate));
        carryMetadata.put("reason", String.valueOf(command.reason()));
        writeAuditEvent(
                AuditAction.TASK_CARRIED_OVER,
                newInstanceId,
                carryMetadata,
                taskSnapshot(source),
                taskSnapshot(newInstance),
                /* idempotencyKey */ null);

        return new CarryOverResult(source.id(), newInstanceId, targetDate, "CARRIED_OVER", "顺延成功");
    }

    /**
     * Reverts a single carry-over (AC-006/014 traceability). The source instance (currently
     * CARRIED_OVER with a non-null carried_to_instance_id) is restored to PENDING and its
     * carried_to_instance_id link is cleared. The target instance (the new PENDING instance created
     * by the prior carry-over) is marked CANCELLED and its carried_from_instance_id link is
     * cleared. Idempotent via BR-012: if the source is no longer CARRIED_OVER and an idempotency
     * key is supplied, the repeat call is a no-op.
     */
    @Transactional
    public ExecutionViews.UndoCarryOverResult undoCarryOverTask(ExecutionCommands.UndoCarryOver command) {
        TaskInstanceView source = taskRepo
                .findById(command.sourceTaskId())
                .orElseThrow(() -> new DomainException(404, "TASK_NOT_FOUND", "任务不存在"));

        // BR-012: idempotency. If the source is no longer CARRIED_OVER (already undone or
        // otherwise transitioned) and an idempotency key was supplied, treat the repeat call as a
        // no-op and return the current state.
        if (!"CARRIED_OVER".equals(source.status())
                && command.idempotencyKey() != null
                && !command.idempotencyKey().isBlank()) {
            UUID targetId = source.carriedToInstanceId();
            String targetStatus = "PENDING";
            if (targetId != null) {
                TaskInstanceView target = taskRepo.findById(targetId).orElse(null);
                if (target != null) {
                    targetStatus = target.status();
                }
            }
            return new ExecutionViews.UndoCarryOverResult(
                    source.id(), targetId, source.status(), targetStatus, "任务非顺延状态，无需撤销");
        }

        if (!"CARRIED_OVER".equals(source.status())) {
            throw new DomainException(409, "TASK_NOT_CARRIED_OVER", "只能撤销已顺延的任务");
        }

        if (source.carriedToInstanceId() == null) {
            throw new DomainException(
                    409,
                    "TASK_CARRYOVER_LINK_MISSING",
                    "任务缺少顺延目标链接，无法撤销");
        }

        UUID targetInstanceId = source.carriedToInstanceId();
        TaskInstanceView target = taskRepo
                .findById(targetInstanceId)
                .orElseThrow(() -> new DomainException(404, "TASK_NOT_FOUND", "顺延目标任务不存在"));

        // SDD §19.2: lock track → task before the state transition. The FOR UPDATE lock
        // supplements the optimistic version check and serializes the read-then-update sequence.
        if (source.trackId() != null) {
            trackService.lockTrack(source.trackId());
        }
        taskRepo.findByIdForUpdate(source.id());
        taskRepo.findByIdForUpdate(targetInstanceId);

        // Restore the source instance to PENDING and clear the forward link.
        int sourceUpdated = taskRepo.undoCarryOverSource(
                source.id(), command.expectedVersion(), clock.now(), actorId());
        if (sourceUpdated == 0) {
            TaskInstanceView current = taskRepo.findById(source.id()).orElseThrow();
            throw new DomainException(
                    409,
                    "TASK_VERSION_CONFLICT",
                    "任务已被其他用户修改",
                    List.of(),
                    Map.of("id", current.id(), "version", current.version(), "status", current.status()));
        }

        // Cancel the target instance and clear the back link. The target was created at PENDING by
        // the prior carry-over; guard so we only affect a still-PENDING, linked instance.
        taskRepo.undoCarryOverTarget(targetInstanceId, target.version(), clock.now(), actorId());

        TaskInstanceView undoneSource = taskRepo.findById(source.id()).orElseThrow();
        TaskInstanceView undoneTarget = taskRepo.findById(targetInstanceId).orElseThrow();
        writeAuditEvent(
                AuditAction.TASK_CARRYOVER_UNDONE,
                source.id(),
                Map.of(
                        "sourceTaskId", String.valueOf(source.id()),
                        "targetInstanceId", String.valueOf(targetInstanceId)),
                taskSnapshot(source, target),
                taskSnapshot(undoneSource, undoneTarget),
                command.idempotencyKey());

        return new ExecutionViews.UndoCarryOverResult(
                source.id(), targetInstanceId, "PENDING", "CANCELLED", "撤销顺延成功");
    }

    @Transactional
    public void rescheduleTask(ExecutionCommands.RescheduleTask command) {
        TaskInstanceView task = taskRepo
                .findById(command.taskId())
                .orElseThrow(() -> new DomainException(404, "TASK_NOT_FOUND", "任务不存在"));

        if (!"PENDING".equals(task.status()) && !"BLOCKED".equals(task.status())) {
            throw new DomainException(409, "TASK_NOT_RESCHEDULABLE", "只能改期待处理或阻塞的任务");
        }

        // AC-007 / BR-008: distinguish "target day not learnable" from "device policy conflict".
        // The availability resolver returns the effective devicePolicy for the day (ALLOWED,
        // NOT_ALLOWED, or CONFIRM). A task whose template requires a device cannot be scheduled
        // onto a day whose policy is anything other than ALLOWED; surface this as a distinct
        // 409 so the UI can tell the two failure modes apart.
        AvailabilityService.EffectiveAvailability avail =
                availabilityService.resolveEffectiveAvailability(task.studentId(), command.targetDate());
        if (!avail.available()) {
            throw new DomainException(409, "RESCHEDULE_DAY_UNAVAILABLE", "目标日期不可学习");
        }
        if (requiresDevice(task) && !isDeviceAllowed(avail)) {
            throw new DomainException(
                    409,
                    "DEVICE_POLICY_CONFLICT",
                    "目标日期设备条件不符，该任务需要可用设备",
                    List.of(),
                    Map.of(
                            "targetDate", command.targetDate(),
                            "devicePolicy", String.valueOf(avail.devicePolicy())));
        }

        // SDD §19.2: lock track → task before the state transition. The FOR UPDATE lock
        // supplements the optimistic version check and serializes the read-then-update sequence.
        if ("TRACK".equals(task.sourceType()) && task.trackId() != null) {
            trackService.lockTrack(task.trackId());
        }
        taskRepo.findByIdForUpdate(command.taskId());

        int updated = taskRepo.rescheduleTask(
                command.taskId(),
                command.expectedVersion(),
                command.targetDate(),
                command.overrideReason(),
                clock.now(),
                actorId());
        if (updated == 0) {
            TaskInstanceView current = taskRepo.findById(command.taskId()).orElseThrow();
            throw new DomainException(
                    409,
                    "TASK_VERSION_CONFLICT",
                    "任务已被其他用户修改",
                    List.of(),
                    Map.of("id", current.id(), "version", current.version(), "status", current.status()));
        }

        TaskInstanceView rescheduled = taskRepo.findById(command.taskId()).orElseThrow();
        writeAuditEvent(
                AuditAction.TASK_RESCHEDULED,
                command.taskId(),
                Map.of(
                        "previousScheduledDate", String.valueOf(task.scheduledDate()),
                        "targetDate", String.valueOf(command.targetDate()),
                        "overrideReason", String.valueOf(command.overrideReason())),
                taskSnapshot(task),
                taskSnapshot(rescheduled),
                /* idempotencyKey */ null);
    }

    @Transactional
    public void cancelTask(ExecutionCommands.CancelTask command) {
        TaskInstanceView task = taskRepo
                .findById(command.taskId())
                .orElseThrow(() -> new DomainException(404, "TASK_NOT_FOUND", "任务不存在"));

        if (!"PENDING".equals(task.status()) && !"BLOCKED".equals(task.status())) {
            throw new DomainException(409, "TASK_NOT_CANCELLABLE", "只能取消待处理或阻塞的任务");
        }

        int updated = taskRepo.cancelTask(command.taskId(), command.expectedVersion(), clock.now(), actorId());
        if (updated == 0) {
            TaskInstanceView current = taskRepo.findById(command.taskId()).orElseThrow();
            throw new DomainException(
                    409,
                    "TASK_VERSION_CONFLICT",
                    "任务已被其他用户修改",
                    List.of(),
                    Map.of("id", current.id(), "version", current.version(), "status", current.status()));
        }

        TaskInstanceView cancelled = taskRepo.findById(command.taskId()).orElseThrow();
        writeAuditEvent(
                AuditAction.TASK_CANCELLED,
                command.taskId(),
                Map.of("reason", String.valueOf(command.reason())),
                taskSnapshot(task),
                taskSnapshot(cancelled),
                /* idempotencyKey */ null);
    }

    @Transactional
    public void lockTask(ExecutionCommands.LockTask command) {
        TaskInstanceView before = taskRepo
                .findById(command.taskId())
                .orElseThrow(() -> new DomainException(404, "TASK_NOT_FOUND", "任务不存在"));

        int updated = taskRepo.setLocked(
                command.taskId(), command.expectedVersion(), command.locked(), clock.now(), actorId());
        if (updated == 0) {
            TaskInstanceView current = taskRepo.findById(command.taskId()).orElseThrow();
            throw new DomainException(
                    409,
                    "TASK_VERSION_CONFLICT",
                    "任务已被其他用户修改或状态不允许锁定",
                    List.of(),
                    Map.of("id", current.id(), "version", current.version(), "status", current.status()));
        }

        TaskInstanceView after = taskRepo.findById(command.taskId()).orElseThrow();
        writeAuditEvent(
                AuditAction.TASK_LOCKED,
                command.taskId(),
                Map.of("locked", String.valueOf(command.locked())),
                taskSnapshot(before),
                taskSnapshot(after),
                /* idempotencyKey */ null);
    }

    /**
     * SDD §11 — 解锁任务. Clears the {@code locked} flag on a task instance so it becomes eligible
     * for carry-over / completion again. Mirrors {@link #lockTask} but emits a distinct {@link
     * AuditAction#TASK_UNLOCKED} event for traceability. Idempotent: if the task is already
     * unlocked the {@link TaskInstanceRepository#setLocked} update is a guarded no-op; to keep the
     * audit trail honest we still require the client to read the current version first and surface
     * a 409 on conflict.
     */
    @Transactional
    public void unlockTask(ExecutionCommands.UnlockTask command) {
        TaskInstanceView before = taskRepo
                .findById(command.taskId())
                .orElseThrow(() -> new DomainException(404, "TASK_NOT_FOUND", "任务不存在"));

        int updated = taskRepo.setLocked(
                command.taskId(), command.expectedVersion(), false, clock.now(), actorId());
        if (updated == 0) {
            TaskInstanceView current = taskRepo.findById(command.taskId()).orElseThrow();
            throw new DomainException(
                    409,
                    "TASK_VERSION_CONFLICT",
                    "任务已被其他用户修改或状态不允许解锁",
                    List.of(),
                    Map.of("id", current.id(), "version", current.version(), "status", current.status()));
        }

        TaskInstanceView after = taskRepo.findById(command.taskId()).orElseThrow();
        writeAuditEvent(
                AuditAction.TASK_UNLOCKED,
                command.taskId(),
                Map.of("locked", "false"),
                taskSnapshot(before),
                taskSnapshot(after),
                /* idempotencyKey */ null);
    }

    /**
     * TickTick-style PATCH. Updates user-editable fields (title, note, priority, star) under
     * optimistic-lock guard. Null fields are ignored so callers can issue partial updates. When
     * the title changes, the short title snapshot is recomputed (truncated to 80 chars) to mirror
     * the {@code createAdHocTask} behavior.
     */
    @Transactional
    public TaskInstanceView updateTask(ExecutionCommands.UpdateTask command) {
        TaskInstanceView before = taskRepo
                .findById(command.taskId())
                .orElseThrow(() -> new DomainException(404, "TASK_NOT_FOUND", "任务不存在"));

        if (command.priority() != null && !isValidPriority(command.priority())) {
            throw new DomainException(422, "TASK_PRIORITY_INVALID", "优先级必须为 NONE/LOW/MEDIUM/HIGH");
        }

        String shortTitle = null;
        if (command.title() != null) {
            String trimmed = command.title().trim();
            if (trimmed.isEmpty()) {
                throw new DomainException(422, "TASK_TITLE_EMPTY", "任务标题不能为空");
            }
            shortTitle = trimmed.length() > 80 ? trimmed.substring(0, 80) : trimmed;
        }

        int updated = taskRepo.updateTask(
                command.taskId(),
                command.expectedVersion(),
                command.title() != null ? command.title().trim() : null,
                shortTitle,
                command.note(),
                command.priority(),
                command.star(),
                clock.now(),
                actorId());
        if (updated == 0) {
            TaskInstanceView current = taskRepo.findById(command.taskId()).orElseThrow();
            throw new DomainException(
                    409,
                    "TASK_VERSION_CONFLICT",
                    "任务已被其他用户修改",
                    List.of(),
                    Map.of("id", current.id(), "version", current.version(), "status", current.status()));
        }

        TaskInstanceView after = taskRepo.findById(command.taskId()).orElseThrow();
        Map<String, Object> metadata = new LinkedHashMap<>();
        if (command.title() != null) {
            metadata.put("title", String.valueOf(command.title()));
        }
        if (command.note() != null) {
            metadata.put("noteUpdated", "true");
        }
        if (command.priority() != null) {
            metadata.put("priority", command.priority());
        }
        if (command.star() != null) {
            metadata.put("star", String.valueOf(command.star()));
        }
        writeAuditEvent(
                AuditAction.TASK_UPDATED,
                command.taskId(),
                metadata,
                taskSnapshot(before),
                taskSnapshot(after),
                /* idempotencyKey */ null);
        return after;
    }

    /**
     * POST /tasks/{taskId}/duplicate. Copies a task instance into a new AD_HOC instance on the
     * target date (defaults to the source's scheduled date). The duplicate starts at PENDING and
     * resets all carry-over/completion/cancellation audit columns while preserving editable fields
     * (title, note, priority, star, duration, device requirement, locked).
     */
    @Transactional
    public ExecutionViews.DuplicateTaskResult duplicateTask(ExecutionCommands.DuplicateTask command) {
        TaskInstanceView source = taskRepo
                .findById(command.taskId())
                .orElseThrow(() -> new DomainException(404, "TASK_NOT_FOUND", "任务不存在"));

        // BR-012: optimistic-lock guard on the source so a concurrent mutation does not silently
        // produce a stale duplicate. The source row is not mutated, but we still require the
        // caller to have read the current version first.
        if (source.version() != command.expectedVersion()) {
            throw new DomainException(
                    409,
                    "TASK_VERSION_CONFLICT",
                    "任务已被其他用户修改",
                    List.of(),
                    Map.of("id", source.id(), "version", source.version(), "status", source.status()));
        }

        LocalDate targetDate = command.targetDate() != null ? command.targetDate() : source.scheduledDate();
        String title = source.titleSnapshot();
        String shortTitle = source.shortTitleSnapshot() != null
                ? source.shortTitleSnapshot()
                : (title.length() > 80 ? title.substring(0, 80) : title);
        String priority = source.priority() != null ? source.priority() : "NONE";
        boolean star = source.star();
        boolean locked = source.locked();

        UUID newId = idGenerator.next();
        TaskInstanceView created = taskRepo.duplicateTaskInstance(
                newId,
                source.studentId(),
                targetDate,
                title,
                shortTitle,
                source.durationMinutesSnapshot(),
                source.requiresDeviceSnapshot(),
                locked,
                source.note(),
                priority,
                star,
                clock.now(),
                actorId());

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("sourceTaskId", String.valueOf(source.id()));
        metadata.put("targetDate", String.valueOf(targetDate));
        writeAuditEvent(
                AuditAction.TASK_DUPLICATED,
                created.id(),
                metadata,
                taskSnapshot(source),
                taskSnapshot(created),
                /* idempotencyKey */ null);

        return new ExecutionViews.DuplicateTaskResult(
                source.id(),
                created.id(),
                created.scheduledDate(),
                created.version(),
                created.updatedAt());
    }

    /**
     * POST /tasks/{taskId}/subtasks. Creates a child AD_HOC task pointing at the parent via
     * {@code parent_task_id}. Inherits the parent's student_id and scheduled date (when the
     * caller omits one). Priority defaults to NONE when not supplied.
     */
    @Transactional
    public ExecutionViews.CreateSubTaskResult createSubTask(ExecutionCommands.CreateSubTask command) {
        TaskInstanceView parent = taskRepo
                .findById(command.taskId())
                .orElseThrow(() -> new DomainException(404, "TASK_NOT_FOUND", "父任务不存在"));

        String trimmedTitle = command.title() == null ? "" : command.title().trim();
        if (trimmedTitle.isEmpty()) {
            throw new DomainException(422, "TASK_TITLE_EMPTY", "子任务标题不能为空");
        }
        String priority = command.priority() != null ? command.priority() : "NONE";
        if (!isValidPriority(priority)) {
            throw new DomainException(422, "TASK_PRIORITY_INVALID", "优先级必须为 NONE/LOW/MEDIUM/HIGH");
        }
        LocalDate scheduledDate = command.scheduledDate() != null ? command.scheduledDate() : parent.scheduledDate();
        String shortTitle = trimmedTitle.length() > 80 ? trimmedTitle.substring(0, 80) : trimmedTitle;

        UUID newId = idGenerator.next();
        TaskInstanceView sub = taskRepo.insertSubTaskInstance(
                newId,
                parent.studentId(),
                parent.id(),
                scheduledDate,
                trimmedTitle,
                shortTitle,
                priority,
                clock.now(),
                actorId());

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("parentTaskId", String.valueOf(parent.id()));
        metadata.put("title", trimmedTitle);
        metadata.put("priority", priority);
        writeAuditEvent(
                AuditAction.TASK_SUBTASK_CREATED,
                sub.id(),
                metadata,
                taskSnapshot(parent),
                taskSnapshot(sub),
                /* idempotencyKey */ null);

        return new ExecutionViews.CreateSubTaskResult(
                parent.id(), sub.id(), sub.version(), sub.updatedAt());
    }

    /**
     * POST /tasks/{taskId}/link. Associates a task with a non-parent main task by setting
     * {@code linked_parent_task_id}. Guarded by optimistic version. Rejects self-link.
     */
    @Transactional
    public TaskInstanceView linkMainTask(ExecutionCommands.LinkMainTask command) {
        TaskInstanceView before = taskRepo
                .findById(command.taskId())
                .orElseThrow(() -> new DomainException(404, "TASK_NOT_FOUND", "任务不存在"));

        if (command.linkedParentTaskId() == null) {
            throw new DomainException(422, "TASK_LINK_TARGET_MISSING", "关联主任务 ID 不能为空");
        }
        if (command.linkedParentTaskId().equals(command.taskId())) {
            throw new DomainException(422, "TASK_LINK_SELF", "不能关联自身作为主任务");
        }
        // Verify the linked parent exists in the same tenant to prevent cross-tenant links.
        TaskInstanceView linkedParent = taskRepo
                .findById(command.linkedParentTaskId())
                .orElseThrow(() -> new DomainException(404, "TASK_NOT_FOUND", "关联主任务不存在"));

        int updated = taskRepo.linkMainTask(
                command.taskId(),
                command.expectedVersion(),
                command.linkedParentTaskId(),
                clock.now(),
                actorId());
        if (updated == 0) {
            TaskInstanceView current = taskRepo.findById(command.taskId()).orElseThrow();
            throw new DomainException(
                    409,
                    "TASK_VERSION_CONFLICT",
                    "任务已被其他用户修改",
                    List.of(),
                    Map.of("id", current.id(), "version", current.version(), "status", current.status()));
        }

        TaskInstanceView after = taskRepo.findById(command.taskId()).orElseThrow();
        writeAuditEvent(
                AuditAction.TASK_LINKED,
                command.taskId(),
                Map.of(
                        "linkedParentTaskId", String.valueOf(command.linkedParentTaskId()),
                        "linkedParentTitle", String.valueOf(linkedParent.titleSnapshot())),
                taskSnapshot(before),
                taskSnapshot(after),
                /* idempotencyKey */ null);
        return after;
    }

    /**
     * DELETE /tasks/{taskId}. Physically deletes a task instance. Only AD_HOC, IMPORT, or
     * track-less tasks are deletable; TRACK tasks (track_id IS NOT NULL AND source_type='TRACK')
     * are rejected with 409 and a prompt to use cancel instead. Guarded by optimistic version so a
     * concurrent mutation surfaces as a 409 rather than a silent delete.
     */
    @Transactional
    public void deleteTask(ExecutionCommands.DeleteTask command) {
        TaskInstanceView before = taskRepo
                .findById(command.taskId())
                .orElseThrow(() -> new DomainException(404, "TASK_NOT_FOUND", "任务不存在"));

        if ("TRACK".equals(before.sourceType()) && before.trackId() != null) {
            throw new DomainException(
                    409,
                    "TASK_DELETE_TRACK_NOT_ALLOWED",
                    "TRACK 类型任务不可物理删除，请使用 cancel");
        }

        int deleted = taskRepo.deleteTask(command.taskId(), command.expectedVersion(), clock.now(), actorId());
        if (deleted == 0) {
            TaskInstanceView current = taskRepo.findById(command.taskId()).orElseThrow();
            throw new DomainException(
                    409,
                    "TASK_VERSION_CONFLICT",
                    "任务已被其他用户修改",
                    List.of(),
                    Map.of("id", current.id(), "version", current.version(), "status", current.status()));
        }

        writeAuditEvent(
                AuditAction.TASK_DELETED,
                command.taskId(),
                Map.of("deletedAt", String.valueOf(clock.now())),
                taskSnapshot(before),
                Map.of(),
                /* idempotencyKey */ null);
    }

    /**
     * POST /tasks/{taskId}/reorder. Adjusts the manual sort order of a task instance. Guarded by
     * optimistic version. The caller supplies the absolute new sort order value; sibling reordering
     * (normalization) is the client's responsibility under the absolute-positioning model.
     */
    @Transactional
    public TaskInstanceView reorderTask(ExecutionCommands.ReorderTask command) {
        TaskInstanceView before = taskRepo
                .findById(command.taskId())
                .orElseThrow(() -> new DomainException(404, "TASK_NOT_FOUND", "任务不存在"));

        int updated = taskRepo.reorderTask(
                command.taskId(),
                command.expectedVersion(),
                command.newSortOrder(),
                clock.now(),
                actorId());
        if (updated == 0) {
            TaskInstanceView current = taskRepo.findById(command.taskId()).orElseThrow();
            throw new DomainException(
                    409,
                    "TASK_VERSION_CONFLICT",
                    "任务已被其他用户修改",
                    List.of(),
                    Map.of("id", current.id(), "version", current.version(), "status", current.status()));
        }

        TaskInstanceView after = taskRepo.findById(command.taskId()).orElseThrow();
        writeAuditEvent(
                AuditAction.TASK_REORDERED,
                command.taskId(),
                Map.of(
                        "previousSortOrder", String.valueOf(before.sortOrder()),
                        "newSortOrder", String.valueOf(command.newSortOrder())),
                taskSnapshot(before),
                taskSnapshot(after),
                /* idempotencyKey */ null);
        return after;
    }

    private static boolean isValidPriority(String priority) {
        return "NONE".equals(priority) || "LOW".equals(priority) || "MEDIUM".equals(priority) || "HIGH".equals(priority);
    }

    @Transactional(readOnly = true)
    public List<TaskInstanceView> listTasksByStudentAndDate(UUID studentId, LocalDate date) {
        return taskRepo.findPendingByStudentAndDate(studentId, date);
    }

    @Transactional(readOnly = true)
    public List<TaskInstanceView> listTasksByStudentAndDateRange(UUID studentId, LocalDate fromDate, LocalDate toDate) {
        return taskRepo.findByStudentAndDateRange(studentId, fromDate, toDate);
    }

    @Transactional(readOnly = true)
    public TaskInstanceView getTask(UUID taskId) {
        return taskRepo
                .findById(taskId)
                .orElseThrow(() -> new DomainException(404, "TASK_NOT_FOUND", "任务不存在"));
    }

    private CompleteTaskResult buildCompleteResult(TaskInstanceView task) {
        UUID trackId = task.trackId();
        String trackStatus = null;
        Integer trackCurrentOrdinal = null;
        Integer nextOrdinal = null;
        LocalDate nextDate = null;

        if (trackId != null) {
            try {
                var track = trackService.getTrack(trackId);
                trackStatus = track.status();
                trackCurrentOrdinal = track.currentOrdinal();
                nextOrdinal = track.currentOrdinal() <= track.endOrdinal() ? track.currentOrdinal() : null;
                nextDate = track.nextCandidateDate();
            } catch (DomainException ignored) {
            }
        }

        return new CompleteTaskResult(
                task.id(),
                task.status(),
                trackId,
                trackCurrentOrdinal,
                trackStatus,
                nextOrdinal,
                nextDate,
                task.version(),
                task.updatedAt());
    }

    private LocalDate findNextAvailableDate(UUID studentId, Boolean requiresDevice, LocalDate afterDate) {
        return availabilityService
                .findNextAvailableDate(studentId, afterDate, requiresDevice, 90, List.of())
                .orElse(null);
    }

    /**
     * AC-007 / BR-008: a task requires a device when its template snapshot marks
     * {@code requiresDevice} as true. Null (unset) snapshots are treated as not requiring a
     * device so legacy rows are not blocked.
     */
    private static boolean requiresDevice(TaskInstanceView task) {
        return task.requiresDeviceSnapshot() != null && task.requiresDeviceSnapshot();
    }

    /**
     * AC-007 / BR-008: a day admits a device-requiring task only when its effective device policy
     * is {@code ALLOWED}. {@code NOT_ALLOWED} is a hard block; {@code CONFIRM} means a human must
     * approve device use on that day, so it is not auto-schedulable and is rejected here.
     */
    private static boolean isDeviceAllowed(AvailabilityService.EffectiveAvailability avail) {
        return "ALLOWED".equals(avail.devicePolicy());
    }

    /**
     * Records an audit event via {@link AuditService}, capturing the real before/after state of
     * the mutated task instance (BR-015/AC-008/AC-014). Deduplicates by {@code idempotencyKey}
     * when supplied so retried operations do not produce duplicate events.
     */
    private void writeAuditEvent(
            AuditAction action,
            UUID targetId,
            Map<String, Object> metadata,
            Map<String, Object> before,
            Map<String, Object> after,
            String idempotencyKey) {
        auditService.recordEvent(
                action,
                TARGET_TYPE_TASK_INSTANCE,
                targetId,
                metadata,
                before,
                after,
                idempotencyKey,
                /* actorRoleOverride */ null);
    }

    /**
     * Captures the audit-relevant fields of a task instance for the before/after snapshot.
     * Only values that BR-015/AC-008/AC-014 require to reconstruct the change are included;
     * free-text notes are excluded to avoid leaking sensitive content into the audit trail.
     */
    private static Map<String, Object> taskSnapshot(TaskInstanceView task) {
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("status", task.status());
        snapshot.put("scheduledDate", task.scheduledDate() == null ? null : task.scheduledDate().toString());
        snapshot.put("locked", task.locked());
        snapshot.put("version", task.version());
        snapshot.put("title", task.titleSnapshot());
        snapshot.put("priority", task.priority());
        snapshot.put("star", task.star());
        snapshot.put("sortOrder", task.sortOrder());
        snapshot.put("parentTaskId", task.parentTaskId());
        snapshot.put("linkedParentTaskId", task.linkedParentTaskId());
        if (task.carriedToInstanceId() != null) {
            snapshot.put("carriedToInstanceId", task.carriedToInstanceId());
        }
        if (task.carriedFromInstanceId() != null) {
            snapshot.put("carriedFromInstanceId", task.carriedFromInstanceId());
        }
        return snapshot;
    }

    /** Two-instance snapshot variant used by carry-over / undo-carry-over where source+target move together. */
    private static Map<String, Object> taskSnapshot(TaskInstanceView source, TaskInstanceView target) {
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("source", taskSnapshot(source));
        snapshot.put("target", taskSnapshot(target));
        return snapshot;
    }

    private static UUID actorId() {
        return TaskInstanceRepository.actorId();
    }
}
