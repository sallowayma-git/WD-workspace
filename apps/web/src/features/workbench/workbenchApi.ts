import { z } from "zod";
import { getDataAdapter } from "../../data/runtime";
import {
  taskCardContractFields,
  taskViewSchema,
} from "../tasks/taskViewSchema";

// Shared TaskCard contract (D2 wiring). The backend WorkbenchTaskSummary only
// emits the four fields above (id/shortTitle/status/version); the rest are
// optional so the page can adapt the summary into a TaskLike without a
// backend change.
const taskSummarySchema = taskViewSchema
  .pick({
    id: true,
    shortTitle: true,
    status: true,
    version: true,
    title: true,
    sourceType: true,
    trackId: true,
    itemOrdinal: true,
    durationMinutes: true,
    locked: true,
    carriedOver: true,
    scheduledDate: true,
    carriedFromDate: true,
    parentTaskId: true,
    linkedParentTaskId: true,
    priority: true,
    sortOrder: true,
    star: true,
  })
  .extend({
    title: z.string().nullable().optional(),
    sourceType: z.string().nullable().optional(),
    trackId: z.string().uuid().nullable().optional(),
    itemOrdinal: z.number().nullable().optional(),
    durationMinutes: z.number().nullable().optional(),
    locked: z.boolean().nullable().optional(),
    scheduledDate: z.string().nullable().optional(),
    ...taskCardContractFields,
    note: taskViewSchema.shape.note.optional(),
  });

const dayCellSchema = z.object({
  date: z.string(),
  available: z.boolean(),
  availableMinutes: z.number(),
  availabilitySource: z
    .enum(["DATE_OVERRIDE", "WEEKLY_PATTERN", "DEFAULT"])
    .optional(),
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
  classType: z.string().nullable().optional(),
  examDate: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  statusLabel: z
    .object({
      id: z.string().uuid(),
      label: z.string(),
      color: z.string().nullable(),
    })
    .nullable()
    .optional(),
  note: z.string().nullable().optional(),
  version: z.number().optional(),
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
  return getDataAdapter()
    .getWorkbench(from, to)
    .then((value) => workbenchResponseSchema.parse(value));
}
