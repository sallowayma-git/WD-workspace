package com.wonderedu.assistant.planning.application;

import com.wonderedu.assistant.planning.api.TaskInstanceView;
import com.wonderedu.assistant.planning.api.TrackView;
import com.wonderedu.assistant.planning.persistence.CurriculumLookup;
import com.wonderedu.assistant.planning.persistence.CurriculumLookup.ItemSnapshot;
import com.wonderedu.assistant.planning.persistence.TaskInstanceRepository;
import com.wonderedu.assistant.planning.persistence.TrackRepository;
import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.DomainException;
import com.wonderedu.assistant.shared.IdGenerator;
import com.wonderedu.assistant.student.application.AvailabilityService;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SchedulingService {

    private final TrackRepository trackRepository;
    private final TaskInstanceRepository taskInstanceRepository;
    private final CurriculumLookup curriculumLookup;
    private final BusinessClock clock;
    private final IdGenerator idGenerator;
    private final AvailabilityService availabilityService;

    public SchedulingService(
            TrackRepository trackRepository,
            TaskInstanceRepository taskInstanceRepository,
            CurriculumLookup curriculumLookup,
            BusinessClock clock,
            IdGenerator idGenerator,
            AvailabilityService availabilityService) {
        this.trackRepository = trackRepository;
        this.taskInstanceRepository = taskInstanceRepository;
        this.curriculumLookup = curriculumLookup;
        this.clock = clock;
        this.idGenerator = idGenerator;
        this.availabilityService = availabilityService;
    }

    /**
     * Create one task_instance per ordinal in [startOrdinal, startOrdinal + unitCount - 1]. Ordinals
     * must be contiguous from the track's currentOrdinal. If a PENDING instance already exists for
     * an ordinal, the existing instance is returned (idempotent).
     *
     * <p>AC-007 / BR-008: the supplied {@code date} is the preferred scheduling day, not a guarantee.
     * Before inserting each instance the service resolves the effective availability for that day;
     * when the day is not learnable or its device policy does not admit the item's required-device
     * flag, the instance rolls forward to the next available day (via {@link
     * AvailabilityService#findNextAvailableDate}) rather than being silently scheduled onto an
     * invalid day. The track pointer (currentOrdinal) algorithm is untouched — instances are still
     * created in ordinal order; only their calendar dates may shift.
     */
    @Transactional
    public ScheduleResult scheduleTrackItems(
            UUID trackId, int startOrdinal, int unitCount, LocalDate date, boolean manualOverride, String overrideReason) {
        if (unitCount < 1) {
            throw new DomainException(422, "SCHEDULE_UNIT_COUNT_INVALID", "单元数必须大于 0");
        }
        if (date == null) {
            throw new DomainException(422, "SCHEDULE_DATE_REQUIRED", "排期日期不能为空");
        }
        TrackView track =
                trackRepository
                        .findById(trackId)
                        .orElseThrow(() -> new DomainException(404, "TRACK_NOT_FOUND", "轨道不存在"));
        if ("COMPLETED".equals(track.status()) || "CANCELLED".equals(track.status())) {
            throw new DomainException(409, "TRACK_IMMUTABLE", "已完成或已取消的轨道不能排期", List.of(), java.util.Map.of("status", track.status()));
        }
        int endOrdinal = startOrdinal + unitCount - 1;
        if (startOrdinal != track.currentOrdinal()) {
            throw new DomainException(
                    422,
                    "SCHEDULE_ORDINAL_NOT_FROM_POINTER",
                    "排期必须从当前指针 " + track.currentOrdinal() + " 开始连续",
                    List.of(),
                    java.util.Map.of("startOrdinal", startOrdinal, "currentOrdinal", track.currentOrdinal()));
        }
        if (endOrdinal > track.endOrdinal()) {
            throw new DomainException(
                    422,
                    "SCHEDULE_ORDINAL_OUT_OF_RANGE",
                    "排期序号超出轨道结束单元 " + track.endOrdinal(),
                    List.of(),
                    java.util.Map.of("endOrdinal", endOrdinal, "trackEndOrdinal", track.endOrdinal()));
        }
        List<ItemSnapshot> items =
                curriculumLookup.findItemsByOrdinalRange(track.templateVersionId(), startOrdinal, endOrdinal);
        if (items.size() != unitCount) {
            throw new DomainException(
                    422,
                    "SCHEDULE_ORDINAL_GAP",
                    "模板单元在指定序号范围内存在缺失或非连续",
                    List.of(),
                    java.util.Map.of("expected", unitCount, "found", items.size()));
        }
        UUID actor = TaskInstanceRepository.actorId();
        Instant now = clock.now();
        List<TaskInstanceView> created = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        // AC-007 / BR-008: the caller-supplied date is a *preferred* scheduling day. Each instance
        // is materialized on the first day at or after that date that is learnable and whose device
        // policy admits the item's required-device flag. When the preferred day is blocked, the
        // instance rolls forward to the next available day instead of being dropped, mirroring the
        // carry-over path. The track pointer algorithm is unchanged: instances are still created in
        // ordinal order regardless of which calendar date each lands on.
        LocalDate candidateDate = date;
        for (ItemSnapshot item : items) {
            Optional<TaskInstanceView> existing =
                    taskInstanceRepository.findPendingForTrackOrdinal(trackId, item.ordinal());
            if (existing.isPresent()) {
                created.add(existing.get());
                warnings.add("序号 " + item.ordinal() + " 已存在待办实例，复用现有");
                continue;
            }
            boolean requiresDevice = resolveRequiresDevice(track, item);
            LocalDate resolvedDate = resolveScheduleDate(track.studentId(), candidateDate, requiresDevice);
            if (resolvedDate == null) {
                warnings.add("序号 " + item.ordinal() + " 在 " + candidateDate + " 起无可学习日，跳过");
                continue;
            }
            if (!resolvedDate.equals(date)) {
                warnings.add("序号 " + item.ordinal() + " 由 " + date + " 顺延至 " + resolvedDate);
            }
            TaskInstanceView instance =
                    taskInstanceRepository.insertTrackInstance(
                            idGenerator.next(),
                            track.studentId(),
                            trackId,
                            track.templateVersionId(),
                            item.itemId(),
                            item.ordinal(),
                            resolvedDate,
                            item.title(),
                            item.shortTitle(),
                            track.durationOverrideMinutes() != null
                                    ? track.durationOverrideMinutes()
                                    : item.durationMinutes(),
                            requiresDevice,
                            manualOverride ? "MANUAL" : "AUTO",
                            manualOverride,
                            overrideReason,
                            false,
                            null,
                            null,
                            now,
                            actor);
            created.add(instance);
            // Advance the candidate so a later item in the same batch is not piled onto the same
            // resolved day when the preferred date was blocked; subsequent items roll forward from
            // the day after the one just scheduled.
            candidateDate = resolvedDate.plusDays(1);
        }
        return new ScheduleResult(created, warnings);
    }

    /**
     * AC-007 / BR-008: returns the first day at or after {@code preferredDate} that is learnable and
     * whose effective device policy admits a task with the given {@code requiresDevice} flag. Returns
     * {@code null} when no such day exists within the 90-day horizon, mirroring the carry-over path's
     * BLOCKED outcome. The preferred date itself is checked first so the common case (the day is
     * available) does not silently shift the schedule.
     */
    private LocalDate resolveScheduleDate(UUID studentId, LocalDate preferredDate, boolean requiresDevice) {
        AvailabilityService.EffectiveAvailability preferred =
                availabilityService.resolveEffectiveAvailability(studentId, preferredDate);
        if (preferred.available() && isDeviceAdmissible(preferred, requiresDevice)) {
            return preferredDate;
        }
        return availabilityService
                .findNextAvailableDate(studentId, preferredDate, requiresDevice, 90, List.of())
                .orElse(null);
    }

    /**
     * AC-007 / BR-008: a device-requiring task is admissible only on a day whose effective device
     * policy is {@code ALLOWED}. {@code NOT_ALLOWED} is a hard block; {@code CONFIRM} means a human
     * must approve device use on that day, so it is not auto-schedulable. Tasks that do not require a
     * device are admissible on any learnable day regardless of policy.
     */
    private static boolean isDeviceAdmissible(
            AvailabilityService.EffectiveAvailability avail, boolean requiresDevice) {
        if (!requiresDevice) {
            return true;
        }
        return "ALLOWED".equals(avail.devicePolicy());
    }

    @Transactional
    public TaskInstanceView createAdHocTask(
            UUID studentId,
            LocalDate scheduledDate,
            String title,
            Integer durationMinutes,
            Boolean requiresDevice,
            boolean locked,
            String note) {
        if (!curriculumLookup.studentExistsInOrg(studentId)) {
            throw new DomainException(404, "STUDENT_NOT_FOUND", "学生不存在");
        }
        if (scheduledDate == null) {
            throw new DomainException(422, "ADHOC_DATE_REQUIRED", "排期日期不能为空");
        }
        if (title == null || title.isBlank()) {
            throw new DomainException(422, "ADHOC_TITLE_REQUIRED", "标题不能为空");
        }
        if (title.length() > 500) {
            throw new DomainException(422, "ADHOC_TITLE_TOO_LONG", "标题长度不能超过 500");
        }
        if (durationMinutes != null && (durationMinutes < 1 || durationMinutes > 1440)) {
            throw new DomainException(422, "ADHOC_DURATION_INVALID", "时长必须在 1 到 1440 分钟之间");
        }
        String trimmedTitle = title.trim();
        String shortTitle = trimmedTitle.length() > 80 ? trimmedTitle.substring(0, 80) : trimmedTitle;
        return taskInstanceRepository.insertAdHocInstance(
                idGenerator.next(),
                studentId,
                scheduledDate,
                trimmedTitle,
                shortTitle,
                durationMinutes,
                requiresDevice,
                locked,
                note,
                clock.now(),
                TaskInstanceRepository.actorId());
    }

    private boolean resolveRequiresDevice(TrackView track, ItemSnapshot item) {
        if (track.devicePolicyOverride() != null) {
            return "ALLOWED".equals(track.devicePolicyOverride());
        }
        return item.requiresDevice();
    }

    public record ScheduleResult(List<TaskInstanceView> instances, List<String> warnings) {}
}
