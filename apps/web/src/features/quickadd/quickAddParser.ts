// 全局快速添加的输入解析：把"林同学 明天 密卷08 阅读"这类自由文本拆成
// 学生 + 日期 + 任务标题三段。匹配规则是确定性的（正则 + 名册包含匹配），
// 不做任何模糊猜测，匹配不到的字段由 UI 用默认值（今天）或提示兜底。

export interface QuickAddStudent {
  id: string;
  name: string;
  alias: string | null;
  studentCode: string;
}

export interface StudentCandidate {
  student: QuickAddStudent;
  /** 命中的名册字段原文（姓名/别名/编号）。 */
  token: string;
  /** 命中片段长度，用于"最长匹配优先"。 */
  length: number;
  /** 命中片段在输入中的起始位置。 */
  index: number;
}

export interface QuickAddMatch {
  /** 全部命中的学生候选，按命中片段长度降序。 */
  students: StudentCandidate[];
  student: QuickAddStudent | null;
  /** 解析出的日期（YYYY-MM-DD）；输入未包含日期时为 null。 */
  date: string | null;
  /** 输入中命中的日期原文（如"明天"、"9月1日"）。 */
  dateLabel: string | null;
  /** 去掉学生与日期片段后剩余的任务内容。 */
  title: string;
}

interface DateTokenHit {
  start: number;
  end: number;
  label: string;
  date: string;
}

const RELATIVE_DAYS: Record<string, number> = {
  大后天: 3,
  后天: 2,
  明天: 1,
  今天: 0,
};

const WEEKDAY_INDEX: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
};

const CN_DIGIT: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

// 周X 的正则把"下下周"放在前面保证最长优先；星期/周两种叫法都支持。
const WEEKDAY_PATTERN = /(下下周|下周|星期|周)([一二三四五六日天])/g;
const ISO_PATTERN = /(\d{4})-(\d{1,2})-(\d{1,2})/g;
const MONTH_DAY_PATTERN = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/g;
// 滴答清单式简写：0831 → 8月31日。前后不能紧贴其他数字（10831 不会被
// 读成 831）；任务标题里恰好出现四位月日仍会被匹配，双击胶囊可去除。
const DIGIT_MMDD_PATTERN = /(?<!\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/g;
// 中文数字日期：八月三十一（日）、八月1、十一月二十号。
const CN_MONTH_DAY_PATTERN =
  /(十[一二]|十|[一二三四五六七八九])月\s*(三十一|三十|二十[一二三四五六七八九]|二十|十[一二三四五六七八九]|十|[一二三四五六七八九]|\d{1,2})\s*[日号]?/g;
// 2026-08-30 已被 ISO 吃掉；这条只兜 "8-31" 简写。
const SHORT_DATE_PATTERN = /(\d{1,2})-(\d{1,2})/g;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** JS Date 会把 2月30日 静默进位，round-trip 不一致即无效日历日。 */
function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function shiftDate(value: string, days: number): string {
  const date = parseDateKey(value);
  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}

/** 中文数字日（含"二十/二十一/三十一"组合与 1-2 位阿拉伯数字）转 1-31。 */
function parseCnDay(day: string): number {
  if (/^\d{1,2}$/.test(day)) return Number(day);
  if (day === "十") return 10;
  if (day.startsWith("十")) return 10 + (CN_DIGIT[day[1]] ?? 0);
  if (day.endsWith("十")) return (CN_DIGIT[day[0]] ?? 0) * 10;
  if (day.includes("十")) {
    return (CN_DIGIT[day[0]] ?? 0) * 10 + (CN_DIGIT[day[2]] ?? 0);
  }
  return CN_DIGIT[day] ?? 0;
}

function parseCnMonth(month: string): number {
  if (month === "十") return 10;
  if (month.startsWith("十")) return 10 + (CN_DIGIT[month[1]] ?? 0);
  return CN_DIGIT[month] ?? 0;
}

interface ResolvedDateHit {
  date: string | null;
  /** 胶囊展示文案；缺省时保留输入原文。 */
  label?: string;
}

function collectMatches(
  text: string,
  pattern: RegExp,
  resolve: (match: RegExpExecArray) => ResolvedDateHit | null,
): DateTokenHit[] {
  const hits: DateTokenHit[] = [];
  pattern.lastIndex = 0;
  for (
    let match = pattern.exec(text);
    match != null;
    match = pattern.exec(text)
  ) {
    const resolved = resolve(match);
    if (resolved?.date != null) {
      hits.push({
        start: match.index,
        end: match.index + match[0].length,
        label: resolved.label ?? match[0],
        date: resolved.date,
      });
    }
  }
  return hits;
}

/**
 * 扫描输入里的第一个日期片段。支持：YYYY-MM-DD、M月D日（/号）、M-D、
 * 0831 四位月日简写、中文数字（八月三十一 / 八月1）、今天/明天/后天/
 * 大后天、周X/星期X（含下周X、下下周X）。无年份的写法先按当年算，若
 * 已过则顺延一年；不存在日历日（2月30日）直接忽略。
 */
export function findDateToken(
  text: string,
  today: string,
): DateTokenHit | null {
  const todayDate = parseDateKey(today);
  const year = todayDate.getFullYear();
  const rollYear = (month: number, day: number): string | null => {
    if (!isRealDate(year, month, day)) return null;
    const candidate = `${year}-${pad(month)}-${pad(day)}`;
    return candidate < today
      ? `${year + 1}-${pad(month)}-${pad(day)}`
      : candidate;
  };
  const hits: DateTokenHit[] = [
    ...collectMatches(text, ISO_PATTERN, (match) => {
      const [, y, m, d] = match;
      const month = Number(m);
      const day = Number(d);
      return isRealDate(Number(y), month, day)
        ? { date: `${y}-${pad(month)}-${pad(day)}` }
        : null;
    }),
    ...collectMatches(text, MONTH_DAY_PATTERN, (match) => {
      const month = Number(match[1]);
      const day = Number(match[2]);
      const date = rollYear(month, day);
      return date ? { date, label: `${month}月${day}日` } : null;
    }),
    ...collectMatches(text, DIGIT_MMDD_PATTERN, (match) => {
      const month = Number(match[1]);
      const day = Number(match[2]);
      const date = rollYear(month, day);
      return date ? { date, label: `${month}月${day}日` } : null;
    }),
    ...collectMatches(text, CN_MONTH_DAY_PATTERN, (match) => {
      const month = parseCnMonth(match[1]);
      const day = parseCnDay(match[2]);
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      const date = rollYear(month, day);
      return date ? { date, label: `${month}月${day}日` } : null;
    }),
    ...collectMatches(text, SHORT_DATE_PATTERN, (match) => {
      const month = Number(match[1]);
      const day = Number(match[2]);
      if (month < 1 || month > 12) return null;
      const date = rollYear(month, day);
      return date ? { date, label: `${month}月${day}日` } : null;
    }),
    ...collectMatches(text, WEEKDAY_PATTERN, (match) => {
      const target = WEEKDAY_INDEX[match[2]];
      if (target == null) return null;
      const current = todayDate.getDay();
      let delta = (target - current + 7) % 7;
      if (match[1] === "下周") delta += 7;
      if (match[1] === "下下周") delta += 14;
      return { date: shiftDate(today, delta) };
    }),
  ];
  for (const [word, days] of Object.entries(RELATIVE_DAYS)) {
    const index = text.indexOf(word);
    if (index >= 0) {
      hits.push({
        start: index,
        end: index + word.length,
        label: word,
        date: shiftDate(today, days),
      });
    }
  }
  if (hits.length === 0) return null;
  // 取输入中最先出现的片段；同位置取更长（如"下下周三"覆盖"下周三"）。
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  return hits[0];
}

/**
 * 在输入里找所有出现的学生（姓名/别名/编号包含匹配）。单字姓名只在
 * 命中输入开头时采纳，避免任务文本里的普通单字误命中。
 */
export function matchStudents(
  text: string,
  students: QuickAddStudent[],
): StudentCandidate[] {
  const candidates: StudentCandidate[] = [];
  for (const student of students) {
    const tokens = [student.name, student.alias, student.studentCode].filter(
      (token): token is string =>
        typeof token === "string" && token.length >= 2,
    );
    let best: StudentCandidate | null = null;
    for (const token of tokens) {
      const index = text.toLocaleLowerCase().indexOf(token.toLocaleLowerCase());
      if (index === -1) continue;
      const candidate: StudentCandidate = {
        student,
        token: text.slice(index, index + token.length),
        length: token.length,
        index,
      };
      if (
        best == null ||
        candidate.length > best.length ||
        (candidate.length === best.length && candidate.index < best.index)
      ) {
        best = candidate;
      }
    }
    if (best) candidates.push(best);
  }
  candidates.sort((a, b) => b.length - a.length || a.index - b.index);
  return candidates;
}

/** 摘掉学生/日期片段后清理标题两端分隔符与句式连接词（给/为/帮/在/于）。 */
export function cleanTitle(title: string): string {
  const trimmed = title
    .replace(/^[\s，,、;；:：\-—_/]+/, "")
    .replace(/[\s，,、;；:：\-—_/]+$/, "");
  if (trimmed.length === 0) return "";
  return trimmed.replace(/^[给为帮在于]\s*/, "").trim();
}

export function parseQuickAddText(
  input: string,
  students: QuickAddStudent[],
  today: string,
): QuickAddMatch {
  const text = input.trim();
  if (text.length === 0) {
    return {
      students: [],
      student: null,
      date: null,
      dateLabel: null,
      title: "",
    };
  }
  const dateHit = findDateToken(text, today);
  let working = text;
  if (dateHit) {
    working = `${working.slice(0, dateHit.start)} ${working.slice(dateHit.end)}`;
  }
  const candidates = matchStudents(working, students);
  const top = candidates[0] ?? null;
  let title = working;
  if (top) {
    title = `${title.slice(0, top.index)} ${title.slice(top.index + top.length)}`;
  }
  title = cleanTitle(title);
  return {
    students: candidates,
    student: top?.student ?? null,
    date: dateHit?.date ?? null,
    dateLabel: dateHit?.label ?? null,
    title,
  };
}
