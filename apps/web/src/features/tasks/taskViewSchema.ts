import { z } from "zod";

// Single source of truth for the zod description of a task_instance row
// (audit 2026-08-27 §4.6 MINOR-10: the same row previously had four
// hand-maintained schemas — features/tasks/taskApi.ts taskSchema,
// features/today/taskApi.ts adHocTaskSchema, features/schedule/scheduleApi.ts
// scheduleTaskSchema and features/workbench/workbenchApi.ts
// taskSummarySchema — so new columns like priority/sortOrder/star/
// carriedFromDate had to be patched into each copy). Every view schema
// derives from this base via .pick()/.omit()/.extend(); add new columns here.
//
// The base is a field vocabulary, never parsed directly. It carries both
// naming families of the task projections:
//   - row views (tasks, today) read the raw snapshot column names
//     (titleSnapshot, durationMinutesSnapshot, ...);
//   - summary views (schedule, workbench) read the flattened TaskCard names
//     (title, shortTitle, durationMinutes, carriedOver).
// Each shared name is declared once at its strictest shape (required; nullable
// only where a row can be null). A view that accepts less relaxes fields
// explicitly in its own .extend(), so every loosening stays a visible local
// decision instead of silent drift.
export const taskViewSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid().nullable(),
  sourceType: z.string(),
  trackId: z.string().uuid().nullable(),
  templateVersionId: z.string().uuid().nullable(),
  templateItemId: z.string().uuid().nullable(),
  itemOrdinal: z.number().nullable(),
  scheduledDate: z.string().nullable(),
  originalScheduledDate: z.string().nullable(),
  status: z.string(),
  titleSnapshot: z.string().nullable(),
  shortTitleSnapshot: z.string().nullable(),
  // Flattened TaskCard projection names used by the schedule/workbench
  // summaries in place of the *Snapshot row columns above.
  title: z.string(),
  shortTitle: z.string().nullable(),
  durationMinutes: z.number().nullable(),
  durationMinutesSnapshot: z.number().nullable(),
  requiresDeviceSnapshot: z.boolean().nullable(),
  scheduleOrigin: z.string().nullable(),
  manualOverride: z.boolean().nullable(),
  overrideReason: z.string().nullable(),
  locked: z.boolean(),
  note: z.string().nullable(),
  carriedFromInstanceId: z.string().uuid().nullable(),
  carriedToInstanceId: z.string().uuid().nullable(),
  // ACC-074: a CARRIED_OVER source row must stay distinguishable from a live
  // PENDING task in the calendar. Without this field zod stripped the flag and
  // history rendered as an actionable to-do.
  carriedOver: z.boolean().nullable().optional(),
  // DLY-022: the original date this row was carried from — surfaced so the
  // TaskCard 顺延 badge can tooltip "由 YYYY-MM-DD 顺延".
  carriedFromDate: z.string().nullable().optional(),
  completedAt: z.string().nullable(),
  completedBy: z.string().uuid().nullable(),
  cancelledAt: z.string().nullable(),
  cancelledBy: z.string().uuid().nullable(),
  parentTaskId: z.string().uuid().nullable(),
  linkedParentTaskId: z.string().uuid().nullable(),
  priority: z.string().nullable(),
  sortOrder: z.number().nullable(),
  star: z.boolean().nullable(),
  version: z.number(),
  updatedAt: z.string().nullable(),
});

// Shared TaskCard contract (D2 wiring): the summary-projection shape of the
// five task_instance columns the TaskCard consumes. Summary endpoints may
// omit them, so they are nullable + optional — a payload without them still
// parses, and toTaskLike passes each value through instead of hardcoding it
// (so star/priority reflect adapter state when present).
export const taskCardContractFields = {
  parentTaskId: z.string().uuid().nullable().optional(),
  linkedParentTaskId: z.string().uuid().nullable().optional(),
  priority: z.string().nullable().optional(),
  sortOrder: z.number().nullable().optional(),
  star: z.boolean().nullable().optional(),
} satisfies z.ZodRawShape;
