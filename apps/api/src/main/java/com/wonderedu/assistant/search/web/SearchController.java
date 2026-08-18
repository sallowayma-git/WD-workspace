package com.wonderedu.assistant.search.web;

import com.wonderedu.assistant.search.api.SearchViews;
import com.wonderedu.assistant.search.application.SearchDocumentService;
import com.wonderedu.assistant.search.application.SearchService;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class SearchController {

    private final SearchService service;
    private final SearchDocumentService documentService;

    public SearchController(SearchService service, SearchDocumentService documentService) {
        this.service = service;
        this.documentService = documentService;
    }

    @GetMapping("/search")
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER', 'ASSISTANT', 'VIEWER')")
    public SearchViews.SearchResponse search(
            @RequestParam String q,
            @RequestParam(required = false) List<String> types,
            @RequestParam(defaultValue = "20") int limit) {
        return service.search(q, types, limit);
    }

    /**
     * Manually trigger a full rebuild of the {@code search_document} projection for the caller's
     * organization (SDD §8.17 / §13.2).
     *
     * <p>Restricted to the {@code ADMIN} role. The organization id is resolved from the
     * authenticated principal via {@link com.wonderedu.assistant.shared.TenantContext}, so the
     * endpoint cannot be used to rebuild another tenant's projection.
     */
    @PostMapping("/admin/search/rebuild")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<RebuildResponse> rebuild() {
        int written = documentService.rebuild();
        return ResponseEntity.ok(new RebuildResponse(written));
    }

    /** Response body for {@code POST /api/v1/admin/search/rebuild}. */
    public record RebuildResponse(int documentsWritten) {}
}
