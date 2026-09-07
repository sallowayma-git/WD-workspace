import { z } from "zod";
import { getDataAdapter } from "../../data/runtime";
import {
  taskCardContractFields,
  taskViewSchema,
} from "../tasks/taskViewSchema";

// The local adapter's taskSummary emits the TaskCard contract columns; they
// stay optional so a payload without them still parses (D2 wiring — shared
// shape in taskCardContractFields), and toTaskLike passes each value through
// instead of hardcoding it (so star/priority reflect adapter state when
// present). status is narrowed to the calendar's five known statuses.
const scheduleTaskSchema = taskViewSchema
  .pick({
    id: true,
    title: true,
    shortTitle: true,
    status: true,
    sourceType: true,
    itemOrdinal: true,
    durationMinutes: true,
    locked: true,
    version: true,
    carriedOver: true,
    carriedFromDate: true,
    parentTaskId: true,
    linkedParentTaskId: true,
    priority: true,
    sortOrder: true,
    star: true,
  })
  .extend({
    status: z.enum([
      "PENDING",
      "COMPLETED",
      "CARRIED_OVER",
      "BLOCKED",
      "CANCELLED",
    ]),
    ...taskCardContractFields,
    note: taskViewSchema.shape.note.optional(),
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
  return getDataAdapter()
    .getSchedule(studentId, params)
    .then((value) => scheduleResponseSchema.parse(value));
}

export function rescheduleTask(
  taskId: string,
  expectedVersion: number,
  targetDate: string,
  overrideReason?: string,
  targetStudentId?: string,
): Promise<void> {
  return getDataAdapter()
    .rescheduleTask({
      taskId,
      expectedVersion,
      targetDate,
      overrideReason: overrideReason ?? null,
      targetStudentId: targetStudentId ?? null,
    })
    .then(() => undefined);
}
