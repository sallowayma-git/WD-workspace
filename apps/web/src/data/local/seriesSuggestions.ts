//! 系列建议：识别可能成为长期任务的手工任务，并记住助教点过的"暂不"。

import type { LocalCore } from "./localCore";
import {
  detectSeriesSuggestions,
  type SeriesAssignmentRow,
} from "../../domain/task/seriesSuggestion";
import {
  bool,
  nullableText,
  numberValue,
  requiredString,
  text,
  type DbRow,
} from "./rows";

/** 每个学生一行，值是被"暂不"的归一化系列键 JSON 数组。 */
function dismissedSeriesSettingKey(studentId: string): string {
  return `series.suggestion.dismissed:${studentId}`;
}

// 系列建议：只识别 + 记住"暂不"，真正的转换仍走 convertTaskToLongTask。
export async function listSeriesSuggestions(
  core: LocalCore,
  studentId: string,
): Promise<unknown> {
  await core.studentRow(studentId);
  const rows = await core.storage.select<DbRow>(
    `SELECT id, title_snapshot, source_type, status, locked,
            scheduled_date, version
       FROM task_instance
      WHERE student_id = $1 AND source_type <> 'TRACK'
        AND status <> 'CANCELLED'
      ORDER BY scheduled_date DESC LIMIT 2000`,
    [studentId],
  );
  const assignments: SeriesAssignmentRow[] = rows.map((row) => ({
    id: text(row, "id"),
    title: text(row, "title_snapshot"),
    sourceType: text(row, "source_type"),
    status: text(row, "status"),
    locked: bool(row, "locked"),
    scheduledDate: nullableText(row, "scheduled_date"),
    version: numberValue(row, "version"),
  }));
  const excludeKeys = new Set([
    ...(await automatedSeriesKeys(core, studentId)),
    ...(await dismissedSeriesKeys(core, studentId)),
  ]);
  return { items: detectSeriesSuggestions(assignments, { excludeKeys }) };
}

export async function dismissSeriesSuggestion(
  core: LocalCore,
  studentId: string,
  input: Record<string, unknown>,
): Promise<void> {
  const normalizedKey = requiredString(input, "normalizedKey");
  const dismissed = await dismissedSeriesKeys(core, studentId);
  if (dismissed.includes(normalizedKey)) return;
  await core.putSetting(
    dismissedSeriesSettingKey(studentId),
    JSON.stringify([...dismissed, normalizedKey]),
  );
}

/** 已挂在长期任务轨道上的系列不再建议。 */
async function automatedSeriesKeys(
  core: LocalCore,
  studentId: string,
): Promise<string[]> {
  const rows = await core.storage.select<DbRow>(
    `SELECT t.normalized_key AS normalized_key
       FROM student_task_track stt
       JOIN task_template t ON t.id = stt.template_id
      WHERE stt.student_id = $1 AND stt.generation_mode = 'SEQUENCE'
        AND stt.status IN ('NOT_STARTED', 'ACTIVE', 'PAUSED')`,
    [studentId],
  );
  return rows
    .map((row) => nullableText(row, "normalized_key"))
    .filter((key): key is string => key != null);
}

async function dismissedSeriesKeys(
  core: LocalCore,
  studentId: string,
): Promise<string[]> {
  const raw = await core.settingValue(dismissedSeriesSettingKey(studentId));
  if (raw == null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    // 设置值损坏时当作没有"暂不"，宁可多问一次也不让建议永久静音。
    return [];
  }
}
