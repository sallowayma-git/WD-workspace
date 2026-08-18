package com.wonderedu.assistant.planning.application;

import com.wonderedu.assistant.planning.api.TrackCommands.CancelTrack;
import com.wonderedu.assistant.planning.api.TrackCommands.MountTrack;
import com.wonderedu.assistant.planning.api.TrackCommands.PauseTrack;
import com.wonderedu.assistant.planning.api.TrackCommands.ResumeTrack;
import com.wonderedu.assistant.planning.api.TrackView;
import com.wonderedu.assistant.planning.api.TrackView.TrackProgress;
import com.wonderedu.assistant.planning.persistence.CurriculumLookup;
import com.wonderedu.assistant.planning.persistence.CurriculumLookup.ItemSnapshot;
import com.wonderedu.assistant.planning.persistence.CurriculumLookup.TemplateState;
import com.wonderedu.assistant.planning.persistence.TrackRepository;
import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.DomainException;
import com.wonderedu.assistant.shared.IdGenerator;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TrackService {

    private final TrackRepository repository;
    private final CurriculumLookup curriculumLookup;
    private final SchedulingService schedulingService;
    private final BusinessClock clock;
    private final IdGenerator idGenerator;
    private final String timezone;

    @org.springframework.beans.factory.annotation.Autowired
    public TrackService(
            TrackRepository repository,
            CurriculumLookup curriculumLookup,
            SchedulingService schedulingService,
            BusinessClock clock,
            IdGenerator idGenerator,
            com.wonderedu.assistant.identity.IdentityProperties properties) {
        this(
                repository,
                curriculumLookup,
                schedulingService,
                clock,
                idGenerator,
                properties.businessTimezone());
    }

    TrackService(
            TrackRepository repository,
            CurriculumLookup curriculumLookup,
            SchedulingService schedulingService,
            BusinessClock clock,
            IdGenerator idGenerator,
            String timezone) {
        this.repository = repository;
        this.curriculumLookup = curriculumLookup;
        this.schedulingService = schedulingService;
        this.clock = clock;
        this.idGenerator = idGenerator;
        this.timezone = timezone;
    }

    @Transactional
    public TrackView mountTrack(MountTrack command) {
        validateMount(command);
        if (!curriculumLookup.studentExistsInOrg(command.studentId())) {
            throw new DomainException(404, "STUDENT_NOT_FOUND", "学生不存在");
        }
        TemplateState template =
                curriculumLookup
                        .findTemplateState(command.templateId(), command.templateVersionId())
                        .orElseThrow(
                                () ->
                                        new DomainException(
                                                404,
                                                "TEMPLATE_OR_VERSION_NOT_FOUND",
                                                "模板或版本不存在"));
        if (!"PUBLISHED".equals(template.versionStatus())) {
            throw new DomainException(409, "TEMPLATE_VERSION_NOT_PUBLISHED", "模板版本必须为已发布状态");
        }
        validateOrdinalRange(command, template);
        int duplicateCount =
                repository.countActiveByStudentTemplate(
                        command.studentId(), command.templateId(), null);
        List<String> warnings = new ArrayList<>();
        if (duplicateCount > 0) {
            warnings.add("该学生已存在同模板的活跃轨道");
        }
        if (!command.confirmOverride() && !warnings.isEmpty()) {
            // Return a warning-bearing result without persisting; the caller confirms and retries.
            TrackView preview =
                    TrackView.from(
                            null,
                            command.studentId(),
                            command.templateId(),
                            command.templateVersionId(),
                            "NOT_STARTED",
                            command.startOrdinal(),
                            command.startOrdinal(),
                            command.endOrdinal(),
                            command.defaultUnitsPerSession() == null ? 1 : command.defaultUnitsPerSession(),
                            command.startDate(),
                            command.startDate(),
                            command.priority(),
                            false,
                            command.schedulingPolicy(),
                            command.durationOverrideMinutes(),
                            command.devicePolicyOverride(),
                            command.note(),
                            null,
                            0,
                            clock.now());
            return preview.withWarnings(warnings);
        }
        TrackView track =
                TrackView.from(
                        null,
                        command.studentId(),
                        command.templateId(),
                        command.templateVersionId(),
                        "NOT_STARTED",
                        command.startOrdinal(),
                        command.startOrdinal(),
                        command.endOrdinal(),
                        command.defaultUnitsPerSession() == null ? 1 : command.defaultUnitsPerSession(),
                        command.startDate(),
                        command.startDate(),
                        command.priority(),
                        false,
                        command.schedulingPolicy(),
                        command.durationOverrideMinutes(),
                        command.devicePolicyOverride(),
                        command.note(),
                        null,
                        0,
                        clock.now());
        TrackView persisted = repository.insert(idGenerator.next(), track, false, clock.now(), TrackRepository.actorId());
        if (command.createFirstInstance()) {
            schedulingService.scheduleTrackItems(
                    persisted.id(),
                    persisted.currentOrdinal(),
                    Math.min(persisted.defaultUnitsPerSession(), persisted.endOrdinal() - persisted.currentOrdinal() + 1),
                    persisted.startDate(),
                    false,
                    null);
        }
        TrackView reloaded = getTrack(persisted.id());
        return reloaded.withWarnings(warnings);
    }

    @Transactional(readOnly = true)
    public TrackView getTrack(UUID trackId) {
        TrackView track =
                repository
                        .findById(trackId)
                        .orElseThrow(() -> new DomainException(404, "TRACK_NOT_FOUND", "轨道不存在"));
        return withProgress(track);
    }

    @Transactional(readOnly = true)
    public List<TrackView> listStudentTracks(UUID studentId, String status) {
        List<TrackView> tracks = repository.findByStudent(studentId, status);
        List<TrackView> result = new ArrayList<>(tracks.size());
        for (TrackView track : tracks) {
            result.add(withProgress(track));
        }
        return result;
    }

    /**
     * Recalculate the track pointer by scanning completed ordinals contiguously from the current
     * ordinal, advancing to the first uncompleted ordinal. Never simply returns currentOrdinal + 1.
     * Returns the recomputed pointer (does not persist; callers may persist via {@link
     * #recalculateAndPersist}).
     */
    public int calculateTrackPointer(UUID trackId) {
        TrackView track =
                repository
                        .findById(trackId)
                        .orElseThrow(() -> new DomainException(404, "TRACK_NOT_FOUND", "轨道不存在"));
        Set<Integer> completed = repository.findCompletedOrdinals(trackId);
        return advancePointer(track, completed);
    }

    /**
     * Acquire a pessimistic row lock on the track (SDD §19.2 lock ordering: track → task).
     * Used by execution mutations that need to serialize concurrent track/task updates.
     */
    @Transactional
    public void lockTrack(UUID trackId) {
        repository.lockById(trackId);
    }

    /**
     * Persist the recalculated pointer using optimistic locking. Retries a bounded number of times
     * on version conflict per SDD §9.3.
     */
    @Transactional
    public TrackView recalculateAndPersist(UUID trackId) {
        // Acquire a pessimistic row lock before reading the track so that concurrent
        // recalculations on the same track are serialized. This prevents the lost-update race
        // that optimistic locking alone cannot fully cover when multiple transactions read the
        // same version and compute pointers based on the same completed-ordinal snapshot.
        repository.lockById(trackId);
        int maxRetries = 3;
        for (int attempt = 0; attempt < maxRetries; attempt++) {
            TrackView track =
                    repository
                            .findById(trackId)
                            .orElseThrow(() -> new DomainException(404, "TRACK_NOT_FOUND", "轨道不存在"));
            Set<Integer> completed = repository.findCompletedOrdinals(trackId);
            int pointer = advancePointer(track, completed);
            String newStatus = pointer > track.endOrdinal() ? "COMPLETED" : "ACTIVE";
            java.time.Instant completedAt =
                    pointer > track.endOrdinal() ? clock.now() : null;
            int updated =
                    repository.updatePointer(
                            trackId,
                            pointer,
                            newStatus,
                            completedAt,
                            track.version(),
                            clock.now(),
                            TrackRepository.actorId());
            if (updated > 0) {
                return getTrack(trackId);
            }
        }
        TrackView current =
                repository
                        .findById(trackId)
                        .orElseThrow(() -> new DomainException(404, "TRACK_NOT_FOUND", "轨道不存在"));
        throw new DomainException(
                409,
                "TRACK_VERSION_CONFLICT",
                "轨道已被其他用户修改，指针更新失败",
                List.of(),
                Map.of(
                        "id",
                        current.id(),
                        "version",
                        current.version(),
                        "currentOrdinal",
                        current.currentOrdinal(),
                        "status",
                        current.status()));
    }

    /**
     * SDD §11 — 暂停轨道. Transitions a track from an active state (NOT_STARTED or ACTIVE) to
     * PAUSED. Uses optimistic locking; on version conflict the caller receives a 409 populated
     * with the current persisted state. Idempotent: a track already PAUSED is returned as-is
     * without bumping the version.
     */
    @Transactional
    public TrackView pauseTrack(PauseTrack command) {
        TrackView track =
                repository
                        .findById(command.trackId())
                        .orElseThrow(() -> new DomainException(404, "TRACK_NOT_FOUND", "轨道不存在"));
        if ("PAUSED".equals(track.status())) {
            return getTrack(command.trackId());
        }
        if (!"NOT_STARTED".equals(track.status()) && !"ACTIVE".equals(track.status())) {
            throw new DomainException(
                    409,
                    "TRACK_NOT_PAUSABLE",
                    "只能暂停未开始或活跃的轨道",
                    List.of(),
                    Map.of("id", track.id(), "version", track.version(), "status", track.status()));
        }
        int updated =
                repository.updateStatus(
                        command.trackId(), "PAUSED", command.expectedVersion(), clock.now(), TrackRepository.actorId());
        if (updated == 0) {
            TrackView current =
                    repository
                            .findById(command.trackId())
                            .orElseThrow(() -> new DomainException(404, "TRACK_NOT_FOUND", "轨道不存在"));
            throw new DomainException(
                    409,
                    "TRACK_VERSION_CONFLICT",
                    "轨道已被其他用户修改",
                    List.of(),
                    Map.of(
                            "id",
                            current.id(),
                            "version",
                            current.version(),
                            "currentOrdinal",
                            current.currentOrdinal(),
                            "status",
                            current.status()));
        }
        return getTrack(command.trackId());
    }

    /**
     * SDD §11 — 恢复轨道. Transitions a PAUSED track back to an active state. The resumed status
     * is resolved from the current pointer: ACTIVE when there are remaining uncompleted
     * ordinals, COMPLETED when the pointer has advanced past the end ordinal (the track finished
     * while paused). Idempotent: a track already ACTIVE or COMPLETED is returned as-is.
     */
    @Transactional
    public TrackView resumeTrack(ResumeTrack command) {
        TrackView track =
                repository
                        .findById(command.trackId())
                        .orElseThrow(() -> new DomainException(404, "TRACK_NOT_FOUND", "轨道不存在"));
        if ("ACTIVE".equals(track.status()) || "COMPLETED".equals(track.status())) {
            return getTrack(command.trackId());
        }
        if (!"PAUSED".equals(track.status())) {
            throw new DomainException(
                    409,
                    "TRACK_NOT_RESUMABLE",
                    "只能恢复已暂停的轨道",
                    List.of(),
                    Map.of("id", track.id(), "version", track.version(), "status", track.status()));
        }
        int pointer = calculateTrackPointer(command.trackId());
        String resumedStatus = pointer > track.endOrdinal() ? "COMPLETED" : "ACTIVE";
        int updated =
                repository.updateStatus(
                        command.trackId(), resumedStatus, command.expectedVersion(), clock.now(), TrackRepository.actorId());
        if (updated == 0) {
            TrackView current =
                    repository
                            .findById(command.trackId())
                            .orElseThrow(() -> new DomainException(404, "TRACK_NOT_FOUND", "轨道不存在"));
            throw new DomainException(
                    409,
                    "TRACK_VERSION_CONFLICT",
                    "轨道已被其他用户修改",
                    List.of(),
                    Map.of(
                            "id",
                            current.id(),
                            "version",
                            current.version(),
                            "currentOrdinal",
                            current.currentOrdinal(),
                            "status",
                            current.status()));
        }
        return getTrack(command.trackId());
    }

    /**
     * SDD §11 — 终止轨道. Transitions a track to the terminal CANCELLED status. Allowed from any
     * non-terminal status (NOT_STARTED, ACTIVE, PAUSED). Idempotent: a track already CANCELLED is
     * returned as-is. Once cancelled the track is immutable and excluded from scheduling and
     * pointer recalculation.
     */
    @Transactional
    public TrackView cancelTrack(CancelTrack command) {
        TrackView track =
                repository
                        .findById(command.trackId())
                        .orElseThrow(() -> new DomainException(404, "TRACK_NOT_FOUND", "轨道不存在"));
        if ("CANCELLED".equals(track.status())) {
            return getTrack(command.trackId());
        }
        if ("COMPLETED".equals(track.status())) {
            throw new DomainException(
                    409,
                    "TRACK_NOT_CANCELLABLE",
                    "已完成的轨道不能取消",
                    List.of(),
                    Map.of("id", track.id(), "version", track.version(), "status", track.status()));
        }
        int updated =
                repository.updateStatus(
                        command.trackId(), "CANCELLED", command.expectedVersion(), clock.now(), TrackRepository.actorId());
        if (updated == 0) {
            TrackView current =
                    repository
                            .findById(command.trackId())
                            .orElseThrow(() -> new DomainException(404, "TRACK_NOT_FOUND", "轨道不存在"));
            throw new DomainException(
                    409,
                    "TRACK_VERSION_CONFLICT",
                    "轨道已被其他用户修改",
                    List.of(),
                    Map.of(
                            "id",
                            current.id(),
                            "version",
                            current.version(),
                            "currentOrdinal",
                            current.currentOrdinal(),
                            "status",
                            current.status()));
        }
        return getTrack(command.trackId());
    }

    private int advancePointer(TrackView track, Set<Integer> completedOrdinals) {
        int pointer = track.currentOrdinal();
        while (pointer <= track.endOrdinal() && completedOrdinals.contains(pointer)) {
            pointer++;
        }
        return pointer;
    }

    private TrackView withProgress(TrackView track) {
        Set<Integer> completed = repository.findCompletedOrdinals(track.id());
        int totalUnits = track.endOrdinal() - track.startOrdinal() + 1;
        int completedUnits = 0;
        for (int ordinal = track.startOrdinal(); ordinal <= track.endOrdinal(); ordinal++) {
            if (completed.contains(ordinal)) {
                completedUnits++;
            }
        }
        int percent = totalUnits <= 0 ? 0 : Math.min(100, completedUnits * 100 / totalUnits);
        if ("COMPLETED".equals(track.status())) {
            percent = 100;
        }
        boolean outOfOrder = isOutOfOrder(track, completed);
        List<String> warnings = new ArrayList<>();
        if (outOfOrder) {
            warnings.add("顺序异常：存在后续单元先于当前单元完成");
        }
        TrackProgress progress =
                new TrackProgress(
                        track.currentOrdinal(),
                        track.endOrdinal(),
                        completedUnits,
                        totalUnits,
                        percent,
                        outOfOrder);
        TrackView rebuilt =
                new TrackView(
                        track.id(),
                        track.studentId(),
                        track.templateId(),
                        track.templateVersionId(),
                        track.status(),
                        track.startOrdinal(),
                        track.currentOrdinal(),
                        track.endOrdinal(),
                        track.defaultUnitsPerSession(),
                        track.startDate(),
                        track.nextCandidateDate(),
                        track.priority(),
                        track.allowParallelItems(),
                        track.schedulingPolicy(),
                        track.durationOverrideMinutes(),
                        track.devicePolicyOverride(),
                        track.note(),
                        track.completedAt(),
                        track.version(),
                        track.updatedAt(),
                        progress,
                        track.warnings());
        return warnings.isEmpty() ? rebuilt : rebuilt.withWarnings(warnings);
    }

    /**
     * AC-005: Detect out-of-order completion. The recalculated pointer is the first uncompleted
     * ordinal in the active range (see {@link #advancePointer}); the item at that ordinal is, by
     * definition, incomplete. If any later ordinal in the range is already COMPLETED, completion
     * happened out of order. The pointer algorithm itself is unchanged (it still scans
     * contiguously), so the pointer stays pinned at the first uncompleted ordinal; this flag merely
     * surfaces the anomaly so callers can display a "顺序异常" warning.
     */
    private boolean isOutOfOrder(TrackView track, Set<Integer> completedOrdinals) {
        int pointer = advancePointer(track, completedOrdinals);
        if (pointer > track.endOrdinal()) {
            // Track is fully completed contiguously; no out-of-order to report.
            return false;
        }
        for (int ordinal = pointer + 1; ordinal <= track.endOrdinal(); ordinal++) {
            if (completedOrdinals.contains(ordinal)) {
                return true;
            }
        }
        return false;
    }

    private void validateMount(MountTrack command) {
        if (command.studentId() == null) {
            throw new DomainException(422, "TRACK_STUDENT_REQUIRED", "学生不能为空");
        }
        if (command.templateId() == null || command.templateVersionId() == null) {
            throw new DomainException(422, "TRACK_TEMPLATE_REQUIRED", "模板和版本不能为空");
        }
        if (command.startOrdinal() < 1 || command.endOrdinal() < command.startOrdinal()) {
            throw new DomainException(422, "TRACK_ORDINAL_INVALID", "起始单元必须大于等于 1 且不大于结束单元");
        }
        if (command.startDate() == null) {
            throw new DomainException(422, "TRACK_START_DATE_REQUIRED", "开始日期不能为空");
        }
        if (command.priority() < 1 || command.priority() > 100) {
            throw new DomainException(422, "TRACK_PRIORITY_INVALID", "优先级必须在 1 到 100 之间");
        }
        if (!List.of("MANUAL", "ROLLING", "AUTO_CAPACITY").contains(command.schedulingPolicy())) {
            throw new DomainException(422, "TRACK_POLICY_INVALID", "排期策略无效");
        }
        if (command.devicePolicyOverride() != null
                && !List.of("ALLOWED", "NOT_ALLOWED", "CONFIRM").contains(command.devicePolicyOverride())) {
            throw new DomainException(422, "TRACK_DEVICE_POLICY_INVALID", "设备策略无效");
        }
    }

    private void validateOrdinalRange(MountTrack command, TemplateState template) {
        int expectedCount = command.endOrdinal() - command.startOrdinal() + 1;
        int actualCount =
                curriculumLookup.countItemsInOrdinalRange(
                        command.templateVersionId(), command.startOrdinal(), command.endOrdinal());
        if (actualCount != expectedCount) {
            throw new DomainException(
                    422,
                    "TRACK_ORDINAL_RANGE_INVALID",
                    "起始/结束单元必须在已发布版本的连续单元范围内");
        }
        Optional<ItemSnapshot> startItem =
                curriculumLookup.findItemByOrdinal(command.templateVersionId(), command.startOrdinal());
        if (startItem.isEmpty()) {
            throw new DomainException(422, "TRACK_START_ORDINAL_MISSING", "起始单元在模板中不存在");
        }
    }

    BusinessClock clock() {
        return clock;
    }

    TrackRepository repository() {
        return repository;
    }

    String timezone() {
        return timezone;
    }

    ZoneId zoneId() {
        return ZoneId.of(timezone);
    }
}
