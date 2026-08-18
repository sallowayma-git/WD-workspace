import { z } from "zod";
import { postJson } from "../../lib/api/http";

// AC-006 / SDD §9.7: client for the organization day-close manual trigger.
// Mirrors com.wonderedu.assistant.execution.api.DayCloseViews.DayCloseRunSummary.
// IDs are UUIDs over the wire; instants are ISO-8601 strings; businessDate is
// an ISO-8601 date (yyyy-MM-dd). outcome/status are free-form strings so the
// schema stays resilient to future enum additions without breaking parsing.

const dayCloseItemResultSchema = z.object({
  sourceTaskId: z.string().uuid().nullable(),
  targetTaskId: z.string().uuid().nullable(),
  targetDate: z.string().nullable(),
  outcome: z.string(),
  reason: z.string().nullable(),
});

export const dayCloseRunSummarySchema = z.object({
  runId: z.string().uuid(),
  organizationId: z.string().uuid(),
  businessDate: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  scanned: z.number(),
  carried: z.number(),
  blocked: z.number(),
  skipped: z.number(),
  failed: z.number(),
  status: z.string(),
  errorSummary: z.string().nullable(),
  items: z.array(dayCloseItemResultSchema),
});

export type DayCloseItemResult = z.infer<typeof dayCloseItemResultSchema>;
export type DayCloseRunSummary = z.infer<typeof dayCloseRunSummarySchema>;

/**
 * Manually trigger the organization day-close job via
 * POST /api/v1/admin/day-close. @PreAuthorize on the backend restricts
 * invocation to the ADMIN role; a 403 surfaces to the caller as an ApiError.
 *
 * @param businessDate ISO-8601 date string (yyyy-MM-dd) for the day-close run.
 */
export function triggerDayClose(
  businessDate: string,
): Promise<DayCloseRunSummary> {
  return postJson("/admin/day-close", dayCloseRunSummarySchema, {
    businessDate,
  });
}
