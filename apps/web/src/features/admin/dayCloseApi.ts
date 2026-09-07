import { z } from "zod";
import { getDataAdapter } from "../../data/runtime";

// UUIDs and dates remain plain strings at the local data-adapter boundary.

export const dayCloseRunSummarySchema = z.object({
  businessDate: z.string(),
  scanned: z.number(),
  carried: z.number(),
  blocked: z.number(),
  skipped: z.number(),
  failed: z.number(),
});

export type DayCloseRunSummary = z.infer<typeof dayCloseRunSummarySchema>;

/** Runs local day-close for an ISO-8601 calendar date. */
export function triggerDayClose(
  businessDate: string,
): Promise<DayCloseRunSummary> {
  return getDataAdapter()
    .triggerDayClose(businessDate)
    .then((value) => dayCloseRunSummarySchema.parse(value));
}

export const startupReconciliationSchema = z.object({
  ran: z.boolean(),
  previousDate: z.string().nullable(),
  businessDate: z.string(),
  summary: dayCloseRunSummarySchema.nullable(),
});

export type StartupReconciliation = z.infer<typeof startupReconciliationSchema>;

/** 启动补日结：同一业务日只跑一次。 */
export function reconcileStartup(
  businessDate: string,
): Promise<StartupReconciliation> {
  return getDataAdapter()
    .reconcileStartup(businessDate)
    .then((value) => startupReconciliationSchema.parse(value));
}
