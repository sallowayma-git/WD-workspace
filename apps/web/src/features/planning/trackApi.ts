import { z } from "zod";
import { getJson, postJson } from "../../lib/api/http";

const trackProgressSchema = z.object({
  currentOrdinal: z.number(),
  endOrdinal: z.number(),
  completedUnits: z.number(),
  totalUnits: z.number(),
  percent: z.number(),
});

const trackSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  templateId: z.string().uuid(),
  templateVersionId: z.string().uuid(),
  status: z.enum(["NOT_STARTED", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]),
  startOrdinal: z.number(),
  currentOrdinal: z.number(),
  endOrdinal: z.number(),
  defaultUnitsPerSession: z.number(),
  startDate: z.string(),
  nextCandidateDate: z.string().nullable(),
  priority: z.number(),
  allowParallelItems: z.boolean(),
  schedulingPolicy: z.string(),
  durationOverrideMinutes: z.number().nullable(),
  devicePolicyOverride: z.string().nullable(),
  note: z.string().nullable(),
  completedAt: z.string().nullable(),
  version: z.number(),
  updatedAt: z.string(),
  progress: trackProgressSchema.nullable(),
  warnings: z.array(z.string()),
});

export type Track = z.infer<typeof trackSchema>;
export type TrackProgress = z.infer<typeof trackProgressSchema>;

export function listStudentTracks(
  studentId: string,
  status?: string,
): Promise<Track[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const suffix = params.size === 0 ? "" : `?${params.toString()}`;
  return getJson(
    `/students/${studentId}/tracks${suffix}`,
    z.array(trackSchema),
  );
}

export function getTrack(trackId: string): Promise<Track> {
  return getJson(`/tracks/${trackId}`, trackSchema);
}

export function mountTrack(input: {
  studentId: string;
  templateId: string;
  templateVersionId: string;
  startOrdinal: number;
  endOrdinal: number;
  startDate: string;
  defaultUnitsPerSession?: number;
  priority?: number;
  schedulingPolicy?: string;
  note?: string;
  createFirstInstance?: boolean;
  confirmOverride?: boolean;
}): Promise<Track> {
  const idempotencyKey = crypto.randomUUID();
  return postJson(`/students/${input.studentId}/tracks`, trackSchema, {
    idempotencyKey,
    templateId: input.templateId,
    templateVersionId: input.templateVersionId,
    startOrdinal: input.startOrdinal,
    endOrdinal: input.endOrdinal,
    startDate: input.startDate,
    defaultUnitsPerSession: input.defaultUnitsPerSession ?? 1,
    priority: input.priority ?? 50,
    schedulingPolicy: input.schedulingPolicy ?? "MANUAL",
    durationOverrideMinutes: null,
    devicePolicyOverride: null,
    note: input.note ?? null,
    createFirstInstance: input.createFirstInstance ?? false,
    confirmOverride: input.confirmOverride ?? false,
  });
}
