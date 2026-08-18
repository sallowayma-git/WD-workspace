package com.wonderedu.assistant.planning.api;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record TrackView(
        UUID id,
        UUID studentId,
        UUID templateId,
        UUID templateVersionId,
        String status,
        int startOrdinal,
        int currentOrdinal,
        int endOrdinal,
        int defaultUnitsPerSession,
        LocalDate startDate,
        LocalDate nextCandidateDate,
        int priority,
        boolean allowParallelItems,
        String schedulingPolicy,
        Integer durationOverrideMinutes,
        String devicePolicyOverride,
        String note,
        Instant completedAt,
        long version,
        Instant updatedAt,
        TrackProgress progress,
        List<String> warnings) {

    public TrackView withWarnings(List<String> warnings) {
        return new TrackView(
                id,
                studentId,
                templateId,
                templateVersionId,
                status,
                startOrdinal,
                currentOrdinal,
                endOrdinal,
                defaultUnitsPerSession,
                startDate,
                nextCandidateDate,
                priority,
                allowParallelItems,
                schedulingPolicy,
                durationOverrideMinutes,
                devicePolicyOverride,
                note,
                completedAt,
                version,
                updatedAt,
                progress,
                warnings);
    }

    public static TrackView from(
            UUID id,
            UUID studentId,
            UUID templateId,
            UUID templateVersionId,
            String status,
            int startOrdinal,
            int currentOrdinal,
            int endOrdinal,
            int defaultUnitsPerSession,
            LocalDate startDate,
            LocalDate nextCandidateDate,
            int priority,
            boolean allowParallelItems,
            String schedulingPolicy,
            Integer durationOverrideMinutes,
            String devicePolicyOverride,
            String note,
            Instant completedAt,
            long version,
            Instant updatedAt) {
        return new TrackView(
                id,
                studentId,
                templateId,
                templateVersionId,
                status,
                startOrdinal,
                currentOrdinal,
                endOrdinal,
                defaultUnitsPerSession,
                startDate,
                nextCandidateDate,
                priority,
                allowParallelItems,
                schedulingPolicy,
                durationOverrideMinutes,
                devicePolicyOverride,
                note,
                completedAt,
                version,
                updatedAt,
                null,
                List.of());
    }

    public record TrackProgress(
            int currentOrdinal,
            int endOrdinal,
            int completedUnits,
            int totalUnits,
            int percent,
            boolean outOfOrder) {}
}
