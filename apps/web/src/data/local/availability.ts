//! 可学习时间：每周模板与单周覆盖，两者一起决定某天能不能排任务。

import { ApiError } from "../../lib/api/ApiError";
import {
  findNextAvailableStudyDate,
  resolveStudyAvailability,
  type StudyDateOverride,
} from "../../domain/scheduling/availability";
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
import { localError } from "./rows";
import {
  datesBetween,
  now,
  parseDate,
  shiftDate,
  STUDY_DATE_HORIZON_DAYS,
} from "./dates";

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
  const weekEnd = shiftDate(weekStart, 6);
  const statements: LocalSqlStatement[] = [
    {
      sql: `DELETE FROM student_date_override
            WHERE student_id = $1 AND business_date BETWEEN $2 AND $3`,
      values: [studentId, weekStart, weekEnd],
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

  // Turning a populated day into a rest day must not strand ordinary pending
  // work in a cell the student can no longer study on. Build the effective
  // calendar with this draft week replacing persisted overrides, then move
  // each unlocked pending task to its next viable study day. Locked tasks are
  // intentionally left in place. If no date exists in the shared 90-day
  // horizon, keep the date for visibility and mark the task BLOCKED.
  const proposedOverrides: StudyDateOverride[] = days.map((value) => {
    const day = value as Record<string, unknown>;
    return {
      date: requiredString(day, "businessDate"),
      available: Boolean(record(day, "available")),
      availableMinutes: requiredNumber(day, "availableMinutes"),
      devicePolicy:
        (nullableInputString(day, "devicePolicyOverride") as
          "ALLOWED" | "NOT_ALLOWED" | "CONFIRM" | null) ?? null,
    };
  });
  const restDates = proposedOverrides
    .filter((day) => !day.available)
    .map((day) => day.date);
  if (restDates.length > 0) {
    const calendar = await core.studentCalendar(
      studentId,
      weekStart,
      shiftDate(weekEnd, STUDY_DATE_HORIZON_DAYS),
    );
    calendar.overrides = [
      ...(calendar.overrides ?? []).filter(
        (override) => override.date < weekStart || override.date > weekEnd,
      ),
      ...proposedOverrides,
    ];
    const affected = await core.storage.select<DbRow>(
      `SELECT id, scheduled_date, requires_device_snapshot, version
       FROM task_instance
       WHERE student_id = $1 AND scheduled_date BETWEEN $2 AND $3
         AND status = 'PENDING' AND locked = 0`,
      [studentId, weekStart, weekEnd],
    );
    const restSet = new Set(restDates);
    for (const task of affected) {
      const scheduledDate = text(task, "scheduled_date");
      if (!restSet.has(scheduledDate)) continue;
      const targetDate = findNextAvailableStudyDate({
        calendar,
        afterDate: scheduledDate,
        requiresDevice:
          task.requires_device_snapshot == null
            ? undefined
            : bool(task, "requires_device_snapshot"),
        horizonDays: STUDY_DATE_HORIZON_DAYS,
      });
      statements.push(
        targetDate
          ? {
              sql: `UPDATE task_instance SET scheduled_date = $1,
                    original_scheduled_date = COALESCE(original_scheduled_date, $2),
                    schedule_origin = 'MANUAL', manual_override = 1,
                    override_reason = 'REST_DAY_MOVE', version = version + 1,
                    updated_at = $3
                    WHERE id = $4 AND version = $5 AND status = 'PENDING'
                      AND locked = 0`,
              values: [
                targetDate,
                scheduledDate,
                timestamp,
                text(task, "id"),
                numberValue(task, "version"),
              ],
              expectedRowsAffected: 1,
            }
          : {
              sql: `UPDATE task_instance SET status = 'BLOCKED',
                    override_reason = 'REST_DAY_NO_AVAILABLE_DATE',
                    version = version + 1, updated_at = $1
                    WHERE id = $2 AND version = $3 AND status = 'PENDING'
                      AND locked = 0`,
              values: [
                timestamp,
                text(task, "id"),
                numberValue(task, "version"),
              ],
              expectedRowsAffected: 1,
            },
      );
    }
  }
  await core.storage.transaction(statements);
  return getWeekPlan(core, studentId, weekStart);
}

/**
 * Mark one student's date as a rest day and move its open work in the same
 * transaction. This deliberately updates the task row in place: a rest day
 * is a manual schedule correction, not a carry-forward history event.
 */
export async function setStudentRestDay(
  core: LocalCore,
  studentId: string,
  date: string,
  rest: boolean,
): Promise<unknown> {
  parseDate(date);
  await core.studentRow(studentId);
  const timestamp = now();
  const horizonEnd = shiftDate(date, STUDY_DATE_HORIZON_DAYS);
  const calendar = await core.studentCalendar(studentId, date, horizonEnd);
  const existingOverrides = await core.storage.select<DbRow>(
    `SELECT id, available, source_type FROM student_date_override
     WHERE student_id = $1 AND business_date = $2`,
    [studentId, date],
  );
  const existing = existingOverrides[0];
  const statements: LocalSqlStatement[] = [];
  let moved = 0;
  let lockedSkipped = 0;
  let blocked = 0;
  const targetDates: string[] = [];
  const counters: Array<{
    index: number;
    kind: "moved" | "locked" | "blocked";
    targetDate?: string;
  }> = [];
  const pushCounted = (
    statement: LocalSqlStatement,
    kind: "moved" | "locked" | "blocked",
    targetDate?: string,
  ) => {
    counters.push({ index: statements.length, kind, targetDate });
    statements.push(statement);
  };

  if (rest) {
    statements.push({
      sql: `INSERT INTO student_date_override(
              id, student_id, business_date, available, available_minutes,
              device_policy_override, source_type, note, version, created_at, updated_at
            ) VALUES ($1, $2, $3, 0, 0, NULL, 'MANUAL', '休息', 0, $4, $4)
            ON CONFLICT(student_id, business_date) DO UPDATE SET
              available = 0, available_minutes = 0,
              device_policy_override = NULL, source_type = 'MANUAL',
              note = '休息', version = student_date_override.version + 1,
              updated_at = excluded.updated_at`,
      values: [
        existing ? existing.id : crypto.randomUUID(),
        studentId,
        date,
        timestamp,
      ],
      expectedRowsAffected: 1,
    });
    const effectiveCalendar = {
      ...calendar,
      overrides: [
        ...(calendar.overrides ?? []).filter(
          (override) => override.date !== date,
        ),
        { date, available: false, availableMinutes: 0, devicePolicy: null },
      ],
    };
    // Count and move tasks in the same transaction as the override. A task
    // committed before this transaction is included by these predicates;
    // creation after the override is rejected at the task insertion boundary.
    pushCounted(
      {
        sql: `UPDATE task_instance SET updated_at = updated_at
              WHERE student_id = $1 AND scheduled_date = $2
                AND status IN ('PENDING', 'BLOCKED') AND locked <> 0`,
        values: [studentId, date],
      },
      "locked",
    );
    const requirementGroups = [
      { predicate: "requires_device_snapshot = 1", requiresDevice: true },
      { predicate: "requires_device_snapshot = 0", requiresDevice: false },
      {
        predicate: "requires_device_snapshot IS NULL",
        requiresDevice: undefined,
      },
    ];
    for (const group of requirementGroups) {
      const targetDate = findNextAvailableStudyDate({
        calendar: effectiveCalendar,
        afterDate: date,
        requiresDevice: group.requiresDevice,
        horizonDays: STUDY_DATE_HORIZON_DAYS,
      });
      if (!targetDate) {
        pushCounted(
          {
            sql: `UPDATE task_instance SET updated_at = updated_at
                  WHERE student_id = $1 AND scheduled_date = $2
                    AND status IN ('PENDING', 'BLOCKED') AND locked = 0
                    AND ${group.predicate}`,
            values: [studentId, date],
          },
          "blocked",
        );
        continue;
      }
      pushCounted(
        {
          sql: `UPDATE task_instance SET scheduled_date = $1,
                original_scheduled_date = COALESCE(original_scheduled_date, $2),
                schedule_origin = 'MANUAL', manual_override = 1,
                override_reason = 'REST_DAY_MOVE', status = 'PENDING',
                version = version + 1, updated_at = $3
                WHERE student_id = $4 AND scheduled_date = $2
                  AND status IN ('PENDING', 'BLOCKED') AND locked = 0
                  AND ${group.predicate}`,
          values: [targetDate, date, timestamp, studentId],
        },
        "moved",
        targetDate,
      );
    }
  } else {
    // Only remove the manual rest override. A weekly day that is still off
    // receives an explicit available override so cancelling rest is visible
    // in the same calendar without changing the weekly pattern.
    const removingManualRest =
      existing != null &&
      bool(existing, "available") === false &&
      nullableText(existing, "source_type") === "MANUAL";
    if (removingManualRest) {
      statements.push({
        sql: `DELETE FROM student_date_override
              WHERE student_id = $1 AND business_date = $2
                AND available = 0 AND source_type = 'MANUAL'`,
        values: [studentId, date],
      });
    }
    // If there was no override at all, cancelling rest still means the user
    // explicitly enabled this date.  This matters when the weekly pattern is
    // OFF: deleting nothing would leave the effective calendar unavailable.
    if (!existing || removingManualRest) {
      const withoutOverride = {
        ...calendar,
        overrides: (calendar.overrides ?? []).filter(
          (override) => override.date !== date,
        ),
      };
      if (!resolveStudyAvailability(withoutOverride, date).available) {
        statements.push({
          sql: `INSERT INTO student_date_override(
                  id, student_id, business_date, available, available_minutes,
                  device_policy_override, source_type, note, version, created_at, updated_at
                ) VALUES ($1, $2, $3, 1, 0, NULL, 'MANUAL', NULL, 0, $4, $4)`,
          values: [crypto.randomUUID(), studentId, date, timestamp],
          expectedRowsAffected: 1,
        });
      }
    }
  }
  try {
    if (statements.length > 0) {
      const changes = await core.storage.transaction(statements);
      for (const counter of counters) {
        const count = changes[counter.index] ?? 0;
        if (counter.kind === "moved") {
          moved += count;
          if (count > 0 && counter.targetDate) {
            targetDates.push(counter.targetDate);
          }
        } else if (counter.kind === "locked") {
          lockedSkipped += count;
        } else {
          blocked += count;
        }
      }
    }
  } catch (error) {
    localError(error);
  }
  return {
    moved,
    targetDates: [...new Set(targetDates)].sort(),
    lockedSkipped,
    blocked,
  };
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
