package com.wonderedu.assistant.importexport.api;

import java.util.List;
import java.util.UUID;

public final class ImportViews {

    private ImportViews() {}

    public record ColumnPreview(
            String columnLabel,
            String metadata,
            String parsedUnit,
            Integer parsedTotal,
            Integer parsedDurationMinutes,
            int nonEmptyCount,
            List<String> sampleTitles,
            List<String> allTitles,
            String error) {}

    public record ImportPreview(
            UUID jobId,
            String fileName,
            String fileSha256,
            List<ColumnPreview> columns,
            int totalColumns,
            int validColumns,
            List<ImportCommands.ColumnMapping> mappings) {

        /** Convenience constructor used when no user mapping overrides have been saved yet. */
        public ImportPreview(
                String fileName,
                String fileSha256,
                List<ColumnPreview> columns,
                int totalColumns,
                int validColumns) {
            this(null, fileName, fileSha256, columns, totalColumns, validColumns, null);
        }

        public ImportPreview withJobId(UUID id) {
            return new ImportPreview(id, fileName, fileSha256, columns, totalColumns, validColumns, mappings);
        }

        public ImportPreview withFileName(String name) {
            return new ImportPreview(jobId, name, fileSha256, columns, totalColumns, validColumns, mappings);
        }
    }

    public record ImportJobStatus(
            String jobId,
            String status,
            String fileName,
            String summary,
            int totalColumns,
            int succeededColumns,
            int failedColumns,
            List<String> errors) {}

    /** A single row-level import error (SDD §11.10 / §14.2 step 7). */
    public record ImportError(
            String sheet,
            Integer rowNumber,
            String columnName,
            String errorCode,
            String message,
            String rawValue) {}

    /** Paginated error list returned by {@code GET /imports/{jobId}/errors}. */
    public record ImportErrorList(
            String jobId,
            List<ImportError> errors,
            int total) {}
}
