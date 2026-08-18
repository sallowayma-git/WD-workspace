package com.wonderedu.assistant.search.application;

import com.wonderedu.assistant.search.persistence.SearchDocumentRepository;
import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.TenantContext;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Application service for the {@code search_document} projection (SDD §8.17 / §13.2).
 *
 * <p>Local-application (dev profile) baseline: there is no event bus or publication registry. This
 * service exposes the manual rebuild trigger that {@code SearchRebuildJob} describes in SDD §13.2:
 * it re-materializes the projection for the caller's organization from the master tables in a
 * single transaction so a partial failure leaves the projection unchanged.
 *
 * <p>The organization id is resolved from {@link TenantContext} (established by the
 * {@code TenantContextFilter} from the authenticated principal) rather than the request body, which
 * prevents cross-tenant invocation. The read path in {@link SearchService} continues to query the
 * source tables directly until a later milestone switches it to read from this projection.
 */
@Service
public class SearchDocumentService {

    private final SearchDocumentRepository repository;
    private final BusinessClock clock;

    public SearchDocumentService(SearchDocumentRepository repository, BusinessClock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    /**
     * Rebuild the entire {@code search_document} projection for the caller's organization.
     *
     * @return the total number of documents written across all document types
     */
    @Transactional
    public int rebuild() {
        UUID organizationId = TenantContext.requireOrganizationId();
        Instant now = clock.now();
        return repository.rebuildAll(organizationId, now);
    }
}
