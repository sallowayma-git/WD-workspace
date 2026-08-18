package com.wonderedu.assistant.importexport.api;

import java.util.List;

public final class ImportCommands {

    private ImportCommands() {}

    public record ColumnMapping(
            String columnLabel,
            String action,
            String templateCode,
            String templateName,
            String shortName,
            String subjectCode,
            String categoryCode,
            String unitLabel,
            Integer defaultDurationMinutes,
            boolean defaultRequiresDevice) {}

    public record ExecuteImport(List<ColumnMapping> mappings) {}

    /**
     * Save user-adjusted column mappings for an import job (SDD §11.10 / §14.2 step 4). Each
     * {@link ColumnMapping} carries per-column overrides for the downstream template creation
     * (templateCode/name/shortName/subjectCode/unitLabel/duration/requiresDevice). Persisted to
     * {@code import_job.mapping_config} so a subsequent {@code execute} can read it back.
     */
    public record SaveMapping(List<ColumnMapping> mappings) {}
}
