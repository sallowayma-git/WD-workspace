//! 学生档案：列表/详情/建档/改档/删档，视图映射也放这里。

import { ApiError } from "../../lib/api/ApiError";
import type { LocalSqlStatement } from "./LocalStorage";
import type { LocalCore } from "./localCore";
import {
  localError,
  nullableInputString,
  nullableText,
  numberValue,
  parseJsonArray,
  record,
  requiredNumber,
  requiredString,
  text,
  type DbRow,
} from "./rows";
import { now } from "./dates";

export async function listStudents(
  core: LocalCore,
  query?: string,
): Promise<unknown> {
  const normalized = query?.trim().toLocaleLowerCase();
  const where = normalized
    ? "WHERE lower(name) LIKE $1 OR lower(student_code) LIKE $1"
    : "";
  const values = normalized ? [`%${normalized}%`] : [];
  const rows = await core.storage.select<DbRow>(
    `SELECT * FROM student ${where} ORDER BY name, student_code`,
    values,
  );
  return {
    items: rows.map((row) => studentView(row)),
    page: 0,
    size: rows.length,
    total: rows.length,
    hasNext: false,
  };
}

export async function getStudent(
  core: LocalCore,
  studentId: string,
): Promise<unknown> {
  const rows = await core.storage.select<DbRow>(
    "SELECT * FROM student WHERE id = $1",
    [studentId],
  );
  if (!rows[0]) throw new ApiError(404, "学生不存在", "STUDENT_NOT_FOUND");
  return studentView(rows[0]);
}

/**
 * 学生编号不是助教必须操心的东西，界面上已改为选填。缺省时按现有编号里最大的
 * 数字顺延生成一个（S001、S002…），既保住 UNIQUE 约束，也保证列表里仍有编号可读。
 */
async function nextStudentCode(core: LocalCore): Promise<string> {
  const rows = await core.storage.select<DbRow>(
    `SELECT student_code FROM student WHERE student_code LIKE 'S%'`,
  );
  let max = 0;
  for (const row of rows) {
    const match = /^S(\d+)$/.exec(text(row, "student_code"));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `S${String(max + 1).padStart(3, "0")}`;
}

export async function createStudent(
  core: LocalCore,
  input: Record<string, unknown>,
): Promise<unknown> {
  const id = crypto.randomUUID();
  const timestamp = now();
  const providedCode = nullableInputString(input, "studentCode");
  const studentCode =
    providedCode && providedCode.trim().length > 0
      ? providedCode.trim()
      : await nextStudentCode(core);
  const subjectPreferences = normalizeSubjectPreferences(
    record(input, "subjectPreferences"),
    timestamp,
  );
  await core.storage.transaction([
    {
      sql: `INSERT INTO student(
        id, student_code, name, status, class_type, default_device_policy,
        tags_json, subject_preferences_json, version, created_at, updated_at
      ) VALUES ($1, $2, $3, 'ACTIVE', $4, $5, '[]', $6, 0, $7, $7)`,
      values: [
        id,
        studentCode,
        requiredString(input, "name"),
        nullableInputString(input, "classType"),
        requiredString(input, "defaultDevicePolicy"),
        JSON.stringify(subjectPreferences),
        timestamp,
      ],
      expectedRowsAffected: 1,
    },
  ]);
  return studentView(await core.studentRow(id));
}

export async function updateStudent(
  core: LocalCore,
  studentId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const existing = await core.studentRow(studentId);
  const timestamp = now();
  const preferences = normalizeSubjectPreferences(
    record(input, "subjectPreferences"),
    timestamp,
  );
  try {
    await core.storage.transaction([
      {
        sql: `UPDATE student SET
          name = $1, alias = $2, status = $3, default_device_policy = $4,
          class_type = $5, enrollment_date = $6, note = $7, tags_json = $8,
          subject_preferences_json = $9, version = version + 1, updated_at = $10
        WHERE id = $11 AND version = $12`,
        values: [
          requiredString(input, "name"),
          nullableInputString(input, "alias"),
          requiredString(input, "status"),
          requiredString(input, "defaultDevicePolicy"),
          nullableInputString(input, "classType"),
          nullableInputString(input, "enrollmentDate"),
          nullableInputString(input, "note"),
          JSON.stringify(record(input, "tags") ?? []),
          JSON.stringify(preferences),
          timestamp,
          studentId,
          numberValue(existing, "version"),
        ],
        expectedRowsAffected: 1,
      },
    ]);
  } catch (error) {
    localError(error);
  }
  return studentView(await core.studentRow(studentId));
}

/**
 * 硬删除学生及其全部从属数据（常规周、日期覆盖、轨道、任务、生词）。
 * 外键虽然声明了 ON DELETE CASCADE，但级联依赖连接级 PRAGMA foreign_keys，
 * 浏览器/桌面两个存储实现并不保证开启，所以按依赖顺序显式删除，保证任何
 * 存储下都不留孤儿行。删除前先把其他学生任务指向本学生任务的
 * linked_parent/carried 指针置空——linkMainTask 与跨学生改期允许产生
 * 跨学生引用，整批 DELETE 语句会把它们一起连带删掉并触发外键错误。
 */
export async function deleteStudent(
  core: LocalCore,
  studentId: string,
): Promise<void> {
  await core.studentRow(studentId);
  const statements: LocalSqlStatement[] = [
    {
      sql: `UPDATE task_instance SET linked_parent_task_id = NULL,
            carried_from_instance_id = NULL, carried_to_instance_id = NULL
            WHERE student_id <> $1 AND (
              linked_parent_task_id IN (SELECT id FROM task_instance WHERE student_id = $1)
              OR carried_from_instance_id IN (SELECT id FROM task_instance WHERE student_id = $1)
              OR carried_to_instance_id IN (SELECT id FROM task_instance WHERE student_id = $1)
            )`,
      values: [studentId],
    },
    // 同一学生内部的 parent/顺延引用都在这一条语句内随之消失，语句末才做
    // 外键检查，不会被剩余引用卡住。
    {
      sql: "DELETE FROM task_instance WHERE student_id = $1",
      values: [studentId],
    },
    {
      sql: "DELETE FROM vocabulary_entry WHERE student_id = $1",
      values: [studentId],
    },
    {
      sql: "DELETE FROM vocabulary_batch WHERE student_id = $1",
      values: [studentId],
    },
    {
      sql: "DELETE FROM student_task_track WHERE student_id = $1",
      values: [studentId],
    },
    {
      sql: "DELETE FROM student_date_override WHERE student_id = $1",
      values: [studentId],
    },
    {
      sql: `DELETE FROM student_weekly_pattern_day WHERE pattern_id IN
            (SELECT id FROM student_weekly_pattern WHERE student_id = $1)`,
      values: [studentId],
    },
    {
      sql: "DELETE FROM student_weekly_pattern WHERE student_id = $1",
      values: [studentId],
    },
    {
      sql: "DELETE FROM student WHERE id = $1",
      values: [studentId],
      expectedRowsAffected: 1,
    },
  ];
  try {
    await core.storage.transaction(statements);
  } catch (error) {
    localError(error);
  }
}

function studentView(row: DbRow): Record<string, unknown> {
  return {
    id: text(row, "id"),
    studentCode: text(row, "student_code"),
    name: text(row, "name"),
    alias: nullableText(row, "alias"),
    status: text(row, "status"),
    classType: nullableText(row, "class_type"),
    enrollmentDate: nullableText(row, "enrollment_date"),
    defaultDevicePolicy: text(row, "default_device_policy"),
    note: nullableText(row, "note"),
    tags: parseJsonArray(row.tags_json),
    subjectPreferences: parseJsonArray(row.subject_preferences_json),
    version: numberValue(row, "version"),
    updatedAt: text(row, "updated_at"),
  };
}

function normalizeSubjectPreferences(
  value: unknown,
  timestamp: string,
): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const preference = entry as Record<string, unknown>;
    return {
      id:
        typeof preference.id === "string" ? preference.id : crypto.randomUUID(),
      subjectCode: requiredString(preference, "subjectCode"),
      priority: requiredNumber(preference, "priority"),
      targetRatio: requiredNumber(preference, "targetRatio"),
      note: nullableInputString(preference, "note"),
      version: typeof preference.version === "number" ? preference.version : 0,
      updatedAt:
        typeof preference.updatedAt === "string"
          ? preference.updatedAt
          : timestamp,
    };
  });
}
