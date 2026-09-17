import { z } from "zod";
import { getDataAdapter } from "../../data/runtime";
import { trackSchema, type Track } from "../planning/trackApi";

/**
 * 长期任务（SEQUENCE）前端契约。定义层用户只应看到：名称、标题模板、
 * 起止序号、使用人数——模板编码 / 版本 / 发布状态是 ITEMIZED 任务模板的
 * 内部概念，不出现在长期任务里。
 */
export const longTaskSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  generationMode: z.string(),
  titlePattern: z.string(),
  defaultStartOrdinal: z.number(),
  endOrdinal: z.number().nullable(),
  defaultDurationMinutes: z.number().nullable(),
  activeTrackCount: z.number(),
  version: z.number(),
  updatedAt: z.string(),
});

export type LongTask = z.infer<typeof longTaskSchema>;

const longTaskListSchema = z.object({
  items: z.array(longTaskSchema),
  total: z.number(),
});

export function listLongTasks(query?: string): Promise<LongTask[]> {
  return getDataAdapter()
    .listLongTasks(query)
    .then((value) => longTaskListSchema.parse(value).items);
}

export function getLongTask(longTaskId: string): Promise<LongTask> {
  return getDataAdapter()
    .getLongTask(longTaskId)
    .then((value) => longTaskSchema.parse(value));
}

export function createLongTask(input: {
  sampleTitle: string;
  startOrdinal?: number;
  endOrdinal?: number | null;
  idempotencyKey?: string;
}): Promise<LongTask> {
  return getDataAdapter()
    .createLongTask({
      sampleTitle: input.sampleTitle,
      startOrdinal: input.startOrdinal ?? null,
      endOrdinal: input.endOrdinal ?? null,
      idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
    })
    .then((value) => longTaskSchema.parse(value));
}

export function updateLongTask(
  longTaskId: string,
  input: {
    sampleTitle: string;
    startOrdinal?: number;
    endOrdinal?: number | null;
    defaultDurationMinutes?: number | null;
  },
): Promise<LongTask> {
  return getDataAdapter()
    .updateLongTask(longTaskId, {
      sampleTitle: input.sampleTitle,
      startOrdinal: input.startOrdinal ?? null,
      endOrdinal: input.endOrdinal ?? null,
      defaultDurationMinutes: input.defaultDurationMinutes ?? null,
    })
    .then((value) => longTaskSchema.parse(value));
}

const deleteLongTaskResultSchema = z.object({
  mode: z.enum(["DELETED", "ARCHIVED"]),
  trackCount: z.number(),
});

export type DeleteLongTaskResult = z.infer<typeof deleteLongTaskResultSchema>;

/** 删除长期任务；被学生挂载过时后端退化为归档，结果里带 mode 说明。 */
export function deleteLongTask(
  longTaskId: string,
): Promise<DeleteLongTaskResult> {
  return getDataAdapter()
    .deleteLongTask(longTaskId)
    .then((value) => deleteLongTaskResultSchema.parse(value));
}

export function mountLongTask(input: {
  studentId: string;
  longTaskId: string;
  currentOrdinal?: number;
  anchorDate?: string;
}): Promise<Track> {
  const idempotencyKey = crypto.randomUUID();
  return getDataAdapter()
    .mountLongTask({
      studentId: input.studentId,
      longTaskId: input.longTaskId,
      currentOrdinal: input.currentOrdinal ?? null,
      anchorDate: input.anchorDate ?? null,
      idempotencyKey,
    })
    .then((value) => trackSchema.parse(value));
}

const convertResultSchema = z.object({
  taskId: z.string().uuid(),
  trackId: z.string().uuid(),
  ordinal: z.number(),
  definitionCreated: z.boolean(),
  track: trackSchema,
});

export type ConvertToLongTaskResult = z.infer<typeof convertResultSchema>;

/** 把一个待办的普通任务原地升级为长期任务轨道的当前项。 */
export function convertTaskToLongTask(
  taskId: string,
  input: { expectedVersion?: number },
): Promise<ConvertToLongTaskResult> {
  return getDataAdapter()
    .convertTaskToLongTask(taskId, {
      taskId,
      expectedVersion: input.expectedVersion ?? null,
      idempotencyKey: crypto.randomUUID(),
    })
    .then((value) => convertResultSchema.parse(value));
}
