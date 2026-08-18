import { z } from "zod";
import { getJson } from "../../lib/api/http";

const taskSummarySchema = z.object({
  id: z.string().uuid(),
  shortTitle: z.string().nullable(),
  status: z.string(),
  version: z.number(),
  // Shared TaskCard contract (D2 wiring). The backend WorkbenchTaskSummary
  // only emits the four fields above; the rest are optional so the page can
  // adapt the summary into a TaskLike without a backend change.
  title: z.string().nullable().optional(),
  sourceType: z.string().nullable().optional(),
  itemOrdinal: z.number().nullable().optional(),
  durationMinutes: z.number().nullable().optional(),
  locked: z.boolean().nullable().optional(),
  carriedOver: z.boolean().nullable().optional(),
  scheduledDate: z.string().nullable().optional(),
  parentTaskId: z.string().uuid().nullable().optional(),
  linkedParentTaskId: z.string().uuid().nullable().optional(),
  priority: z.string().nullable().optional(),
  sortOrder: z.number().nullable().optional(),
  star: z.boolean().nullable().optional(),
});

const dayCellSchema = z.object({
  date: z.string(),
  available: z.boolean(),
  availableMinutes: z.number(),
  tasks: z.array(taskSummarySchema),
});

const studentTagSchema = z.object({
  code: z.string(),
  name: z.string(),
});

const studentRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  devicePolicy: z.string(),
  tags: z.array(studentTagSchema),
  vocabularyCountThisWeek: z.number(),
  days: z.record(z.string(), dayCellSchema),
});

const workbenchResponseSchema = z.object({
  range: z.object({
    from: z.string(),
    to: z.string(),
  }),
  students: z.array(studentRowSchema),
});

export type WorkbenchTask = z.infer<typeof taskSummarySchema>;
export type WorkbenchDayCell = z.infer<typeof dayCellSchema>;
export type WorkbenchStudentRow = z.infer<typeof studentRowSchema>;
export type WorkbenchResponse = z.infer<typeof workbenchResponseSchema>;

export function getWorkbench(
  from?: string,
  to?: string,
): Promise<WorkbenchResponse> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const suffix = params.size === 0 ? "" : `?${params.toString()}`;
  return getJson(`/workbench${suffix}`, workbenchResponseSchema);
}
