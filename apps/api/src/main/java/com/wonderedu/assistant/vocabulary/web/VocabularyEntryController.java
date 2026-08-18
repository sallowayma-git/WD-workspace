package com.wonderedu.assistant.vocabulary.web;

import com.wonderedu.assistant.vocabulary.api.VocabularyViews.UpdateEntryRequest;
import com.wonderedu.assistant.vocabulary.api.VocabularyViews.VocabularyEntryView;
import com.wonderedu.assistant.vocabulary.application.VocabularyService;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Handles entry-level vocabulary mutations. Lives at {@code /api/v1/vocabulary/...} (SDD §11.8),
 * separate from {@link VocabularyController} which serves the student-scoped list/batch routes
 * under {@code /api/v1/students/{studentId}/vocabulary}.
 */
@RestController
@RequestMapping("/api/v1/vocabulary/entries")
public class VocabularyEntryController {

    private final VocabularyService service;

    public VocabularyEntryController(VocabularyService service) {
        this.service = service;
    }

    @PatchMapping("/{entryId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT')")
    public VocabularyEntryView update(
            @PathVariable UUID entryId, @RequestBody UpdateEntryRequest request) {
        return service.updateEntry(entryId, request);
    }
}
