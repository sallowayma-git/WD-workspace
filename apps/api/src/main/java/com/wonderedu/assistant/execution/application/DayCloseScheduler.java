package com.wonderedu.assistant.execution.application;

import com.wonderedu.assistant.execution.api.DayCloseViews;
import java.time.LocalDate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Scheduler that drives {@link DayCloseService#runDayClose(LocalDate)} on a cron trigger, satisfying
 * PRD FR-EXEC-005 "日结时间" automatic semantics.
 *
 * <p>The cron expression is read from {@code assistant.day-close-cron} (defaults to {@code 0 0 5 * * *}
 * — every day at 05:00 in the server timezone). The dev profile sets {@code assistant.day-close-cron-enabled}
 * to {@code false} so the scheduler bean is not registered at all via {@link ConditionalOnProperty}.
 *
 * <p>Scheduler threads have no request-bound {@link TenantContext}. {@code DayCloseService.runDayClose}
 * resolves the organization from {@link TenantContext#currentOrganizationId()} and falls back to the
 * configured default organization when that value is absent, so the scheduler invokes the
 * {@code (businessDate)} overload and lets the service populate {@code TenantContext}.
 *
 * <p>Cross-instance locking (Quartz JDBC JobStore) is deferred to the full SDD §9.7 rollout; the dev
 * profile is single-instance and does not require it.
 */
@Component
@ConditionalOnProperty(prefix = "assistant", name = "day-close-cron-enabled", havingValue = "true", matchIfMissing = true)
public class DayCloseScheduler {

    private static final Logger log = LoggerFactory.getLogger(DayCloseScheduler.class);

    private final DayCloseService dayCloseService;

    @Value("${assistant.business-timezone:Asia/Shanghai}")
    private String businessTimezone;

    public DayCloseScheduler(DayCloseService dayCloseService) {
        this.dayCloseService = dayCloseService;
    }

    /**
     * Fire the day-close sweep on the configured cron. Uses the server clock to resolve the
     * business date; {@code DayCloseService} applies its own business clock for run timestamps
     * and per-task carry-over dating.
     */
    @Scheduled(cron = "${assistant.day-close-cron:0 0 5 * * *}")
    public void runDayClose() {
        LocalDate businessDate = LocalDate.now(
                java.time.ZoneId.of(businessTimezone));
        log.info("scheduled day-close trigger fired for businessDate={} (tz={})", businessDate, businessTimezone);
        try {
            DayCloseViews.DayCloseRunSummary summary = dayCloseService.runDayClose(businessDate);
            log.info(
                    "scheduled day-close completed: runId={} status={} scanned={} carried={} blocked={} skipped={} failed={}",
                    summary.runId(),
                    summary.status(),
                    summary.scanned(),
                    summary.carried(),
                    summary.blocked(),
                    summary.skipped(),
                    summary.failed());
        } catch (RuntimeException ex) {
            log.error("scheduled day-close run failed for businessDate={}", businessDate, ex);
        }
    }
}
