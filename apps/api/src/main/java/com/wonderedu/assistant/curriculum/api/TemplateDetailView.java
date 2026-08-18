package com.wonderedu.assistant.curriculum.api;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record TemplateDetailView(
        UUID id,
        String templateCode,
        String name,
        String shortName,
        String subjectCode,
        String categoryCode,
        String unitLabel,
        Integer defaultDurationMinutes,
        boolean defaultRequiresDevice,
        String status,
        UUID currentPublishedVersionId,
        Integer currentPublishedVersionNumber,
        Integer currentItemCount,
        List<TemplateVersionView> versions,
        long version,
        Instant updatedAt) {}
