//! 本地适配器的日期口径：字符串日期一律走 parseDate 校验，避免 JS Date 静默进位。

import { ApiError } from "../../lib/api/ApiError";
import { nullableInputString } from "./rows";

/** 往后找可学习日的天数上限；超出算排不下去（轨道停 BLOCKED，手动接排报错）。 */
export const STUDY_DATE_HORIZON_DAYS = 90;

export function now(): string {
  return new Date().toISOString();
}

export function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new ApiError(422, "日期格式无效", "INVALID_DATE");
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  // JS Date 会把越界字段静默进位（2026-02-31 → 2026-03-03），所以正则通过
  // 不等于日期真实存在。round-trip 校验拒绝 02-31 / 04-31 / 非闰年 02-29 /
  // 13-01 / 00-10 这类输入，保证库里的 scheduled_date 都是合法日历日。
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    throw new ApiError(422, `日历上不存在的日期：${value}`, "INVALID_DATE");
  }
  return date;
}

/** Optional date input: returns null when absent, rejects impossible dates. */
export function optionalDateString(
  input: Record<string, unknown>,
  key: string,
): string | null {
  const value = nullableInputString(input, key);
  if (value != null) parseDate(value);
  return value;
}

export function formatDate(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

export function datesBetween(from: string, to: string): string[] {
  const start = parseDate(from);
  const end = parseDate(to);
  const dates: string[] = [];
  for (
    const date = new Date(start);
    date <= end;
    date.setDate(date.getDate() + 1)
  ) {
    dates.push(formatDate(date));
  }
  return dates;
}

export function shiftDate(value: string, days: number): string {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

/** Monday of the ISO week containing `value`. */
export function mondayOf(value: string): string {
  const date = parseDate(value);
  const weekday = date.getDay();
  date.setDate(date.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  return formatDate(date);
}

/**
 * The inclusive date window a schedule view covers. Day means one day, week
 * means the Monday-first ISO week, month means the whole calendar month — the
 * grid the page draws must be backed by real days, otherwise a month view
 * shows mostly empty placeholder cells.
 */
export function scheduleWindow(
  anchorDate: string,
  view: string,
): { start: string; end: string } {
  if (view === "day") {
    return { start: anchorDate, end: anchorDate };
  }
  if (view === "month") {
    // The month grid is a Monday-first six-week block, so it also shows the
    // tail of the previous month and the head of the next one. Those cells must
    // carry real tasks, otherwise a task in the leading week looks deleted.
    const date = parseDate(anchorDate);
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    const gridStart = mondayOf(formatDate(first));
    return { start: gridStart, end: shiftDate(gridStart, 41) };
  }
  const start = mondayOf(anchorDate);
  return { start, end: shiftDate(start, 6) };
}
