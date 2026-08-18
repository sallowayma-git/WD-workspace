package com.wonderedu.assistant.curriculum.api;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Mounted-student projection for a task template (PRD FR-SEARCH-004 / AC-012).
 *
 * <p>Each row represents a {@code student_task_track} mounted against the template, joined to the
 * student for identity. All rows are tenant-scoped by {@code organization_id} in the repository.
 */
public record TemplateUsageView(
        UUID trackId,
        UUID studentId,
        String name,
        String studentCode,
        int currentOrdinal,
        int endOrdinal,
        String status,
        LocalDate nextCandidateDate) {}
