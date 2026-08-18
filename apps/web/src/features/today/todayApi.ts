import { z } from "zod";
import { getJson, postJson } from "../../lib/api/http";

const todayTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  shortTitle: z.string().nullable(),
  status: z.string(),
  sourceType: z.string(),
  itemOrdinal: z.number().nullable(),
  durationMinutes: z.number().nullable(),
  locked: z.boolean(),
  carriedOver: z.boolean(),
  scheduledDate: z.string().nullable(),
  version: z.number(),
  // Shared TaskCard contract (D2 wiring). The backend TodayTaskSummary does
  // not yet emit these columns; they are optional so the field stays undefined
  // when absent, and the page falls back to the existing flat list behavior.
  parentTaskId: z.string().uuid().nullable().optional(),
  linkedParentTaskId: z.string().uuid().nullable().optional(),
  priority: z.string().nullable().optional(),
  sortOrder: z.number().nullable().optional(),
  star: z.boolean().nullable().optional(),
});

const todayStudentGroupSchema = z.object({
  studentId: z.string().uuid(),
  studentName: z.string(),
  studentCode: z.string(),
  devicePolicy: z.string(),
  tasks: z.array(todayTaskSchema),
});

const todayMetricsSchema = z.object({
  totalStudents: z.number(),
  totalPendingTasks: z.number(),
  totalCompletedTasks: z.number(),
  carriedOverTasks: z.number(),
  blockedTasks: z.number(),
  conflictCount: z.number(),
});

const todayResponseSchema = z.object({
  businessDate: z.string(),
  metrics: todayMetricsSchema,
  students: z.array(todayStudentGroupSchema),
});

export type TodayTask = z.infer<typeof todayTaskSchema>;
export type TodayStudentGroup = z.infer<typeof todayStudentGroupSchema>;
export type TodayMetrics = z.infer<typeof todayMetricsSchema>;
export type TodayResponse = z.infer<typeof todayResponseSchema>;

const carryOverItemSchema = z.object({
  sourceTaskId: z.string().uuid(),
  targetTaskId: z.string().uuid().nullable(),
  studentId: z.string().uuid(),
  studentName: z.string(),
  originalDate: z.string().nullable(),
  targetDate: z.string().nullable(),
  title: z.string(),
  reason: z.string().nullable(),
  scheduleOrigin: z.string().nullable(),
  executedAt: z.string().nullable(),
  version: z.number(),
});

export type CarryOverItem = z.infer<typeof carryOverItemSchema>;

export function getTodayCarryovers(
  targetDate: string,
): Promise<CarryOverItem[]> {
  const params = new URLSearchParams();
  params.set("targetDate", targetDate);
  return getJson(
    `/today/carryovers?${params.toString()}`,
    z.array(carryOverItemSchema),
  );
}

export function getToday(date?: string): Promise<TodayResponse> {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  const suffix = params.size === 0 ? "" : `?${params.toString()}`;
  return getJson(`/today${suffix}`, todayResponseSchema);
}

export function completeTask(
  taskId: string,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<unknown> {
  return postJson(`/tasks/${taskId}/complete`, z.unknown(), {
    taskId,
    expectedVersion,
    idempotencyKey,
  });
}

const undoCarryOverResultSchema = z.object({
  sourceTaskId: z.string().uuid(),
  targetTaskId: z.string().uuid().nullable(),
  sourceStatus: z.string(),
  targetStatus: z.string(),
  reason: z.string(),
});

export type UndoCarryOverResult = z.infer<typeof undoCarryOverResultSchema>;

export function undoCarryover(
  taskId: string,
  sourceTaskId: string,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<UndoCarryOverResult> {
  return postJson(`/tasks/${taskId}/undo-carryover`, undoCarryOverResultSchema, {
    sourceTaskId,
    expectedVersion,
    idempotencyKey,
  });
}

export function reopenTask(
  taskId: string,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<void> {
  return postJson(`/tasks/${taskId}/reopen`, z.unknown(), {
    taskId,
    expectedVersion,
    idempotencyKey,
  }).then(() => undefined);
}
