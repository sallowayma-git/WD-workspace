package com.wonderedu.assistant.importexport.application;

import com.wonderedu.assistant.audit.api.AuditAction;
import com.wonderedu.assistant.audit.application.AuditService;
import com.wonderedu.assistant.importexport.persistence.ExportRow;
import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.DomainException;
import com.wonderedu.assistant.shared.TenantContext;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Generates CSV exports of student vocabulary (SDD §11.10 ExportController, PRD FR-VOCAB-004).
 *
 * <p>The current implementation is synchronous: the controller streams the CSV body directly from
 * {@link #generateVocabularyCsv(UUID, LocalDate, LocalDate)}. An async export-job table can be
 * added later for large exports, but the minimal viable flow does not require it.
 *
 * <p><b>Module boundary (no vocabulary dependency).</b> This service reads vocabulary rows directly
 * from the database via {@link NamedParameterJdbcTemplate} and owns its own {@link ExportRow}
 * projection, so the importexport module does not depend on the vocabulary module. The export SQL
 * is a read-only join over {@code vocabulary_entry}, {@code vocabulary_batch} and {@code student}
 * and mirrors {@code VocabularyRepository.findExportRows}. The tenant guard ({@code
 * requireStudentInTenant}) mirrors {@code VocabularyService.requireStudentInTenant} so an
 * out-of-organization {@code studentId} surfaces as {@code STUDENT_NOT_FOUND} rather than an empty
 * result set.
 *
 * <p>CSV hardening (SDD §18.4): every cell value that begins with one of the formula-injection
 * trigger characters {@code = + - @ <TAB> <CR>} is prefixed with a single quote so spreadsheet
 * applications treat it as text rather than evaluating it. The output is UTF-8 with a BOM so Excel
 * renders CJK columns correctly.
 *
 * <p>Audit (PRD NFR 导出文件带操作者/生成时间/范围审计, SDD §8.3): each successful generation
 * records an {@link AuditAction#EXPORT_GENERATED} event with the operator (resolved by
 * {@link AuditService} from the security context), the {@code STUDENT} target, and metadata
 * capturing the requested date range and exported row count.
 */
@Service
public class ExportService {

    /** UTF-8 BOM, emitted at the start of every CSV so Excel detects the encoding. */
    private static final byte[] UTF8_BOM = new byte[] {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};

    private final NamedParameterJdbcTemplate jdbc;
    private final AuditService auditService;
    private final BusinessClock clock;

    public ExportService(
            NamedParameterJdbcTemplate jdbc,
            AuditService auditService,
            BusinessClock clock) {
        this.jdbc = jdbc;
        this.auditService = auditService;
        this.clock = clock;
    }

    /**
     * Generate a vocabulary CSV for the given student and date range.
     *
     * @param studentId target student (must belong to the caller's organization; enforced by
     *     {@link #requireStudentInTenant(UUID)})
     * @param dateFrom inclusive lower bound on {@code vocabulary_batch.occurred_date}; may be null
     * @param dateTo inclusive upper bound; may be null
     * @return the CSV body as a UTF-8 byte array (with leading BOM)
     */
    @Transactional(readOnly = true)
    public ExportResult generateVocabularyCsv(UUID studentId, LocalDate dateFrom, LocalDate dateTo) {
        if (dateFrom != null && dateTo != null && dateFrom.isAfter(dateTo)) {
            throw new DomainException(422, "EXPORT_BAD_RANGE", "开始日期不能晚于结束日期");
        }

        requireStudentInTenant(studentId);
        List<ExportRow> rows = findExportRows(studentId, dateFrom, dateTo);
        String csv = renderCsv(rows);
        byte[] bytes = withBom(csv);

        // Record the audit event. Idempotency key is intentionally null: each generation is a
        // distinct operator action and should be logged independently.
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("format", "CSV");
        metadata.put("rowCount", rows.size());
        metadata.put("dateFrom", dateFrom == null ? null : dateFrom.toString());
        metadata.put("dateTo", dateTo == null ? null : dateTo.toString());
        metadata.put("generatedAt", clock.now().toString());
        auditService.recordEvent(
                AuditAction.EXPORT_GENERATED,
                "STUDENT",
                studentId,
                metadata,
                /* idempotencyKey */ null);

        return new ExportResult(bytes, rows.size());
    }

    /**
     * Guards BR-013 / SDD §18.3 tenant isolation: the {@code studentId} arrives from a
     * {@code @PathVariable} and could reference a student in another organization. Verify the
     * student belongs to the caller's organization before any read against vocabulary tables,
     * mirroring {@code VocabularyService.requireStudentInTenant}.
     */
    private void requireStudentInTenant(UUID studentId) {
        Integer ok = jdbc.queryForObject(
                "SELECT count(*) FROM student WHERE id = :id AND organization_id = :orgId",
                new MapSqlParameterSource()
                        .addValue("id", studentId)
                        .addValue("orgId", TenantContext.requireOrganizationId()),
                Integer.class);
        if (ok == null || ok == 0) {
            throw new DomainException(404, "STUDENT_NOT_FOUND", "学生不存在");
        }
    }

    /**
     * Rows joined with the batch and the student for CSV export. Returns only the columns the
     * export needs (SDD §11.10): occurred date, student name, subject code, term original and
     * note. Tenant isolation is enforced by joining on the batch organization id.
     */
    private List<ExportRow> findExportRows(UUID studentId, LocalDate fromDate, LocalDate toDate) {
        return jdbc.query(
                "SELECT vb.occurred_date, s.name AS student_name, vb.subject_code, ve.term_original, ve.note "
                        + "FROM vocabulary_entry ve "
                        + "JOIN vocabulary_batch vb ON vb.id = ve.batch_id AND vb.organization_id = :orgId "
                        + "JOIN student s ON s.id = ve.student_id AND s.organization_id = :orgId "
                        + "WHERE ve.student_id = :studentId "
                        + "AND vb.occurred_date BETWEEN :fromDate AND :toDate "
                        + "AND ve.status <> 'ARCHIVED' "
                        + "ORDER BY vb.occurred_date ASC, ve.created_at ASC",
                new MapSqlParameterSource()
                        .addValue("orgId", TenantContext.requireOrganizationId())
                        .addValue("studentId", studentId)
                        .addValue("fromDate", fromDate)
                        .addValue("toDate", toDate),
                ExportRow::map);
    }

    /** Render the CSV body (without BOM). Columns: 日期,学生,科目,词条,备注. */
    static String renderCsv(List<ExportRow> rows) {
        StringBuilder sb = new StringBuilder();
        sb.append("日期,学生,科目,词条,备注\r\n");
        for (ExportRow row : rows) {
            appendCell(sb, row.occurredDate() == null ? "" : row.occurredDate().toString());
            sb.append(',');
            appendCell(sb, nullSafe(row.studentName()));
            sb.append(',');
            appendCell(sb, nullSafe(row.subjectCode()));
            sb.append(',');
            appendCell(sb, nullSafe(row.termOriginal()));
            sb.append(',');
            appendCell(sb, nullSafe(row.note()));
            sb.append("\r\n");
        }
        return sb.toString();
    }

    /** Append a single CSV cell, quoting per RFC 4180 and prefixing formula triggers. */
    private static void appendCell(StringBuilder sb, String value) {
        String safe = sanitizeFormula(value);
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

    /**
     * CSV formula-injection guard (SDD §18.4). If a value starts with one of the trigger
     * characters {@code = + - @ <TAB> <CR>}, prefix a single quote so spreadsheet applications
     * interpret the cell as text. The quote is a display-only prefix and is not part of the data.
     */
    static String sanitizeFormula(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        char first = value.charAt(0);
        if (first == '=' || first == '+' || first == '-' || first == '@' || first == '\t' || first == '\r') {
            return "'" + value;
        }
        return value;
    }

    private static String nullSafe(String s) {
        return s == null ? "" : s;
    }

    private static byte[] withBom(String csv) {
        byte[] body = csv.getBytes(StandardCharsets.UTF_8);
        byte[] result = new byte[UTF8_BOM.length + body.length];
        System.arraycopy(UTF8_BOM, 0, result, 0, UTF8_BOM.length);
        System.arraycopy(body, 0, result, UTF8_BOM.length, body.length);
        return result;
    }

    /**
     * Result of a CSV generation.
     *
     * @param bytes UTF-8 body with leading BOM
     * @param rowCount number of vocabulary rows exported
     */
    public record ExportResult(byte[] bytes, int rowCount) {}
}
