package com.wonderedu.assistant.vocabulary.web;

import com.wonderedu.assistant.vocabulary.api.VocabularyViews;
import com.wonderedu.assistant.vocabulary.api.VocabularyViews.PreviewBatchRequest;
import com.wonderedu.assistant.vocabulary.api.VocabularyViews.SaveBatchRequest;
import com.wonderedu.assistant.vocabulary.api.VocabularyViews.VocabularyListResponse;
import com.wonderedu.assistant.vocabulary.application.VocabularyService;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/students/{studentId}/vocabulary")
public class VocabularyController {

    private final VocabularyService service;

    public VocabularyController(VocabularyService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT', 'VIEWER')")
    public VocabularyListResponse list(
            @PathVariable UUID studentId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) String subject,
            @RequestParam(defaultValue = "100") int limit) {
        return service.listByStudent(studentId, from, to, subject, limit);
    }

    @PostMapping("/batches:preview")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public VocabularyViews.PreviewBatchResponse preview(
            @PathVariable UUID studentId, @RequestBody PreviewBatchRequest request) {
        return service.previewBatch(studentId, request);
    }

    @PostMapping("/batches")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public UUID saveBatch(
            @PathVariable UUID studentId, @RequestBody SaveBatchRequest request) {
        return service.saveBatch(studentId, request);
    }
}
