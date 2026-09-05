/**
 * 任务标题尾部序号的解析与生成，支撑“一天一句长难句day1 → day2”这类
 * 系列任务的推进：完成一项后点“下一项”，新任务自动接续序号并排到下一天。
 *
 * 识别规则刻意保持宽松——只看标题末尾的连续数字，数字后允许一个“天”字：
 *   "一天一句长难句1"    → prefix "一天一句长难句", number 1, suffix ""
 *   "一天一句长难句day1"  → prefix "一天一句长难句day", number 1, suffix ""
 *   "长难句 第3天"        → prefix "长难句 第", number 3, suffix "天"
 *   "真题2024"           → prefix "真题", number 2024, suffix ""
 * 不以数字结尾的标题（"背单词"）解析为 null，调用方退化为普通复制。
 */
export interface SeriesTitle {
  prefix: string;
  number: number;
  /** 原始数字串；生成下一个序号时用于保留前导零宽度（010 → 011）。 */
  digits: string;
  suffix: string;
}

const SERIES_TITLE_PATTERN = /^(.*?)(\d+)(天)?\s*$/;

export function parseSeriesTitle(title: string): SeriesTitle | null {
  const match = SERIES_TITLE_PATTERN.exec(title.trim());
  if (!match) return null;
  return {
    prefix: match[1],
    number: Number(match[2]),
    digits: match[2],
    suffix: match[3] ?? "",
  };
}

/** 同一系列的判定键：去掉尾部数字后前缀与后缀都一致才算同一系列。 */
export function isSameSeries(a: SeriesTitle, b: SeriesTitle): boolean {
  return a.prefix === b.prefix && a.suffix === b.suffix;
}

/** 用新序号还原标题；原数字带前导零时按原宽度补齐。 */
export function formatSeriesTitle(parts: SeriesTitle, number: number): string {
  const digits = String(number).padStart(parts.digits.length, "0");
  return `${parts.prefix}${digits}${parts.suffix}`;
}

/**
 * 长期任务（SEQUENCE track）的标题模板：同一系列在完成时由轨道按模板渲染
 * 下一项，而不是预先把每一项存成任务。模板固定为"前缀 + {n} + 后缀"，
 * 例如 "一天一句长难句 Day {n}"、"长难句 第{n}天"、"密卷{n}"。
 */
export function buildSeriesTitlePattern(parts: {
  prefix: string;
  suffix: string;
}): string {
  return `${parts.prefix}{n}${parts.suffix}`;
}

/** 无尾部数字的标题按"标题 + 空格 + {n}"成模板："一天一句长难句" → "一天一句长难句 {n}"。 */
export function buildPlainTitlePattern(title: string): string {
  const trimmed = title.trim();
  return `${trimmed} {n}`;
}

/** 用序号渲染模板；模板必须恰好含一个 {n} 占位符。 */
export function renderSeriesTitlePattern(
  pattern: string,
  ordinal: number,
): string {
  if (ordinal < 1) {
    throw new Error(`sequence ordinal must be >= 1, got ${ordinal}`);
  }
  const occurrences = pattern.split("{n}").length - 1;
  if (occurrences !== 1) {
    throw new Error(`title pattern must contain exactly one {{n}}: ${pattern}`);
  }
  return pattern.replace("{n}", String(ordinal));
}

/**
 * 长期任务定义的归一化键：NFKC 折叠全角/半角，压平空白并转小写。
 * 用于"同一个学生反复布置同一系列"的识别与 find-or-create——刻意不做
 * 去标点/拼音/模糊匹配，避免误判。
 */
export function seriesNormalizedKey(input: string): string {
  return input.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
