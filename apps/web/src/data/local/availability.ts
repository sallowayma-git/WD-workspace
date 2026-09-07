//! 可学习时间：每周模板与单周覆盖，两者一起决定某天能不能排任务。

import { ApiError } from "../../lib/api/ApiError";
import type { LocalSqlStatement } from "./LocalStorage";
import type { LocalCore } from "./localCore";
import {
  bool,
  nullableInputString,
  nullableText,
  numberValue,
  record,
  requiredNumber,
  requiredString,
  text,
  type DbRow,
} from "./rows";
import { datesBetween, now, shiftDate } from "./dates";

export async function getWeeklyPattern(
  core: LocalCore,
  studentId: string,
): Promise<unknown> {
  const patterns = await core.storage.select<DbRow>(
    `SELECT * FROM student_weekly_pattern
     WHERE student_id = $1 AND status = 'ACTIVE'
     ORDER BY effective_from DESC LIMIT 1`,
    [studentId],
  );
  const pattern = patterns[0];
  if (!pattern) {
    throw new ApiError(404, "学生常规周不存在", "WEEKLY_PATTERN_NOT_FOUND");
  }
  const days = await core.storage.select<DbRow>(
    `SELECT * FROM student_weekly_pattern_day
     WHERE pattern_id = $1 ORDER BY day_of_week`,
    [text(pattern, "id")],
  );
  return {
    id: text(pattern, "id"),
    studentId,
    effectiveFrom: text(pattern, "effective_from"),
    effectiveTo: nullableText(pattern, "effective_to"),
    status: text(pattern, "status"),
    days: days.map((day) => ({
      dayOfWeek: numberValue(day, "day_of_week"),
      available: bool(day, "available"),
      availableMinutes: numberValue(day, "available_minutes"),
      devicePolicyOverride: nullableText(day, "device_policy_override"),
    })),
    version: numberValue(pattern, "version"),
    updatedAt: text(pattern, "updated_at"),
  };
}

export async function saveWeeklyPattern(
  core: LocalCore,
  studentId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  await core.studentRow(studentId);
  const days = record(input, "days");
  if (!Array.isArray(days) || days.length !== 7) {
    throw new ApiError(
      422,
      "常规周必须提供 7 天数据",
      "WEEKLY_PATTERN_DAYS_REQUIRED",
    );
  }
  const id = crypto.randomUUID();
  const timestamp = now();
  const statements: LocalSqlStatement[] = [
    {
      sql: `UPDATE student_weekly_pattern
            SET status = 'RETIRED', effective_to = $1, version = version + 1,
                updated_at = $2
            WHERE student_id = $3 AND status = 'ACTIVE'`,
      values: [
        shiftDate(requiredString(input, "effectiveFrom"), -1),
        timestamp,
        studentId,
      ],
    },
    {
      sql: `INSERT INTO student_weekly_pattern(
              id, student_id, effective_from, status, version, created_at, updated_at
            ) VALUES ($1, $2, $3, 'ACTIVE', 0, $4, $4)`,
      values: [
        id,
        studentId,
        requiredString(input, "effectiveFrom"),
        timestamp,
      ],
      expectedRowsAffected: 1,
    },
  ];
  for (const value of days) {
    const day = value as Record<string, unknown>;
    statements.push({
      sql: `INSERT INTO student_weekly_pattern_day(
              pattern_id, day_of_week, available, available_minutes,
              device_policy_override
            ) VALUES ($1, $2, $3, $4, $5)`,
      values: [
        id,
        requiredNumber(day, "dayOfWeek"),
        Boolean(record(day, "available")),
        requiredNumber(day, "availableMinutes"),
        nullableInputString(day, "devicePolicyOverride"),
      ],
      expectedRowsAffected: 1,
    });
  }
  await core.storage.transaction(statements);
  return getWeeklyPattern(core, studentId);
}

export async function getWeekPlan(
  core: LocalCore,
  studentId: string,
  weekStart: string,
): Promise<unknown> {
  const weekEnd = shiftDate(weekStart, 6);
  const rows = await core.storage.select<DbRow>(
    `SELECT * FROM student_date_override
     WHERE student_id = $1 AND business_date BETWEEN $2 AND $3
     ORDER BY business_date`,
    [studentId, weekStart, weekEnd],
  );
  if (rows.length !== 7) {
    throw new ApiError(404, "周计划不存在", "WEEK_PLAN_NOT_FOUND");
  }
  return weekPlanView(studentId, weekStart, rows);
}

export async function saveWeekPlan(
  core: LocalCore,
  studentId: string,
  weekStart: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  await core.studentRow(studentId);
  const sourceType = requiredString(input, "sourceType");
  let days = record(input, "days");
  if (!Array.isArray(days)) {
    if (sourceType === "BASE_PATTERN") {
      const pattern = (await getWeeklyPattern(core, studentId)) as {
        days: Array<Record<string, unknown>>;
      };
      days = pattern.days.map((day) => ({
        businessDate: shiftDate(
          weekStart,
          requiredNumber(day, "dayOfWeek") - 1,
        ),
        available: Boolean(record(day, "available")),
        availableMinutes: requiredNumber(day, "availableMinutes"),
        devicePolicyOverride: record(day, "devicePolicyOverride") ?? null,
        note: null,
      }));
    } else if (sourceType === "PREVIOUS_WEEK") {
      const previous = (await getWeekPlan(
        core,
        studentId,
        shiftDate(weekStart, -7),
      )) as {
        days: Array<Record<string, unknown>>;
      };
      days = previous.days.map((day, index) => ({
        ...day,
        businessDate: shiftDate(weekStart, index),
      }));
    } else {
      days = datesBetween(weekStart, shiftDate(weekStart, 6)).map((date) => ({
        businessDate: date,
        available: true,
        availableMinutes: 0,
        devicePolicyOverride: null,
        note: null,
      }));
    }
  }
  if (!Array.isArray(days) || days.length !== 7) {
    throw new ApiError(
      422,
      "日期覆盖必须提供完整 7 天数据",
      "WEEK_PLAN_DAYS_REQUIRED",
    );
  }
  const timestamp = now();
  const statements: LocalSqlStatement[] = [
    {
      sql: `DELETE FROM student_date_override
            WHERE student_id = $1 AND business_date BETWEEN $2 AND $3`,
      values: [studentId, weekStart, shiftDate(weekStart, 6)],
    },
  ];
  for (const value of days) {
    const day = value as Record<string, unknown>;
    statements.push({
      sql: `INSERT INTO student_date_override(
              id, student_id, business_date, available, available_minutes,
              device_policy_override, source_type, note, version, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $9)`,
      values: [
        crypto.randomUUID(),
        studentId,
        requiredString(day, "businessDate"),
        Boolean(record(day, "available")),
        requiredNumber(day, "availableMinutes"),
        nullableInputString(day, "devicePolicyOverride"),
        sourceType,
        nullableInputString(day, "note"),
        timestamp,
      ],
      expectedRowsAffected: 1,
    });
  }
  await core.storage.transaction(statements);
  return getWeekPlan(core, studentId, weekStart);
}

function weekPlanView(studentId: string, weekStart: string, rows: DbRow[]) {
  return {
    id: text(rows[0], "id"),
    studentId,
    weekStartDate: weekStart,
    sourceType: text(rows[0], "source_type"),
    sourceId: null,
    status: "DRAFT",
    confirmedAt: null,
    days: rows.map((row) => ({
      id: text(row, "id"),
      businessDate: text(row, "business_date"),
      available: bool(row, "available"),
      availableMinutes: numberValue(row, "available_minutes"),
      devicePolicyOverride: nullableText(row, "device_policy_override"),
      note: nullableText(row, "note"),
      version: numberValue(row, "version"),
    })),
    version: Math.max(...rows.map((row) => numberValue(row, "version"))),
    updatedAt: text(rows[0], "updated_at"),
  };
}
