import { z } from "zod";
import { getDataAdapter } from "../../data/runtime";
import { taskViewSchema } from "../tasks/taskViewSchema";

// An ad-hoc creation returns the task row itself: no TaskCard link/priority
// columns (omitted below), and studentId/titleSnapshot are guaranteed
// non-null for a freshly created AD_HOC row, so they are tightened here.
// manualOverride/updatedAt deliberately take the shared nullable shape of
// taskViewSchema (unified to the taskSchema 口径 per audit MINOR-10): the
// local adapter's row mapping (sqliteLocalDataAdapter.getTaskView, fed by an
// INSERT that writes manual_override = 0 and updated_at = now) always returns
// concrete values for both, so the looser shape cannot admit bad data.
const adHocTaskSchema = taskViewSchema
  .omit({
    title: true,
    shortTitle: true,
    durationMinutes: true,
    carriedOver: true,
    parentTaskId: true,
    linkedParentTaskId: true,
    priority: true,
    sortOrder: true,
    star: true,
  })
  .extend({
    studentId: z.string().uuid(),
    titleSnapshot: z.string(),
  });

export type AdHocTask = z.infer<typeof adHocTaskSchema>;

// Idempotency contract (2026-08-29 audit, decided): the adapter records
// (idempotencyKey → taskId) and replays the FULL task view when the same key
// is submitted twice — that dedup protects direct adapter callers which hold
// a stable key (tests, scripts, a future offline queue). The UI deliberately
// generates a fresh key per submission: this is a single-user local app where
// the realistic duplicate vector is a double click (already blocked by the
// composer's pending state), and a payload-derived stable key would silently
// swallow a second intentionally created same-titled task. BR-012 governs
// complete/carryover/mount commands; it is not extended to creation.
const createAdHocTaskRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  studentId: z.string().uuid(),
  scheduledDate: z.string(),
  title: z.string().min(1).max(500),
  durationMinutes: z.number().int().min(1).max(1440).nullish(),
  requiresDevice: z.boolean().nullish(),
  locked: z.boolean().nullish(),
  note: z.string().nullish(),
});

export type CreateAdHocTaskRequest = z.infer<
  typeof createAdHocTaskRequestSchema
>;

export function createAdHocTask(
  input: Omit<CreateAdHocTaskRequest, "idempotencyKey">,
): Promise<AdHocTask> {
  const payload = createAdHocTaskRequestSchema.parse({
    ...input,
    idempotencyKey: crypto.randomUUID(),
  });
  return getDataAdapter()
    .createAdHocTask(payload)
    .then((value) => adHocTaskSchema.parse(value));
}
