package com.wonderedu.assistant.execution.web;

import com.wonderedu.assistant.execution.api.DayCloseViews.DayCloseRunSummary;
import com.wonderedu.assistant.execution.application.DayCloseService;
import com.wonderedu.assistant.shared.TenantContext;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Manual trigger for the organization day-close job (SDD §9.7 / AC-006).
 *
 * <p>Exposes {@code POST /api/v1/admin/day-close} restricted to the {@code ADMIN} role so operators
 * can run or re-run the carry-over sweep for a business date out-of-band of the scheduled trigger.
 * The {@link TenantContextFilter} has already established the {@link TenantContext} from the
 * authenticated principal before this controller is reached, so the organization id is resolved
 * from the caller's principal rather than the request body — this prevents cross-tenant invocation.
 *
 * <p>Body shape: {@code {"businessDate": "2026-08-17"}}.
 */
@RestController
@RequestMapping("/api/v1/admin")
public class DayCloseController {

    private final DayCloseService service;

    public DayCloseController(DayCloseService service) {
        this.service = service;
    }

    @PostMapping("/day-close")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<DayCloseRunSummary> runDayClose(@RequestBody DayCloseRequest request) {
        if (request == null || request.businessDate() == null) {
            return ResponseEntity.badRequest().build();
        }
        UUID organizationId = TenantContext.requireOrganizationId();
        DayCloseRunSummary summary = service.runDayClose(organizationId, request.businessDate());
        return ResponseEntity.ok(summary);
    }

    /** Request body for {@code POST /api/v1/admin/day-close}. */
    public record DayCloseRequest(LocalDate businessDate) {}
}
