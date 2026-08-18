package com.wonderedu.assistant.execution.application;

import com.wonderedu.assistant.execution.api.DayCloseViews.DayCloseItemResult;
import com.wonderedu.assistant.execution.api.DayCloseViews.DayCloseRunSummary;
import com.wonderedu.assistant.execution.api.ExecutionCommands;
import com.wonderedu.assistant.execution.api.ExecutionViews.CarryOverResult;
import com.wonderedu.assistant.identity.IdentityProperties;
import com.wonderedu.assistant.planning.api.TaskInstanceView;
import com.wonderedu.assistant.planning.persistence.TaskInstanceRepository;
import com.wonderedu.assistant.shared.BusinessClock;
import com.wonderedu.assistant.shared.IdGenerator;
import com.wonderedu.assistant.shared.TenantContext;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * Organization day-close job skeleton (SDD §9.7 / AC-006).
 *
 * <p>Scans {@code task_instance} rows where {@code organization_id = orgId AND scheduled_date <=
 * businessDate AND status = 'PENDING' AND locked = false} and delegates each candidate to
 * {@link ExecutionService#carryOverTask(ExecutionCommands.CarryOverTask)}. The per-task carry-over
 * logic, including idempotency (BR-012), duplicate-target detection, and BLOCKED transitions, is
 * owned by {@code carryOverTask}; this job does not re-implement business rules.
 *
 * <p>Concurrency / idempotency:
 * <ul>
 *   <li>BR-012: each carry-over command carries a stable reason string rather than a per-call
 *       idempotency key; {@code carryOverTask} already guards against duplicate PENDING instances
 *       at the target date for the same track+ordinal, so a re-run of the same business date is
 *       a no-op for already-carried tasks (they are no longer PENDING and are skipped).
 *   <li>The job itself is single-threaded per invocation. Cross-instance locking (Quartz JDBC
 *       JobStore) is deferred to the full SDD §9.7 rollout; the dev profile does not require it.
 * </ul>
 *
 * <p>Tenant isolation: the job sets {@link TenantContext} for the run lifetime so downstream
 * repository queries (which read {@code TenantContext.requireOrganizationId()}) stay scoped to
 * the target organization. The candidate query additionally filters by {@code organization_id}
 * explicitly so a stale or misconfigured {@code TenantContext} cannot leak cross-tenant rows.
 */
@Service
public class DayCloseService {

    private static final Logger log = LoggerFactory.getLogger(DayCloseService.class);

    /**
     * Page size for candidate scanning. SDD §9.7 specifies batches of 100–500; the midpoint keeps
     * memory bounded while avoiding excessive round-trips on the dev dataset.
     */
    static final int PAGE_SIZE = 200;

    private final TaskInstanceRepository taskRepo;
    private final ExecutionService executionService;
    private final BusinessClock clock;
    private final IdGenerator idGenerator;
    private final UUID defaultOrganizationId;

    @Autowired
    public DayCloseService(
            TaskInstanceRepository taskRepo,
            ExecutionService executionService,
            BusinessClock clock,
            IdGenerator idGenerator,
            IdentityProperties properties) {
        this(taskRepo, executionService, clock, idGenerator, properties.organizationId());
    }

    DayCloseService(
            TaskInstanceRepository taskRepo,
            ExecutionService executionService,
            BusinessClock clock,
            IdGenerator idGenerator,
            UUID defaultOrganizationId) {
        this.taskRepo = taskRepo;
        this.executionService = executionService;
        this.clock = clock;
        this.idGenerator = idGenerator;
        this.defaultOrganizationId = defaultOrganizationId;
    }

    /**
     * Run the day-close carry-over sweep, resolving the organization from the current
     * {@link TenantContext} when invoked from an authenticated request thread, falling back to the
     * configured default organization when invoked from the {@code @Scheduled} path (no request).
     * Delegates to {@link #runDayClose(UUID, LocalDate)}.
     */
    public DayCloseRunSummary runDayClose(LocalDate businessDate) {
        UUID organizationId = TenantContext.currentOrganizationId();
        if (organizationId == null) {
            organizationId = defaultOrganizationId;
        }
        return runDayClose(organizationId, businessDate);
    }

    /**
     * Run the day-close carry-over sweep for {@code organizationId} on {@code businessDate}.
     *
     * <p>Sets the {@link TenantContext} for the run, pages through PENDING unlocked tasks scheduled
     * on or before {@code businessDate}, and invokes {@link ExecutionService#carryOverTask} per
     * candidate. Each per-task invocation runs in its own transaction (the method is
     * {@code @Transactional} on {@code ExecutionService}); this service method is intentionally
     * <em>not</em> transactional so a single task failure cannot roll back the whole batch.
     *
     * @param organizationId the tenant to run against; must not be null
     * @param businessDate the business date; tasks scheduled on or before this date are eligible
     * @return a non-null {@link DayCloseRunSummary} capturing the run outcome
     */
    public DayCloseRunSummary runDayClose(UUID organizationId, LocalDate businessDate) {
        if (organizationId == null) {
            throw new IllegalArgumentException("organizationId must not be null");
        }
        if (businessDate == null) {
            throw new IllegalArgumentException("businessDate must not be null");
        }

        UUID runId = idGenerator.next();
        Instant startedAt = clock.now();
        List<DayCloseItemResult> items = new ArrayList<>();
        int scanned = 0;
        int carried = 0;
        int blocked = 0;
        int skipped = 0;
        int failed = 0;
        String firstError = null;

        TenantContext.set(organizationId);
        try {
            long offset = 0;
            while (true) {
                List<TaskInstanceView> page =
                        taskRepo.findPendingCarryOverCandidates(organizationId, businessDate, PAGE_SIZE, offset);
                if (page.isEmpty()) {
                    break;
                }
                for (TaskInstanceView task : page) {
                    scanned++;
                    DayCloseItemResult item;
                    try {
                        ExecutionCommands.CarryOverTask command = new ExecutionCommands.CarryOverTask(
                                task.id(), null, "DAY_CLOSE:" + businessDate);
                        CarryOverResult result = executionService.carryOverTask(command);
                        item = toItem(task.id(), result);
                        switch (item.outcome()) {
                            case "CARRIED_OVER" -> carried++;
                            case "BLOCKED" -> blocked++;
                            default -> skipped++;
                        }
                    } catch (RuntimeException ex) {
                        failed++;
                        String safeMessage = sanitize(ex);
                        if (firstError == null) {
                            firstError = safeMessage;
                        }
                        item = new DayCloseItemResult(task.id(), null, null, "FAILED", safeMessage);
                        log.warn("day-close carry-over failed for task {} (runId={})", task.id(), runId, ex);
                    }
                    items.add(item);
                }
                offset += page.size();
                if (page.size() < PAGE_SIZE) {
                    break;
                }
            }
        } finally {
            TenantContext.clear();
        }

        Instant finishedAt = clock.now();
        String status;
        if (failed == 0) {
            status = "SUCCEEDED";
        } else if (carried + blocked + skipped > 0) {
            status = "PARTIAL";
        } else {
            status = "FAILED";
        }

        return new DayCloseRunSummary(
                runId,
                organizationId,
                businessDate,
                startedAt,
                finishedAt,
                scanned,
                carried,
                blocked,
                skipped,
                failed,
                status,
                firstError,
                items);
    }

    private static DayCloseItemResult toItem(UUID sourceTaskId, CarryOverResult result) {
        String outcome;
        switch (result.status()) {
            case "CARRIED_OVER" -> outcome = "CARRIED_OVER";
            case "BLOCKED" -> outcome = "BLOCKED";
            default -> outcome = "SKIPPED";
        }
        return new DayCloseItemResult(
                sourceTaskId, result.targetTaskId(), result.targetDate(), outcome, result.reason());
    }

    /**
     * Returns the exception class simple name plus a trimmed message, never the full stack trace,
     * so the run summary stays safe to expose to operators. SDD §9.7 requires a sanitized
     * {@code error_summary}.
     */
    private static String sanitize(RuntimeException ex) {
        String type = ex.getClass().getSimpleName();
        String msg = ex.getMessage();
        if (msg == null || msg.isBlank()) {
            return type;
        }
        if (msg.length() > 200) {
            msg = msg.substring(0, 200);
        }
        return type + ": " + msg;
    }
}
