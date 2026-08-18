package com.wonderedu.assistant.curriculum.api;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Per-student status projection for a single template item (PRD FR-SEARCH-004 / AC-012).
 *
 * <p>Each row represents one {@code task_instance} scheduled against the template item, joined to
 * the student for identity. {@code status} is the task instance status (PENDING / COMPLETED /
 * CARRIED_OVER / CANCELLED / SKIPPED); {@code scheduledDate} is the task's scheduled date (or the
 * original scheduled date when carried over). Rows are tenant-scoped by {@code organization_id} in
 * the repository.
 */
public record TemplateItemUsageView(
        UUID taskId,
        UUID studentId,
        String name,
        String studentCode,
        String status,
        LocalDate scheduledDate,
        Integer itemOrdinal) {}
