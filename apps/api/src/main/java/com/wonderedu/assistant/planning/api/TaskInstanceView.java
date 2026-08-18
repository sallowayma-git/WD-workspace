package com.wonderedu.assistant.planning.api;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record TaskInstanceView(
        UUID id,
        UUID studentId,
        String sourceType,
        UUID trackId,
        UUID templateVersionId,
        UUID templateItemId,
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
        Instant cancelledAt,
        UUID cancelledBy,
        UUID parentTaskId,
        UUID linkedParentTaskId,
        String priority,
        int sortOrder,
        boolean star,
        long version,
        Instant updatedAt) {}
