package com.wonderedu.assistant.vocabulary.api;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class VocabularyViews {

    private VocabularyViews() {}

    public record VocabularyBatchView(
            UUID id,
            UUID studentId,
            LocalDate occurredDate,
            String sourceType,
            String subjectCode,
            String sourceLabel,
            String note,
            int entryCount,
            long version,
            java.time.Instant updatedAt) {}

    public record VocabularyEntryView(
            UUID id,
            UUID batchId,
            UUID studentId,
            String termOriginal,
            String termNormalized,
            String status,
            String note,
            long version,
            java.time.Instant createdAt) {}

    public record PreviewBatchRequest(
            String rawText,
            String sourceType,
            String subjectCode,
            String sourceLabel) {}

    public record PreviewBatchResponse(
            List<PreviewEntry> entries,
            int totalCount,
            int duplicateCount,
            List<String> duplicates) {}

    public record PreviewEntry(String termOriginal, String termNormalized, boolean isDuplicate) {}

    public record SaveBatchRequest(
            String rawText,
            String sourceType,
            String subjectCode,
            String sourceLabel,
            LocalDate occurredDate,
            List<String> terms) {}

    public record VocabularyListResponse(
            List<VocabularyEntryView> entries,
            int total) {}

    /**
     * PATCH /api/v1/vocabulary/entries/{id} request body. Implements SDD §11.8 修改状态/备注.
     * Fields are nullable for partial-update semantics: a null {@code status} leaves the
     * status unchanged, a null {@code note} leaves the note unchanged. At least one of the
     * two must be provided. {@code expectedVersion} carries the optimistic-lock token
     * (BR-013 / AC-013).
     */
    public record UpdateEntryRequest(
            String status,
            String note,
            Long expectedVersion) {}
}
