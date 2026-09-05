import { z } from "zod";
import { getDataAdapter } from "../../data/runtime";

// UUIDs and dates remain plain strings at the local data-adapter boundary.

const dayCloseItemResultSchema = z.object({
  studentId: z.string().uuid().nullable().optional(),
  studentName: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  sourceTaskId: z.string().uuid().nullable(),
  targetTaskId: z.string().uuid().nullable(),
  targetDate: z.string().nullable(),
  outcome: z.string(),
  reason: z.string().nullable(),
});

export const dayCloseRunSummarySchema = z.object({
  runId: z.string().uuid(),
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

/** Runs local day-close for an ISO-8601 calendar date. */
export function triggerDayClose(
  businessDate: string,
): Promise<DayCloseRunSummary> {
  return getDataAdapter()
    .triggerDayClose(businessDate)
    .then((value) => dayCloseRunSummarySchema.parse(value));
}
