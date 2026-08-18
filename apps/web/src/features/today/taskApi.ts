import { z } from "zod";
import { postJson } from "../../lib/api/http";

const adHocTaskSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  sourceType: z.string(),
  trackId: z.string().uuid().nullable(),
  templateVersionId: z.string().uuid().nullable(),
  templateItemId: z.string().uuid().nullable(),
  itemOrdinal: z.number().nullable(),
  scheduledDate: z.string().nullable(),
  originalScheduledDate: z.string().nullable(),
  status: z.string(),
  titleSnapshot: z.string(),
  shortTitleSnapshot: z.string().nullable(),
  durationMinutesSnapshot: z.number().nullable(),
  requiresDeviceSnapshot: z.boolean().nullable(),
  scheduleOrigin: z.string().nullable(),
  manualOverride: z.boolean(),
  overrideReason: z.string().nullable(),
  locked: z.boolean(),
  note: z.string().nullable(),
  carriedFromInstanceId: z.string().uuid().nullable(),
  carriedToInstanceId: z.string().uuid().nullable(),
  completedAt: z.string().nullable(),
  completedBy: z.string().uuid().nullable(),
  cancelledAt: z.string().nullable(),
  cancelledBy: z.string().uuid().nullable(),
  version: z.number(),
  updatedAt: z.string(),
});

export type AdHocTask = z.infer<typeof adHocTaskSchema>;

// BR-012: ad-hoc task creation must be idempotent under retry. The key is
// generated client-side and sent alongside the command body; the backend
// deduplicates repeated submissions sharing the same key.
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
  return postJson(`/tasks`, adHocTaskSchema, payload);
}
