package com.wonderedu.assistant.importexport.application;

import com.wonderedu.assistant.curriculum.api.TemplateCommands;
import com.wonderedu.assistant.curriculum.application.TemplateService;
import com.wonderedu.assistant.importexport.api.ImportCommands;
import com.wonderedu.assistant.importexport.api.ImportViews;
import com.wonderedu.assistant.importexport.api.ImportViews.ColumnPreview;
import com.wonderedu.assistant.importexport.persistence.ImportJobRepository;
import com.wonderedu.assistant.shared.ActorContext;
import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.CodeNormalizer;
import com.wonderedu.assistant.shared.DomainException;
import com.wonderedu.assistant.shared.IdGenerator;
import com.wonderedu.assistant.shared.TenantContext;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ImportService {

    private final ExcelTemplateParser parser;
    private final ImportJobRepository jobRepository;
    private final TemplateService templateService;
    private final BusinessClock clock;
    private final IdGenerator idGenerator;

    public ImportService(
            ExcelTemplateParser parser,
            ImportJobRepository jobRepository,
            TemplateService templateService,
            BusinessClock clock,
            IdGenerator idGenerator) {
        this.parser = parser;
        this.jobRepository = jobRepository;
        this.templateService = templateService;
        this.clock = clock;
        this.idGenerator = idGenerator;
    }

    @Transactional
    public ImportViews.ImportPreview uploadAndPreview(byte[] content, String fileName) {
        if (content == null || content.length == 0) {
            throw new DomainException(422, "IMPORT_EMPTY_FILE", "上传文件不能为空");
        }
        if (content.length > 50 * 1024 * 1024) {
            throw new DomainException(422, "IMPORT_FILE_TOO_LARGE", "文件不能超过 50MB");
        }
        // 扩展名校验:仅允许 .xlsx
        if (fileName == null || !fileName.toLowerCase().endsWith(".xlsx")) {
            throw new DomainException(422, "IMPORT_FILE_TYPE_UNSUPPORTED", "仅支持 .xlsx 文件");
        }
        // MIME/魔数校验:xlsx 为 ZIP 容器,签名 PK\x03\x04
        if (content.length < 4
                || (content[0] & 0xFF) != 0x50
                || (content[1] & 0xFF) != 0x4B
                || (content[2] & 0xFF) != 0x03
                || (content[3] & 0xFF) != 0x04) {
            throw new DomainException(422, "IMPORT_FILE_TYPE_UNSUPPORTED",
                    "文件内容与 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet 不匹配");
        }
        ExcelTemplateParser.ParsedFile parsed = parser.parse(content);
        UUID jobId = idGenerator.next();
        ImportViews.ImportPreview preview = parsed.preview()
                .withJobId(jobId)
                .withFileName(fileName);
        jobRepository.createJob(jobId, fileName, parsed.sha256(), clock.now(), actorId());
        jobRepository.savePreview(jobId, preview, clock.now());
        return preview;
    }

    /**
     * Re-trigger preview for an already-uploaded job (SDD §11.10 / §14.2 step 3). The original
     * uploaded bytes are not retained on disk, so this returns the preview previously persisted
     * to {@code import_job.mapping_config} rather than re-parsing the file. Tenant isolation is
     * enforced inside {@link ImportJobRepository#findPreview}; a cross-tenant job id surfaces as
     * a null preview which we translate to 404.
     */
    @Transactional(readOnly = true)
    public ImportViews.ImportPreview preview(UUID jobId) {
        jobRepository.findById(jobId)
                .orElseThrow(() -> new DomainException(404, "IMPORT_JOB_NOT_FOUND", "导入任务不存在"));
        ImportViews.ImportPreview preview = jobRepository.findPreview(jobId);
        if (preview == null) {
            throw new DomainException(409, "IMPORT_PREVIEW_REQUIRED",
                    "尚未生成预览,请先重新上传文件");
        }
        return preview;
    }

    /**
     * Save user-adjusted column mappings (SDD §11.10 / §14.2 step 4). The mappings are persisted
     * to {@code import_job.mapping_config} so a subsequent {@code execute} reads them back. The
     * job must belong to the current organization; a cross-tenant job id surfaces as 404 inside
     * {@link ImportJobRepository#saveMapping}.
     */
    @Transactional
    public ImportViews.ImportPreview saveMapping(UUID jobId, ImportCommands.SaveMapping command) {
        jobRepository.findById(jobId)
                .orElseThrow(() -> new DomainException(404, "IMPORT_JOB_NOT_FOUND", "导入任务不存在"));
        List<ImportCommands.ColumnMapping> mappings = command.mappings() != null
                ? command.mappings() : List.of();
        jobRepository.saveMapping(jobId, mappings, clock.now());
        ImportViews.ImportPreview preview = jobRepository.findPreview(jobId);
        if (preview == null) {
            throw new DomainException(409, "IMPORT_PREVIEW_REQUIRED",
                    "尚未生成预览,无法保存映射");
        }
        return preview;
    }

    @Transactional
    public ImportViews.ImportJobStatus execute(UUID jobId, ImportCommands.ExecuteImport command) {
        // TODO(异步化): 当前 execute 仍同步阻塞 HTTP 线程,违反 NFR-PERF-005(5000 单元异步)。
        //  完整异步改造需要引入 job 队列 + 后台 worker(单独 PR),本轮保持同步,但确保 execute 幂等:
        //  重复 execute 返回当前状态而非 409,避免客户端重试造成重复导入。
        ImportJobRepository.JobRecord job = jobRepository
                .findById(jobId)
                .orElseThrow(() -> new DomainException(404, "IMPORT_JOB_NOT_FOUND", "导入任务不存在"));
        String status = job.status();
        if ("RUNNING".equals(status)
                || "SUCCEEDED".equals(status)
                || "PARTIAL".equals(status)
                || "FAILED".equals(status)) {
            // 幂等:已开始/已结束的任务直接返回当前状态
            String existingSummary = jobRepository.findSummary(jobId);
            return new ImportViews.ImportJobStatus(
                    jobId.toString(), status, job.fileName(),
                    existingSummary != null ? existingSummary : "{}",
                    0, 0, 0, List.of());
        }
        jobRepository.updateStatus(jobId, "RUNNING", clock.now());

        ImportViews.ImportPreview preview = jobRepository.findPreview(jobId);
        List<String> errors = new ArrayList<>();
        int succeeded = 0;
        int failed = 0;
        int total = 0;
        for (ImportCommands.ColumnMapping mapping : command.mappings()) {
            if ("IGNORE".equals(mapping.action())) continue;
            total++;
            try {
                ColumnPreview column = findColumn(preview, mapping.columnLabel());
                if (column == null) {
                    throw new DomainException(422, "IMPORT_COLUMN_NOT_FOUND",
                            "未找到列: " + mapping.columnLabel());
                }
                createTemplateFromColumn(job, mapping, column);
                succeeded++;
            } catch (Exception e) {
                failed++;
                errors.add(mapping.columnLabel() + ": " + e.getMessage());
                jobRepository.addError(jobId, "sheet1", null, mapping.columnLabel(),
                        "IMPORT_COLUMN_FAILED", e.getMessage(), null, clock.now());
            }
        }
        String finalStatus = failed == 0 ? "SUCCEEDED" : (succeeded == 0 ? "FAILED" : "PARTIAL");
        String summary = "{\"succeeded\":" + succeeded + ",\"failed\":" + failed + "}";
        jobRepository.finishJob(jobId, finalStatus, summary, clock.now());
        return new ImportViews.ImportJobStatus(
                jobId.toString(), finalStatus, job.fileName(), summary,
                total, succeeded, failed, errors);
    }

    private ColumnPreview findColumn(ImportViews.ImportPreview preview, String columnLabel) {
        if (preview == null) return null;
        for (ColumnPreview col : preview.columns()) {
            if (columnLabel.equals(col.columnLabel())) return col;
        }
        return null;
    }

    private void createTemplateFromColumn(ImportJobRepository.JobRecord job, ImportCommands.ColumnMapping mapping, ColumnPreview column) {
        String templateCode = CodeNormalizer.normalize(mapping.templateCode() != null && !mapping.templateCode().isBlank()
                ? mapping.templateCode() : mapping.columnLabel());
        String name = mapping.templateName() != null && !mapping.templateName().isBlank()
                ? mapping.templateName() : mapping.columnLabel();
        String shortName = mapping.shortName() != null && !mapping.shortName().isBlank()
                ? mapping.shortName() : name;
        String subjectCode = mapping.subjectCode() != null && !mapping.subjectCode().isBlank()
                ? mapping.subjectCode() : "OTHER";
        String unitLabel = mapping.unitLabel() != null && !mapping.unitLabel().isBlank()
                ? mapping.unitLabel() : (column.parsedUnit() != null ? column.parsedUnit() : "单元");
        Integer duration = mapping.defaultDurationMinutes() != null
                ? mapping.defaultDurationMinutes() : column.parsedDurationMinutes();

        TemplateCommands.Create create = new TemplateCommands.Create(
                templateCode, name, shortName, subjectCode, mapping.categoryCode(),
                unitLabel, duration, mapping.defaultRequiresDevice(),
                "从 Excel 导入: " + job.fileName());
        var template = templateService.create(create);

        List<TemplateCommands.Item> items = buildItems(column, templateCode);
        if (!items.isEmpty()) {
            UUID versionId = jobRepository.findDraftVersionId(
                    template.id(), TenantContext.requireOrganizationId());
            templateService.replaceItems(versionId, new TemplateCommands.ReplaceItems(items, "Excel 导入"));
        }
    }

    private List<TemplateCommands.Item> buildItems(ColumnPreview column, String templateCode) {
        List<TemplateCommands.Item> items = new ArrayList<>();
        List<String> titles = column.allTitles();
        if (titles == null || titles.isEmpty()) return items;
        int ordinal = 1;
        for (String title : titles) {
            if (title == null || title.isBlank()) continue;
            String trimmed = title.trim();
            String shortTitle = trimmed.length() > 20 ? trimmed.substring(0, 20) + "…" : trimmed;
            items.add(new TemplateCommands.Item(
                    ordinal, templateCode + "-" + ordinal,
                    trimmed, shortTitle, column.parsedDurationMinutes(),
                    null, null, null, true));
            ordinal++;
        }
        return items;
    }

    /**
     * List row-level import errors for a job (SDD §11.10 / §14.2 step 7). Tenant isolation runs
     * inside {@link ImportJobRepository#findErrors} via a JOIN on {@code import_job.organization_id};
     * a job that does not belong to the current organization yields an empty result with total 0.
     * A missing job also yields 404 to mirror the execute route.
     */
    @Transactional(readOnly = true)
    public ImportViews.ImportErrorList listErrors(UUID jobId, int limit, int offset) {
        jobRepository.findById(jobId)
                .orElseThrow(() -> new DomainException(404, "IMPORT_JOB_NOT_FOUND", "导入任务不存在"));
        List<ImportViews.ImportError> errors = jobRepository.findErrors(jobId, limit, offset);
        int total = jobRepository.countErrors(jobId);
        return new ImportViews.ImportErrorList(jobId.toString(), errors, total);
    }

    /**
     * Render the error list as CSV (SDD §14.2 step 7, optional download). Reuses the
     * {@link ExportService#sanitizeFormula(String)} formula-injection guard so spreadsheet
     * applications interpret raw cell values as text. Returns the CSV bytes plus a suggested
     * filename.
     */
    @Transactional(readOnly = true)
    public ErrorCsv generateErrorsCsv(UUID jobId) {
        jobRepository.findById(jobId)
                .orElseThrow(() -> new DomainException(404, "IMPORT_JOB_NOT_FOUND", "导入任务不存在"));
        List<ImportViews.ImportError> errors = jobRepository.findErrors(jobId, 10_000, 0);
        StringBuilder sb = new StringBuilder();
        sb.append("rowNumber,columnName,errorCode,message,rawValue,sheet\r\n");
        for (ImportViews.ImportError err : errors) {
            appendCell(sb, err.rowNumber() == null ? "" : String.valueOf(err.rowNumber()));
            sb.append(',');
            appendCell(sb, err.columnName());
            sb.append(',');
            appendCell(sb, err.errorCode());
            sb.append(',');
            appendCell(sb, err.message());
            sb.append(',');
            appendCell(sb, err.rawValue());
            sb.append(',');
            appendCell(sb, err.sheet());
            sb.append("\r\n");
        }
        byte[] bytes = sb.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
        return new ErrorCsv(bytes, "import-errors-" + jobId + ".csv");
    }

    /** Append a single CSV cell, quoting per RFC 4180 and prefixing formula triggers. */
    private static void appendCell(StringBuilder sb, String value) {
        String safe = ExportService.sanitizeFormula(value);
        boolean needsQuoting = safe.indexOf(',') >= 0
                || safe.indexOf('"') >= 0
                || safe.indexOf('\r') >= 0
                || safe.indexOf('\n') >= 0;
        if (!needsQuoting) {
            sb.append(safe);
            return;
        }
        sb.append('"');
        for (int i = 0; i < safe.length(); i++) {
            char c = safe.charAt(i);
            if (c == '"') {
                sb.append('"');
            }
            sb.append(c);
        }
        sb.append('"');
    }

    /** CSV download result for the import-error endpoint. */
    public record ErrorCsv(byte[] bytes, String filename) {}

    private static UUID actorId() {
        ActorContext.Actor actor = ActorContext.current();
        return actor == null
                ? UUID.nameUUIDFromBytes("assistant-system".getBytes(java.nio.charset.StandardCharsets.UTF_8))
                : actor.id();
    }
}
