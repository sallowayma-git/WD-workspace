//! Excel 排期导入：只追加任务，不会修改或删除已有任务。

import { ApiError } from "../../lib/api/ApiError";
import type { LocalSqlStatement } from "./LocalStorage";
import type { LocalCore } from "./localCore";
import { localError, nullableText, text, type DbRow } from "./rows";
import { now, parseDate } from "./dates";

export type ScheduleImportRow = {
  studentCode?: string;
  studentName: string;
  date: string;
  titles: string[];
};

export type ScheduleImportCreateRow = ScheduleImportRow & {
  studentId: string;
};

export type ScheduleImportUnmatchedStudent = {
  studentCode?: string;
  studentName: string;
  rowNumbers: number[];
};

export type ScheduleImportInvalidRow = {
  rowNumber: number;
  reason: string;
  row: ScheduleImportRow;
};

export type ScheduleImportPlan = {
  toCreate: ScheduleImportCreateRow[];
  skippedDuplicates: number;
  unmatchedStudents: ScheduleImportUnmatchedStudent[];
  invalidRows: ScheduleImportInvalidRow[];
};

function asRow(value: unknown): ScheduleImportRow | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const studentName =
    typeof input.studentName === "string" ? input.studentName.trim() : "";
  const date = typeof input.date === "string" ? input.date.trim() : "";
  const titles = Array.isArray(input.titles)
    ? input.titles
        .filter((title): title is string => typeof title === "string")
        .map((title) => title.trim())
        .filter(Boolean)
    : [];
  const studentCode =
    typeof input.studentCode === "string" && input.studentCode.trim()
      ? input.studentCode.trim()
      : undefined;
  return { studentName, date, titles, ...(studentCode ? { studentCode } : {}) };
}

/**
 * Match by code first. A name is only accepted when it identifies exactly one
 * student; a duplicate name is deliberately treated as unmatched.
 */
export async function previewScheduleImport(
  core: LocalCore,
  rows: unknown,
): Promise<ScheduleImportPlan> {
  if (!Array.isArray(rows)) {
    throw new ApiError(422, "排期导入数据格式无效", "INVALID_IMPORT_ROWS");
  }
  const students = await core.storage.select<DbRow>(
    "SELECT id, student_code, name FROM student",
  );
  const byCode = new Map(
    students.map((row) => [text(row, "student_code"), row]),
  );
  const byName = new Map<string, DbRow[]>();
  for (const student of students) {
    const name = text(student, "name");
    byName.set(name, [...(byName.get(name) ?? []), student]);
  }

  const normalized: Array<{ row: ScheduleImportRow; studentId: string }> = [];
  const invalidRows: ScheduleImportInvalidRow[] = [];
  const unmatchedStudents: ScheduleImportUnmatchedStudent[] = [];
  for (const [index, value] of rows.entries()) {
    const rowNumber = index + 1;
    const row = asRow(value);
    if (!row) {
      invalidRows.push({
        rowNumber,
        reason: "行数据格式无效",
        row: { studentName: "", date: "", titles: [] },
      });
      continue;
    }
    if (!row.studentName || !row.date || row.titles.length === 0) {
      invalidRows.push({ rowNumber, reason: "学生、日期或任务标题为空", row });
      continue;
    }
    try {
      parseDate(row.date);
    } catch {
      invalidRows.push({ rowNumber, reason: "日期格式无效", row });
      continue;
    }
    const byCodeMatch = row.studentCode
      ? byCode.get(row.studentCode)
      : undefined;
    const nameMatches = byName.get(row.studentName) ?? [];
    const student =
      byCodeMatch ?? (nameMatches.length === 1 ? nameMatches[0] : undefined);
    if (!student) {
      const existing = unmatchedStudents.find(
        (item) =>
          item.studentCode === row.studentCode &&
          item.studentName === row.studentName,
      );
      if (existing) existing.rowNumbers.push(rowNumber);
      else
        unmatchedStudents.push({
          ...(row.studentCode ? { studentCode: row.studentCode } : {}),
          studentName: row.studentName,
          rowNumbers: [rowNumber],
        });
      continue;
    }
    normalized.push({ row, studentId: text(student, "id") });
  }

  const existing = await core.storage.select<DbRow>(
    `SELECT student_id, scheduled_date, title_snapshot, short_title_snapshot
       FROM task_instance
      WHERE status <> 'CANCELLED'`,
  );
  const duplicateKeys = new Set(
    existing.flatMap((row) => {
      const prefix = `${text(row, "student_id")}\u0000${nullableText(row, "scheduled_date") ?? ""}\u0000`;
      const titles = [text(row, "title_snapshot")];
      const shortTitle = nullableText(row, "short_title_snapshot");
      if (shortTitle && shortTitle !== titles[0]) titles.push(shortTitle);
      return titles.map((title) => `${prefix}${title}`);
    }),
  );
  const toCreate: ScheduleImportCreateRow[] = [];
  let skippedDuplicates = 0;
  for (const { row, studentId } of normalized) {
    for (const title of row.titles) {
      const key = `${studentId}\u0000${row.date}\u0000${title}`;
      if (duplicateKeys.has(key)) {
        skippedDuplicates += 1;
      } else {
        duplicateKeys.add(key);
        toCreate.push({
          studentId,
          studentName: row.studentName,
          ...(row.studentCode ? { studentCode: row.studentCode } : {}),
          date: row.date,
          titles: [title],
        });
      }
    }
  }
  return { toCreate, skippedDuplicates, unmatchedStudents, invalidRows };
}

function createStatement(
  row: ScheduleImportCreateRow,
  timestamp: string,
): LocalSqlStatement {
  const id = crypto.randomUUID();
  return {
    sql: `INSERT INTO task_instance(
      id, student_id, source_type, scheduled_date, original_scheduled_date,
      status, title_snapshot, schedule_origin, manual_override, locked,
      star, version, created_at, updated_at
    ) VALUES ($1, $2, 'IMPORT', $3, $3, 'PENDING', $4,
              'EXCEL_IMPORT', 0, 0, 0, 0, $5, $5)`,
    values: [id, row.studentId, row.date, row.titles[0], timestamp],
    expectedRowsAffected: 1,
  };
}

/** Execute only the additive rows from a previously previewed plan. */
export async function executeScheduleImport(
  core: LocalCore,
  input: unknown,
): Promise<{ created: number }> {
  if (!input || typeof input !== "object") {
    throw new ApiError(422, "排期导入计划格式无效", "INVALID_IMPORT_PLAN");
  }
  const plan = input as Partial<ScheduleImportPlan>;
  if (!Array.isArray(plan.toCreate)) {
    throw new ApiError(422, "排期导入计划格式无效", "INVALID_IMPORT_PLAN");
  }
  const rows: ScheduleImportCreateRow[] = [];
  for (const value of plan.toCreate) {
    const row = asRow(value);
    const studentId =
      value &&
      typeof value === "object" &&
      typeof (value as Record<string, unknown>).studentId === "string"
        ? ((value as Record<string, unknown>).studentId as string)
        : null;
    if (!row || !studentId || row.titles.length !== 1) {
      throw new ApiError(422, "排期导入计划包含无效行", "INVALID_IMPORT_PLAN");
    }
    await core.studentRow(studentId);
    parseDate(row.date);
    rows.push({ ...row, studentId });
  }
  if (rows.length === 0) return { created: 0 };
  try {
    const timestamp = now();
    await core.storage.transaction(
      rows.map((row) => createStatement(row, timestamp)),
    );
    return { created: rows.length };
  } catch (error) {
    localError(error);
  }
}
