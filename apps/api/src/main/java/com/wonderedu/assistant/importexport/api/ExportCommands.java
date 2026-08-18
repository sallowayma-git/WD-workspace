package com.wonderedu.assistant.importexport.api;

import java.time.LocalDate;

/**
 * Request payloads for the export endpoints (SDD §11.10 ExportController).
 */
public final class ExportCommands {

    private ExportCommands() {}

    /**
     * Body of {@code POST /api/v1/students/{studentId}/vocabulary/export}. Both bounds are
     * optional; omitting them exports the student's full vocabulary history.
     *
     * @param dateFrom inclusive lower bound on {@code vocabulary_batch.occurred_date} (ISO date)
     * @param dateTo inclusive upper bound on {@code vocabulary_batch.occurred_date} (ISO date)
     */
    public record VocabularyExportRequest(LocalDate dateFrom, LocalDate dateTo) {}
}
