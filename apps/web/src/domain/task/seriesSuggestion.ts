import {
  buildSeriesTitlePattern,
  parseSeriesTitle,
  seriesDisplayName,
  seriesNormalizedKey,
} from "./seriesTitle";

/**
 * 识别"同一学生反复手工布置同一系列"，供界面问一句要不要改成长期任务。
 * 尾号是弱信号（"真题2024" 也能解析），所以必须助教确认才转换；日期不必连续。
 */

/** 参与识别的任务行，一次"布置"一行。 */
export interface SeriesAssignmentRow {
  id: string;
  title: string;
  /** TRACK 行已在自动接排，不参与识别。 */
  sourceType: string;
  status: string;
  locked: boolean;
  scheduledDate: string | null;
  version: number;
}

export interface SeriesSuggestion {
  normalizedKey: string;
  seriesName: string;
  titlePattern: string;
  /** 连续序号的个数，即文案里的"已连续布置 N 次"。 */
  assignmentCount: number;
  latestOrdinal: number;
  nextOrdinal: number;
  /** 接受建议时原地升级的那一项。 */
  taskId: string;
  taskVersion: number;
}

export const SERIES_SUGGESTION_MIN_RUN = 4;

interface SeriesGroup {
  normalizedKey: string;
  seriesName: string;
  titlePattern: string;
  convertible: Map<number, SeriesAssignmentRow>;
  ordinals: Set<number>;
}

/** 能原地升级的前提，和 adapter 的 convertTaskToLongTask 一致。 */
function isConvertible(row: SeriesAssignmentRow): boolean {
  return (
    row.sourceType === "AD_HOC" &&
    row.status === "PENDING" &&
    !row.locked &&
    row.scheduledDate != null
  );
}

/** 末尾往前数连续序号的长度：[1,2,4,5,6] → 3。 */
function trailingRunLength(sorted: readonly number[]): number {
  let run = 1;
  for (let i = sorted.length - 1; i > 0; i -= 1) {
    if (sorted[i] - sorted[i - 1] !== 1) break;
    run += 1;
  }
  return run;
}

export function detectSeriesSuggestions(
  rows: readonly SeriesAssignmentRow[],
  options: { minRun?: number; excludeKeys?: ReadonlySet<string> } = {},
): SeriesSuggestion[] {
  const minRun = options.minRun ?? SERIES_SUGGESTION_MIN_RUN;
  const excludeKeys = options.excludeKeys ?? new Set<string>();
  const groups = new Map<string, SeriesGroup>();

  for (const row of rows) {
    if (row.sourceType === "TRACK" || row.status === "CANCELLED") continue;
    const parsed = parseSeriesTitle(row.title);
    if (!parsed) continue;
    // 纯数字标题（"2024"）没有系列名，不成系列。
    const seriesName = seriesDisplayName(parsed.prefix);
    if (seriesName.length === 0) continue;
    const normalizedKey = seriesNormalizedKey(parsed.prefix);
    if (excludeKeys.has(normalizedKey)) continue;
    // 前缀相同但后缀不同（"第3天" / "第3"）是两个系列。
    const groupKey = `${normalizedKey} ${parsed.suffix}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        normalizedKey,
        seriesName,
        titlePattern: buildSeriesTitlePattern({
          prefix: parsed.prefix,
          suffix: parsed.suffix,
        }),
        convertible: new Map(),
        ordinals: new Set(),
      };
      groups.set(groupKey, group);
    }
    group.ordinals.add(parsed.number);
    if (isConvertible(row) && !group.convertible.has(parsed.number)) {
      group.convertible.set(parsed.number, row);
    }
  }

  const suggestions: SeriesSuggestion[] = [];
  for (const group of groups.values()) {
    const sorted = [...group.ordinals].sort((a, b) => a - b);
    const assignmentCount = trailingRunLength(sorted);
    if (assignmentCount < minRun) continue;
    const latestOrdinal = sorted[sorted.length - 1];
    // 只认最大序号那一项：拿更早的一项挂轨道会和已存在的后续序号撞标题。
    const target = group.convertible.get(latestOrdinal);
    if (!target) continue;
    suggestions.push({
      normalizedKey: group.normalizedKey,
      seriesName: group.seriesName,
      titlePattern: group.titlePattern,
      assignmentCount,
      latestOrdinal,
      nextOrdinal: latestOrdinal + 1,
      taskId: target.id,
      taskVersion: target.version,
    });
  }

  return suggestions.sort(
    (a, b) =>
      b.assignmentCount - a.assignmentCount ||
      b.latestOrdinal - a.latestOrdinal ||
      a.seriesName.localeCompare(b.seriesName),
  );
}
