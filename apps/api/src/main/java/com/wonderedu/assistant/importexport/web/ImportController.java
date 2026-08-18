package com.wonderedu.assistant.importexport.web;

import com.wonderedu.assistant.importexport.api.ImportCommands;
import com.wonderedu.assistant.importexport.api.ImportViews;
import com.wonderedu.assistant.importexport.application.ImportService;
import com.wonderedu.assistant.importexport.application.ImportService.ErrorCsv;
import java.io.IOException;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/imports")
public class ImportController {

    private final ImportService service;

    public ImportController(ImportService service) {
        this.service = service;
    }

    @PostMapping("/template-xlsx")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public ImportViews.ImportPreview uploadAndPreview(@RequestParam("file") MultipartFile file) throws IOException {
        return service.uploadAndPreview(file.getBytes(), file.getOriginalFilename());
    }

    /**
     * Re-trigger preview for an already-uploaded job (SDD §11.10 / §14.2 step 3). Returns the
     * previously persisted {@link ImportViews.ImportPreview}, including any saved column mappings.
     * Tenant isolation is enforced inside the service via {@code organization_id} checks; a
     * cross-tenant job id surfaces as 404.
     */
    @PostMapping("/{jobId}/preview")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public ImportViews.ImportPreview preview(@PathVariable UUID jobId) {
        return service.preview(jobId);
    }

    /**
     * Save user-adjusted column mappings (SDD §11.10 / §14.2 step 4). Each column mapping carries
     * per-column overrides (templateCode/name/shortName/subjectCode/unitLabel/duration/
     * requiresDevice) that persist to {@code import_job.mapping_config} for the subsequent
     * {@code execute}. Tenant isolation is enforced inside the service; a cross-tenant job id
     * surfaces as 404.
     */
    @PutMapping("/{jobId}/mapping")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public ImportViews.ImportPreview saveMapping(
            @PathVariable UUID jobId, @RequestBody ImportCommands.SaveMapping command) {
        return service.saveMapping(jobId, command);
    }

    @PostMapping("/{jobId}/execute")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public ImportViews.ImportJobStatus execute(
            @PathVariable UUID jobId, @RequestBody ImportCommands.ExecuteImport command) {
        return service.execute(jobId, command);
    }

    /**
     * List row-level import errors for a job (SDD §11.10 / §14.2 step 7, P1-IMP-006). Tenant
     * isolation is enforced inside the service via {@code organization_id} checks; a cross-tenant
     * job id surfaces as 404.
     *
     * <p>If the client requests {@code text/csv} or passes {@code ?format=csv}, the error list is
     * rendered as a CSV download that reuses the {@link ImportService#generateErrorsCsv} guard
     * against spreadsheet formula injection. Otherwise the list is returned as JSON with simple
     * limit/offset pagination.
     */
    @GetMapping("/{jobId}/errors")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public Object listErrors(
            @PathVariable UUID jobId,
            @RequestParam(value = "format", required = false) String format,
            @RequestParam(value = "limit", required = false, defaultValue = "200") Integer limit,
            @RequestParam(value = "offset", required = false, defaultValue = "0") Integer offset,
            @RequestHeader(value = HttpHeaders.ACCEPT, required = false) String accept) {
        int safeLimit = Math.min(Math.max(limit, 1), 1000);
        int safeOffset = Math.max(offset, 0);
        boolean csvRequested = "csv".equalsIgnoreCase(format)
                || (accept != null && accept.toLowerCase().contains("text/csv"));
        if (csvRequested) {
            ErrorCsv csv = service.generateErrorsCsv(jobId);
            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + csv.filename() + "\"")
                    .contentType(MediaType.parseMediaType("text/csv; charset=UTF-8"))
                    .header(HttpHeaders.CONTENT_LENGTH, String.valueOf(csv.bytes().length))
                    .body(csv.bytes());
        }
        return service.listErrors(jobId, safeLimit, safeOffset);
    }
}
