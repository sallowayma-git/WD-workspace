package com.wonderedu.assistant.curriculum.api;

import java.time.Instant;
import java.util.UUID;

public record TemplateVersionView(
        UUID id,
        UUID templateId,
        int versionNumber,
        String status,
        int itemCount,
        String changeNote,
        Instant publishedAt,
        long version,
        Instant updatedAt) {}
