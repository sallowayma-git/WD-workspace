import { z } from "zod";
import { getJson, postJson } from "../../lib/api/http";

const scheduleTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  shortTitle: z.string().nullable(),
  status: z.string(),
  sourceType: z.string(),
  itemOrdinal: z.number().nullable(),
  durationMinutes: z.number().nullable(),
  locked: z.boolean(),
  version: z.number(),
  // Shared TaskCard contract (D2 wiring). The backend ScheduleTaskSummary
  // does not yet emit these columns; they are optional so the field stays
  // undefined when absent, and toTaskLike passes the value through instead of
  // hardcoding it (so star/priority reflect server state when present).
  parentTaskId: z.string().uuid().nullable().optional(),
  linkedParentTaskId: z.string().uuid().nullable().optional(),
  priority: z.string().nullable().optional(),
  sortOrder: z.number().nullable().optional(),
  star: z.boolean().nullable().optional(),
});

const scheduleDaySchema = z.object({
  date: z.string(),
  available: z.boolean(),
  availableMinutes: z.number(),
  devicePolicy: z.string(),
  tasks: z.array(scheduleTaskSchema),
});

const scheduleResponseSchema = z.object({
  studentId: z.string().uuid(),
  studentName: z.string(),
  studentCode: z.string(),
  devicePolicy: z.string(),
  fromDate: z.string(),
  toDate: z.string(),
  view: z.string(),
  days: z.array(scheduleDaySchema),
});

export type ScheduleTask = z.infer<typeof scheduleTaskSchema>;
export type ScheduleDay = z.infer<typeof scheduleDaySchema>;
export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>;

export function getSchedule(
  studentId: string,
  params?: { from?: string; to?: string; view?: string },
): Promise<ScheduleResponse> {
  const search = new URLSearchParams();
  if (params?.from) search.set("from", params.from);
  if (params?.to) search.set("to", params.to);
  search.set("view", params?.view ?? "week");
  const suffix = `?${search.toString()}`;
  return getJson(
    `/students/${studentId}/schedule${suffix}`,
    scheduleResponseSchema,
  );
}

export function rescheduleTask(
  taskId: string,
  expectedVersion: number,
  targetDate: string,
  overrideReason?: string,
): Promise<void> {
  return postJson(`/tasks/${taskId}/reschedule`, z.unknown(), {
    taskId,
    expectedVersion,
    targetDate,
    overrideReason: overrideReason ?? null,
  }).then(() => undefined);
}
