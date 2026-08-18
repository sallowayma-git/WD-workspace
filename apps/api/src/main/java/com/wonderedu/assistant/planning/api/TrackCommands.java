package com.wonderedu.assistant.planning.api;

import java.time.LocalDate;
import java.util.UUID;

public final class TrackCommands {

    private TrackCommands() {}

    public record MountTrack(
            UUID studentId,
            UUID templateId,
            UUID templateVersionId,
            int startOrdinal,
            int endOrdinal,
            LocalDate startDate,
            Integer defaultUnitsPerSession,
            int priority,
            String schedulingPolicy,
            Integer durationOverrideMinutes,
            String devicePolicyOverride,
            String note,
            boolean createFirstInstance,
            boolean confirmOverride) {}

    /**
     * SDD §11.5 POST /tracks/{trackId}/schedule-items — 安排连续单元. Delegates to {@code
     * SchedulingService.scheduleTrackItems}. {@code manualOverride} and {@code overrideReason} allow a
     * lead teacher to bypass the contiguous-ordinal / device-policy guardrails per §9.4; when omitted
     * the service treats the call as an auto-schedule from the track pointer.
     */
    public record ScheduleItems(
            int startOrdinal,
            int unitCount,
            LocalDate date,
            boolean manualOverride,
            String overrideReason) {}

    /**
     * SDD §11 POST /tracks/{id}/pause — 暂停轨道. Transitions a track to PAUSED. {@code
     * expectedVersion} enables optimistic locking; the caller must have read the current track
     * first to obtain the version.
     */
    public record PauseTrack(UUID trackId, long expectedVersion) {}

    /**
     * SDD §11 POST /tracks/{id}/resume — 恢复轨道. Transitions a PAUSED track back to ACTIVE
     * (or COMPLETED if the pointer has advanced past the end ordinal; the service resolves the
     * correct resumed status).
     */
    public record ResumeTrack(UUID trackId, long expectedVersion) {}

    /**
     * SDD §11 POST /tracks/{id}/cancel — 终止轨道. Transitions a track to CANCELLED. Terminal
     * state: cancelled tracks are excluded from scheduling and pointer recalculation.
     */
    public record CancelTrack(UUID trackId, long expectedVersion, String reason) {}
}
