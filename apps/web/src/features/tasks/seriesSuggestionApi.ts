import { z } from "zod";
import { getDataAdapter } from "../../data/runtime";

/**
 * 系列建议：助教反复手工布置同一系列时问一句要不要改成长期任务。
 * 识别在 domain/task/seriesSuggestion.ts，这里只做契约校验。
 */
export const seriesSuggestionSchema = z.object({
  normalizedKey: z.string(),
  seriesName: z.string(),
  titlePattern: z.string(),
  assignmentCount: z.number(),
  latestOrdinal: z.number(),
  nextOrdinal: z.number(),
  taskId: z.string().uuid(),
  taskVersion: z.number(),
});

export type SeriesSuggestion = z.infer<typeof seriesSuggestionSchema>;

const seriesSuggestionListSchema = z.object({
  items: z.array(seriesSuggestionSchema),
});

export function listSeriesSuggestions(
  studentId: string,
): Promise<SeriesSuggestion[]> {
  return getDataAdapter()
    .listSeriesSuggestions(studentId)
    .then((value) => seriesSuggestionListSchema.parse(value).items);
}

/** "暂不"：按归一化键记住，同一学生的这个系列不再问。 */
export function dismissSeriesSuggestion(
  studentId: string,
  normalizedKey: string,
): Promise<void> {
  return getDataAdapter().dismissSeriesSuggestion(studentId, { normalizedKey });
}
