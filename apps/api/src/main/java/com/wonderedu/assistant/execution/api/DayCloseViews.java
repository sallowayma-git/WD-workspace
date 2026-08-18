package com.wonderedu.assistant.execution.api;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * View records for the organization day-close job (SDD §9.7).
 *
 * <p>The skeleton implementation returns an in-memory {@link DayCloseRunSummary} rather than
 * persisting a {@code day_close_run} row; persistence is deferred to the full Quartz JDBC JobStore
 * rollout. The summary shape mirrors the SDD §9.7 run-record fields so a future migration can
 * capture the same data without changing the API contract.
 */
public final class DayCloseViews {

    private DayCloseViews() {}

    /**
     * Outcome of a single task processed by the day-close job.
     *
     * @param sourceTaskId the scanned PENDING task instance id
     * @param targetTaskId the new PENDING instance id when carried over, otherwise null
     * @param targetDate the target scheduled date when carried over, otherwise null
     * @param outcome one of CARRIED_OVER, BLOCKED, SKIPPED, FAILED
     * @param reason human-readable explanation, sanitized (no internal stack traces)
     */
    public record DayCloseItemResult(
            UUID sourceTaskId,
            UUID targetTaskId,
            LocalDate targetDate,
            String outcome,
            String reason) {}

    /**
     * Aggregate summary of one day-close run. Field names follow SDD §9.7 run-record columns.
     *
     * @param runId unique run identifier (stable across retries of the same org+date)
     * @param organizationId the tenant the run executed against
     * @param businessDate the day-close business date (tasks scheduled on/before this date are scanned)
     * @param startedAt run start instant
     * @param finishedAt run finish instant, null while RUNNING
     * @param scanned total PENDING+unlocked candidates inspected
     * @param carried tasks transitioned to CARRIED_OVER with a new PENDING instance
     * @param blocked tasks transitioned to BLOCKED (no next available day)
     * @param skipped tasks skipped due to status/lock/duplicate-target idempotency
     * @param failed tasks whose carry-over raised an exception
     * @param status RUNNING, SUCCEEDED, PARTIAL, or FAILED
     * @param errorSummary sanitized error summary, null when no failures
     * @param items per-task results (capped for response size; full list available to callers)
     */
    public record DayCloseRunSummary(
            UUID runId,
            UUID organizationId,
            LocalDate businessDate,
            Instant startedAt,
            Instant finishedAt,
            int scanned,
            int carried,
            int blocked,
            int skipped,
            int failed,
            String status,
            String errorSummary,
            List<DayCloseItemResult> items) {}
}
