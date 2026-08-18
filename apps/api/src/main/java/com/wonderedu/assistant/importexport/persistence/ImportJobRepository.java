package com.wonderedu.assistant.importexport.persistence;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import com.wonderedu.assistant.importexport.api.ImportCommands;
import com.wonderedu.assistant.importexport.api.ImportViews;
import com.wonderedu.assistant.shared.ActorContext;
import com.wonderedu.assistant.shared.DomainException;
import com.wonderedu.assistant.shared.IdGenerator;
import com.wonderedu.assistant.shared.TenantContext;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ImportJobRepository {

    private static final UUID SYSTEM_ACTOR =
            UUID.nameUUIDFromBytes("assistant-system".getBytes(java.nio.charset.StandardCharsets.UTF_8));

    private final NamedParameterJdbcTemplate jdbc;
    private final IdGenerator idGenerator;
    private final ObjectMapper objectMapper;

    public ImportJobRepository(NamedParameterJdbcTemplate jdbc, IdGenerator idGenerator, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.idGenerator = idGenerator;
        this.objectMapper = objectMapper;
    }

    public void createJob(UUID jobId, String fileName, String sha256, Instant now, UUID actor) {
        jdbc.update(
                "INSERT INTO import_job (id, organization_id, type, status, file_name, file_sha256, "
                        + "created_at, created_by, updated_at, updated_by, version) "
                        + "VALUES (:id, :orgId, 'TEMPLATE_XLSX', 'UPLOADED', :fileName, :sha256, :now, :actor, :now, :actor, 0)",
                new MapSqlParameterSource()
                        .addValue("id", jobId)
                        .addValue("orgId", TenantContext.requireOrganizationId())
                        .addValue("fileName", fileName)
                        .addValue("sha256", sha256)
                        .addValue("now", now)
                        .addValue("actor", actor));
    }

    public void savePreview(UUID jobId, ImportViews.ImportPreview preview, Instant now) {
        try {
            String json = objectMapper.writeValueAsString(preview);
            // 跨租户防护:仅允许同组织更新 preview
            int updated = jdbc.update(
                    "UPDATE import_job SET mapping_config = :preview::jsonb, status = 'PREVIEWED', "
                            + "updated_at = :now, version = version + 1 "
                            + "WHERE id = :id AND organization_id = :orgId",
                    new MapSqlParameterSource()
                            .addValue("id", jobId)
                            .addValue("orgId", TenantContext.requireOrganizationId())
                            .addValue("preview", json)
                            .addValue("now", now));
            if (updated == 0) {
                throw new DomainException(404, "IMPORT_JOB_NOT_FOUND", "导入任务不存在");
            }
        } catch (DomainException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("Failed to save preview", e);
        }
    }

    /**
     * Persist user-adjusted column mappings (SDD §11.10 / §14.2 step 4). The mappings are written
     * to {@code import_job.mapping_config} alongside the existing preview columns so a later
     * {@code execute} can read them back. Tenant isolation is enforced via the
     * {@code organization_id} predicate; a cross-tenant job id surfaces as 404.
     */
    public void saveMapping(UUID jobId, List<ImportCommands.ColumnMapping> mappings, Instant now) {
        try {
            ImportViews.ImportPreview existing = findPreview(jobId);
            if (existing == null) {
                throw new DomainException(409, "IMPORT_PREVIEW_REQUIRED",
                        "尚未生成预览,无法保存映射");
            }
            ImportViews.ImportPreview updated = new ImportViews.ImportPreview(
                    existing.jobId(),
                    existing.fileName(),
                    existing.fileSha256(),
                    existing.columns(),
                    existing.totalColumns(),
                    existing.validColumns(),
                    mappings);
            String json = objectMapper.writeValueAsString(updated);
            int updatedRows = jdbc.update(
                    "UPDATE import_job SET mapping_config = :config::jsonb, "
                            + "updated_at = :now, version = version + 1 "
                            + "WHERE id = :id AND organization_id = :orgId",
                    new MapSqlParameterSource()
                            .addValue("id", jobId)
                            .addValue("orgId", TenantContext.requireOrganizationId())
                            .addValue("config", json)
                            .addValue("now", now));
            if (updatedRows == 0) {
                throw new DomainException(404, "IMPORT_JOB_NOT_FOUND", "导入任务不存在");
            }
        } catch (DomainException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("Failed to save mapping", e);
        }
    }

    public Optional<JobRecord> findById(UUID jobId) {
        return jdbc.query(
                        "SELECT id, file_name, file_sha256, status, mapping_config FROM import_job WHERE organization_id = :orgId AND id = :id",
                        new MapSqlParameterSource()
                                .addValue("orgId", TenantContext.requireOrganizationId())
                                .addValue("id", jobId),
                        ImportJobRepository::mapJob)
                .stream()
                .findFirst();
    }

    public ImportViews.ImportPreview findPreview(UUID jobId) {
        try {
            // 跨租户防护:仅返回同组织的 preview
            String json = jdbc.queryForObject(
                    "SELECT mapping_config::text FROM import_job WHERE id = :id AND organization_id = :orgId",
                    new MapSqlParameterSource()
                            .addValue("id", jobId)
                            .addValue("orgId", TenantContext.requireOrganizationId()),
                    String.class);
            if (json == null || json.isBlank()) return null;
            return objectMapper.readValue(json, ImportViews.ImportPreview.class).withJobId(jobId);
        } catch (Exception e) {
            return null;
        }
    }

    public String findSummary(UUID jobId) {
        try {
            // 跨租户防护:仅返回同组织的 summary
            return jdbc.queryForObject(
                    "SELECT COALESCE(summary::text, '{}') FROM import_job WHERE id = :id AND organization_id = :orgId",
                    new MapSqlParameterSource()
                            .addValue("id", jobId)
                            .addValue("orgId", TenantContext.requireOrganizationId()),
                    String.class);
        } catch (Exception e) {
            return null;
        }
    }

    public List<String> findAllTitles(UUID jobId, String columnLabel) {
        ImportViews.ImportPreview preview = findPreview(jobId);
        if (preview == null) return List.of();
        for (ImportViews.ColumnPreview col : preview.columns()) {
            if (columnLabel.equals(col.columnLabel())) {
                return col.sampleTitles();
            }
        }
        return List.of();
    }

    public UUID findDraftVersionId(UUID templateId, UUID orgId) {
        return jdbc.queryForObject(
                "SELECT id FROM task_template_version WHERE template_id = :templateId AND status = 'DRAFT' "
                        + "AND EXISTS (SELECT 1 FROM task_template t WHERE t.id = task_template_version.template_id AND t.organization_id = :orgId)",
                new MapSqlParameterSource()
                        .addValue("templateId", templateId)
                        .addValue("orgId", orgId),
                UUID.class);
    }

    public void updateStatus(UUID jobId, String status, Instant now) {
        // 跨租户防护:仅允许同组织更新状态
        int updated = jdbc.update(
                "UPDATE import_job SET status = :status, updated_at = :now, version = version + 1 "
                        + "WHERE id = :id AND organization_id = :orgId",
                new MapSqlParameterSource()
                        .addValue("id", jobId)
                        .addValue("orgId", TenantContext.requireOrganizationId())
                        .addValue("status", status)
                        .addValue("now", now));
        if (updated == 0) {
            throw new DomainException(404, "IMPORT_JOB_NOT_FOUND", "导入任务不存在");
        }
    }

    public void finishJob(UUID jobId, String status, String summary, Instant now) {
        // 跨租户防护:仅允许同组织结束任务
        int updated = jdbc.update(
                "UPDATE import_job SET status = :status, summary = :summary::jsonb, finished_at = :now, "
                        + "updated_at = :now, version = version + 1 "
                        + "WHERE id = :id AND organization_id = :orgId",
                new MapSqlParameterSource()
                        .addValue("id", jobId)
                        .addValue("orgId", TenantContext.requireOrganizationId())
                        .addValue("status", status)
                        .addValue("summary", summary)
                        .addValue("now", now));
        if (updated == 0) {
            throw new DomainException(404, "IMPORT_JOB_NOT_FOUND", "导入任务不存在");
        }
    }

    public void addError(UUID jobId, String sheet, Integer rowNumber, String columnLabel,
                         String errorCode, String message, String rawValue, Instant now) {
        // 跨租户防护:仅允许同组织写入错误行
        int updated = jdbc.update(
                "INSERT INTO import_row_error (id, import_job_id, sheet, row_number, column_label, error_code, message, raw_value, created_at) "
                        + "SELECT :id, :jobId, :sheet, :row, :col, :code, :msg, :raw, :now "
                        + "FROM import_job WHERE id = :jobId AND organization_id = :orgId",
                new MapSqlParameterSource()
                        .addValue("id", idGenerator.next())
                        .addValue("jobId", jobId)
                        .addValue("orgId", TenantContext.requireOrganizationId())
                        .addValue("sheet", sheet)
                        .addValue("row", rowNumber)
                        .addValue("col", columnLabel)
                        .addValue("code", errorCode)
                        .addValue("msg", message)
                        .addValue("raw", rawValue != null && rawValue.length() > 500 ? rawValue.substring(0, 500) : rawValue)
                        .addValue("now", now));
        if (updated == 0) {
            throw new DomainException(404, "IMPORT_JOB_NOT_FOUND", "导入任务不存在");
        }
    }

    public List<ImportViews.ImportError> findErrors(UUID jobId, int limit, int offset) {
        // 跨租户防护:JOIN import_job 校验 organization_id,仅返回同组织的错误行。
        return jdbc.query(
                        "SELECT e.sheet, e.row_number, e.column_label, e.error_code, e.message, e.raw_value "
                                + "FROM import_row_error e "
                                + "JOIN import_job j ON j.id = e.import_job_id "
                                + "WHERE e.import_job_id = :jobId AND j.organization_id = :orgId "
                                + "ORDER BY e.created_at, e.row_number NULLS LAST "
                                + "LIMIT :limit OFFSET :offset",
                        new MapSqlParameterSource()
                                .addValue("jobId", jobId)
                                .addValue("orgId", TenantContext.requireOrganizationId())
                                .addValue("limit", limit)
                                .addValue("offset", offset),
                        ImportJobRepository::mapError)
                .stream()
                .toList();
    }

    public int countErrors(UUID jobId) {
        // 跨租户防护:JOIN import_job 校验 organization_id。
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM import_row_error e "
                        + "JOIN import_job j ON j.id = e.import_job_id "
                        + "WHERE e.import_job_id = :jobId AND j.organization_id = :orgId",
                new MapSqlParameterSource()
                        .addValue("jobId", jobId)
                        .addValue("orgId", TenantContext.requireOrganizationId()),
                Integer.class);
        return count == null ? 0 : count;
    }

    private static ImportViews.ImportError mapError(ResultSet rs, int rowNum) throws SQLException {
        return new ImportViews.ImportError(
                rs.getString("sheet"),
                rs.getObject("row_number", Integer.class),
                rs.getString("column_label"),
                rs.getString("error_code"),
                rs.getString("message"),
                rs.getString("raw_value"));
    }

    private static JobRecord mapJob(ResultSet rs, int rowNum) throws SQLException {
        return new JobRecord(
                rs.getObject("id", UUID.class),
                rs.getString("file_name"),
                rs.getString("file_sha256"),
                rs.getString("status"));
    }

    public record JobRecord(UUID id, String fileName, String fileSha256, String status) {}
}
