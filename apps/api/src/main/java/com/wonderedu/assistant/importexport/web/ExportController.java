package com.wonderedu.assistant.importexport.web;

import com.wonderedu.assistant.importexport.api.ExportCommands;
import com.wonderedu.assistant.importexport.application.ExportService;
import com.wonderedu.assistant.importexport.application.ExportService.ExportResult;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * HTTP layer for synchronous exports (SDD §11.10 ExportController).
 *
 * <p>The vocabulary-export route is mapped on this controller at
 * {@code POST /api/v1/students/{studentId}/vocabulary/export} (SDD §11.8 path requirement) so the
 * importexport module owns the export feature end-to-end and the vocabulary module does not have to
 * depend on it. A generic mirror is exposed at
 * {@code POST /api/v1/exports/vocabulary/{studentId}} for clients that address exports generically.
 */
@RestController
public class ExportController {

    private final ExportService exportService;

    public ExportController(ExportService exportService) {
        this.exportService = exportService;
    }

    /**
     * Export the student's vocabulary as a CSV download (SDD §11.8 / §11.10, PRD FR-VOCAB-004).
     * The tenant guard runs inside {@link ExportService} before any row is read, so an
     * out-of-organization student id surfaces as a 404 {@code STUDENT_NOT_FOUND}.
     */
    @PostMapping("/api/v1/students/{studentId}/vocabulary/export")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public ResponseEntity<byte[]> exportVocabularyByStudent(
            @PathVariable UUID studentId,
            @RequestBody(required = false) ExportCommands.VocabularyExportRequest request) {
        return vocabularyResponse(studentId, request);
    }

    @PostMapping("/api/v1/exports/vocabulary/{studentId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public ResponseEntity<byte[]> exportVocabulary(
            @PathVariable UUID studentId,
            @RequestBody(required = false) ExportCommands.VocabularyExportRequest request) {
        return vocabularyResponse(studentId, request);
    }

    /**
     * Renders the CSV as {@code text/csv} with an RFC 6266 {@code attachment} disposition and a
     * stable filename.
     */
    private ResponseEntity<byte[]> vocabularyResponse(
            UUID studentId,
            ExportCommands.VocabularyExportRequest request) {
        ExportCommands.VocabularyExportRequest body =
                request != null ? request : new ExportCommands.VocabularyExportRequest(null, null);
        ExportResult result = exportService.generateVocabularyCsv(studentId, body.dateFrom(), body.dateTo());
        String filename = "vocabulary-" + studentId + ".csv";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.parseMediaType("text/csv; charset=UTF-8"))
                .header(HttpHeaders.CONTENT_LENGTH, String.valueOf(result.bytes().length))
                .body(result.bytes());
    }
}
