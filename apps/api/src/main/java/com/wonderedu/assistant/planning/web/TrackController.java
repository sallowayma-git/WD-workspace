package com.wonderedu.assistant.planning.web;

import com.wonderedu.assistant.planning.api.TrackCommands.CancelTrack;
import com.wonderedu.assistant.planning.api.TrackCommands.MountTrack;
import com.wonderedu.assistant.planning.api.TrackCommands.PauseTrack;
import com.wonderedu.assistant.planning.api.TrackCommands.ResumeTrack;
import com.wonderedu.assistant.planning.api.TrackCommands.ScheduleItems;
import com.wonderedu.assistant.planning.api.TrackView;
import com.wonderedu.assistant.planning.application.SchedulingService;
import com.wonderedu.assistant.planning.application.SchedulingService.ScheduleResult;
import com.wonderedu.assistant.planning.application.TrackService;
import java.net.URI;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class TrackController {

    private final TrackService service;
    private final SchedulingService schedulingService;

    public TrackController(TrackService service, SchedulingService schedulingService) {
        this.service = service;
        this.schedulingService = schedulingService;
    }

    @PostMapping("/students/{studentId}/tracks")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public ResponseEntity<TrackView> mount(
            @PathVariable UUID studentId, @RequestBody MountTrack command) {
        MountTrack scoped =
                new MountTrack(
                        studentId,
                        command.templateId(),
                        command.templateVersionId(),
                        command.startOrdinal(),
                        command.endOrdinal(),
                        command.startDate(),
                        command.defaultUnitsPerSession(),
                        command.priority(),
                        command.schedulingPolicy(),
                        command.durationOverrideMinutes(),
                        command.devicePolicyOverride(),
                        command.note(),
                        command.createFirstInstance(),
                        command.confirmOverride());
        TrackView created = service.mountTrack(scoped);
        if (created.id() == null) {
            return ResponseEntity.ok(created);
        }
        return ResponseEntity.created(URI.create("/api/v1/tracks/" + created.id())).body(created);
    }

    @GetMapping("/students/{studentId}/tracks")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT', 'VIEWER')")
    public List<TrackView> listStudentTracks(
            @PathVariable UUID studentId,
            @RequestParam(required = false) String status) {
        return service.listStudentTracks(studentId, status);
    }

    @GetMapping("/tracks/{trackId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT', 'VIEWER')")
    public TrackView get(@PathVariable UUID trackId) {
        return service.getTrack(trackId);
    }

    /**
     * SDD §11.5 — 安排连续单元. Schedules {@code unitCount} contiguous items starting at {@code
     * startOrdinal} (which must equal the track's current ordinal unless {@code manualOverride} is
     * set) for the given preferred {@code date}. The service rolls individual instances forward to the
     * next learnable, device-admissible day when the preferred day is blocked, and returns any such
     * adjustments as warnings on the result.
     */
    @PostMapping("/tracks/{trackId}/schedule-items")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public ScheduleResult scheduleItems(
            @PathVariable UUID trackId, @RequestBody ScheduleItems command) {
        return schedulingService.scheduleTrackItems(
                trackId,
                command.startOrdinal(),
                command.unitCount(),
                command.date(),
                command.manualOverride(),
                command.overrideReason());
    }

    /**
     * SDD §11 — 暂停轨道. Transitions the track to PAUSED. Idempotent and optimistic-locked via
     * the command's {@code expectedVersion}.
     */
    @PostMapping("/tracks/{trackId}/pause")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public TrackView pause(
            @PathVariable UUID trackId, @RequestBody(required = false) PauseTrack command) {
        return service.pauseTrack(
                new PauseTrack(
                        trackId,
                        command == null ? 0L : command.expectedVersion()));
    }

    /**
     * SDD §11 — 恢复轨道. Transitions a PAUSED track back to ACTIVE (or COMPLETED when the pointer
     * has advanced past the end ordinal while paused).
     */
    @PostMapping("/tracks/{trackId}/resume")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public TrackView resume(
            @PathVariable UUID trackId, @RequestBody(required = false) ResumeTrack command) {
        return service.resumeTrack(
                new ResumeTrack(
                        trackId,
                        command == null ? 0L : command.expectedVersion()));
    }

    /**
     * SDD §11 — 终止轨道. Transitions the track to the terminal CANCELLED status. The track
     * becomes immutable afterwards and is excluded from scheduling and pointer recalculation.
     */
    @PostMapping("/tracks/{trackId}/cancel")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public TrackView cancel(
            @PathVariable UUID trackId, @RequestBody(required = false) CancelTrack command) {
        return service.cancelTrack(
                new CancelTrack(
                        trackId,
                        command == null ? 0L : command.expectedVersion(),
                        command == null ? null : command.reason()));
    }
}
