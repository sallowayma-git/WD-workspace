import { z } from "zod";
import { getDataAdapter } from "../../data/runtime";

const trackProgressSchema = z.object({
  currentOrdinal: z.number(),
  // 开放型长期任务没有结束序号：end/total/percent 为 null，UI 隐藏百分比。
  endOrdinal: z.number().nullable(),
  completedUnits: z.number(),
  totalUnits: z.number().nullable(),
  percent: z.number().nullable(),
});

const trackSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  templateId: z.string().uuid(),
  // SEQUENCE 长期任务轨道不绑定模板版本。
  templateVersionId: z.string().uuid().nullable(),
  generationMode: z.string(),
  definitionName: z.string().nullable(),
  titlePatternSnapshot: z.string().nullable(),
  status: z.enum(["NOT_STARTED", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]),
  startOrdinal: z.number(),
  currentOrdinal: z.number(),
  endOrdinal: z.number().nullable(),
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
// 长期任务挂载结果复用同一份轨道契约，schema 一并导出避免复制。
export { trackSchema };

export function listStudentTracks(
  studentId: string,
  status?: string,
): Promise<Track[]> {
  return getDataAdapter()
    .listStudentTracks(studentId, status)
    .then((value) => z.array(trackSchema).parse(value));
}

export function getTrack(trackId: string): Promise<Track> {
  return getDataAdapter()
    .getTrack(trackId)
    .then((value) => trackSchema.parse(value));
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
}): Promise<Track> {
  const idempotencyKey = crypto.randomUUID();
  return getDataAdapter()
    .mountTrack({
      studentId: input.studentId,
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
    })
    .then((value) => trackSchema.parse(value));
}

export function resumeSequenceTrack(
  trackId: string,
  expectedVersion: number,
): Promise<Track> {
  return getDataAdapter()
    .resumeSequenceTrack(trackId, {
      expectedVersion,
      idempotencyKey: crypto.randomUUID(),
    })
    .then((value) => trackSchema.parse(value));
}
