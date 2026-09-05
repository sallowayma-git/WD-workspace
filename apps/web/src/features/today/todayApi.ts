import { z } from "zod";
import { getDataAdapter } from "../../data/runtime";
import {
  taskCardContractFields,
  taskViewSchema,
} from "../tasks/taskViewSchema";

// Derived from the taskViewSchema base, same pattern as the schedule/workbench
// summaries: TodayTask is the TaskCard summary projection of a task_instance
// row for the Today page. carriedOver is tightened back to a required boolean
// (the base carries it nullable+optional for looser summary views) because the
// adapter's taskSummary always computes a concrete boolean
// (status === "CARRIED_OVER") and TodayPage's toTaskLike hands it to
// TaskLike.carriedOver (boolean | undefined, no null) — the strict shape keeps
// parse behavior identical to the previous hand-maintained copy.
const todayTaskSchema = taskViewSchema
  .pick({
    id: true,
    title: true,
    shortTitle: true,
    status: true,
    sourceType: true,
    itemOrdinal: true,
    durationMinutes: true,
    locked: true,
    carriedOver: true,
    // DLY-022: original date this row was carried from — drives the TaskCard
    // 顺延 tooltip when present.
    carriedFromDate: true,
    scheduledDate: true,
    version: true,
    parentTaskId: true,
    linkedParentTaskId: true,
    priority: true,
    sortOrder: true,
    star: true,
  })
  .extend({
    carriedOver: z.boolean(),
    // Shared TaskCard contract (D2 wiring). The backend TodayTaskSummary does
    // not yet emit these columns; they are optional so the field stays
    // undefined when absent, and the page falls back to the existing flat
    // list behavior.
    ...taskCardContractFields,
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
  return getDataAdapter()
    .getTodayCarryovers(targetDate)
    .then((value) => z.array(carryOverItemSchema).parse(value));
}

export function getToday(date?: string): Promise<TodayResponse> {
  return getDataAdapter()
    .getToday(date)
    .then((value) => todayResponseSchema.parse(value));
}

export function completeTask(
  taskId: string,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<unknown> {
  return getDataAdapter().completeTask({
    taskId,
    expectedVersion,
    idempotencyKey,
  });
}

const carryForwardResultSchema = z.object({
  sourceTaskId: z.string().uuid(),
  targetTaskId: z.string().uuid().nullable(),
  targetDate: z.string().nullable(),
  status: z.string(),
  reason: z.string().nullable(),
});

export type CarryForwardResult = z.infer<typeof carryForwardResultSchema>;

export function carryForwardTask(
  sourceTaskId: string,
  targetDate?: string,
  reason?: string,
): Promise<CarryForwardResult> {
  return getDataAdapter()
    .carryForwardTask({
      sourceTaskId,
      targetDate: targetDate ?? null,
      reason: reason ?? null,
    })
    .then((value) => carryForwardResultSchema.parse(value));
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
  return getDataAdapter()
    .undoCarryover({
      taskId,
      sourceTaskId,
      expectedVersion,
      idempotencyKey,
    })
    .then((value) => undoCarryOverResultSchema.parse(value));
}

export function reopenTask(
  taskId: string,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<void> {
  return getDataAdapter()
    .reopenTask({ taskId, expectedVersion, idempotencyKey })
    .then(() => undefined);
}
