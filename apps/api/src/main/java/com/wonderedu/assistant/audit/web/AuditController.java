package com.wonderedu.assistant.audit.web;

import com.wonderedu.assistant.audit.api.AuditEventView;
import com.wonderedu.assistant.audit.application.AuditService;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Read-only HTTP API for audit events.
 *
 * <p>Access is restricted to {@code ADMIN} and {@code LEAD_TEACHER} roles via
 * {@code @PreAuthorize}; this satisfies the PRD requirement that audit/export data be
 * gated to administrative users. All queries are tenant-scoped via {@code TenantContext},
 * so a caller can never read another organization's events regardless of role.
 *
 * <p>The list endpoint returns a paginated envelope rather than Spring's {@code Page}
 * to keep the API contract stable and framework-agnostic.
 */
@RestController
@RequestMapping("/api/v1/audit-events")
public class AuditController {

    private final AuditService service;

    public AuditController(AuditService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'LEAD_TEACHER')")
    public AuditEventsResponse list(
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "size", defaultValue = "20") int size) {
        AuditService.AuditPage result = service.findPage(page, size);
        return new AuditEventsResponse(
                result.events(),
                result.page(),
                result.size(),
                result.total(),
                result.totalPages());
    }

    /** Paginated envelope for {@code GET /api/v1/audit-events}. */
    public record AuditEventsResponse(
            List<AuditEventView> events,
            long page,
            int size,
            long total,
            int totalPages) {}
}
