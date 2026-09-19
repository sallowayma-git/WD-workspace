//! 学生档案：列表/详情/建档/改档/删档，视图映射也放这里。

import { ApiError } from "../../lib/api/ApiError";
import { renderSeriesTitlePattern } from "../../domain/task/seriesTitle";
import type { LocalSqlStatement } from "./LocalStorage";
import type { LocalCore } from "./localCore";
import * as longTasks from "./longTasks";
import * as tracks from "./tracks";
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
import { formatDate, now, shiftDate } from "./dates";

const STUDENT_SEQUENCE_STATUS_SET = "('NOT_STARTED', 'ACTIVE', 'PAUSED')";

export async function listStudents(
  core: LocalCore,
  query?: string,
): Promise<unknown> {
  const normalized = query?.trim().toLocaleLowerCase();
  const values = normalized ? [`%${normalized}%`] : [];
  const rows = await core.storage.select<DbRow>(
    `SELECT s.*, l.label AS status_label_label, l.color AS status_label_color,
            l.sort_order AS status_label_sort_order
       FROM student s LEFT JOIN student_status_label l ON l.id = s.status_label_id
       ${normalized ? "WHERE lower(s.name) LIKE $1 OR lower(COALESCE(s.alias, '')) LIKE $1 OR lower(s.student_code) LIKE $1" : ""}
       ORDER BY s.name, s.student_code`,
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
    `SELECT s.*, l.label AS status_label_label, l.color AS status_label_color,
            l.sort_order AS status_label_sort_order
       FROM student s LEFT JOIN student_status_label l ON l.id = s.status_label_id
      WHERE s.id = $1`,
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
  const nextStatus = requiredString(input, "status");
  if (text(existing, "status") === "ARCHIVED" || nextStatus === "ARCHIVED") {
    throw new ApiError(
      409,
      "请使用归档或恢复操作修改学生归档状态",
      "STUDENT_ARCHIVE_FLOW_REQUIRED",
    );
  }
  try {
    await core.storage.transaction([
      {
        sql: `UPDATE student SET
          name = $1, alias = $2, status = $3, default_device_policy = $4,
          class_type = $5, enrollment_date = $6, exam_date = $7, note = $8, tags_json = $9,
          subject_preferences_json = $10, version = version + 1, updated_at = $11
        WHERE id = $12 AND version = $13`,
        values: [
          requiredString(input, "name"),
          nullableInputString(input, "alias"),
          requiredString(input, "status"),
          requiredString(input, "defaultDevicePolicy"),
          nullableInputString(input, "classType"),
          nullableInputString(input, "enrollmentDate"),
          nullableInputString(input, "examDate"),
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
  const rows = await core.storage.select<DbRow>(
    `SELECT s.*, l.label AS status_label_label, l.color AS status_label_color,
            l.sort_order AS status_label_sort_order
       FROM student s LEFT JOIN student_status_label l ON l.id = s.status_label_id
      WHERE s.id = $1`,
    [studentId],
  );
  return studentView(rows[0]);
}

/** Fast, optimistic-concurrency-safe patch used by the workbench card. */
export async function updateStudentCard(
  core: LocalCore,
  studentId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const existing = await core.studentRow(studentId);
  const expectedVersion = requiredNumber(input, "expectedVersion");
  const statusLabelId = Object.prototype.hasOwnProperty.call(
    input,
    "statusLabelId",
  )
    ? nullableInputString(input, "statusLabelId")
    : nullableText(existing, "status_label_id");
  const classType = Object.prototype.hasOwnProperty.call(input, "classType")
    ? nullableInputString(input, "classType")
    : nullableText(existing, "class_type");
  const examDate = Object.prototype.hasOwnProperty.call(input, "examDate")
    ? nullableInputString(input, "examDate")
    : nullableText(existing, "exam_date");
  const note = Object.prototype.hasOwnProperty.call(input, "note")
    ? nullableInputString(input, "note")
    : nullableText(existing, "note");
  const timestamp = now();
  try {
    await core.storage.transaction([
      {
        sql: `UPDATE student SET
          status_label_id = $1, class_type = $2, exam_date = $3, note = $4,
          version = version + 1, updated_at = $5
        WHERE id = $6 AND version = $7`,
        values: [
          statusLabelId,
          classType,
          examDate,
          note,
          timestamp,
          studentId,
          expectedVersion,
        ],
        expectedRowsAffected: 1,
      },
    ]);
  } catch (error) {
    localError(error);
  }
  const rows = await core.storage.select<DbRow>(
    `SELECT s.*, l.label AS status_label_label, l.color AS status_label_color,
            l.sort_order AS status_label_sort_order
       FROM student s LEFT JOIN student_status_label l ON l.id = s.status_label_id
      WHERE s.id = $1`,
    [studentId],
  );
  return studentView(rows[0]);
}

export interface StudentArchiveSnapshot {
  pausedTrackIds: string[];
  archivedDefinitionIds: string[];
}

export async function getArchiveImpact(
  core: LocalCore,
  studentId: string,
): Promise<unknown> {
  await core.studentRow(studentId);
  const [taskCountRows, trackRows, definitionRows] = await Promise.all([
    core.storage.select<DbRow>(
      `SELECT COUNT(*) AS count FROM task_instance
       WHERE student_id = $1 AND status IN ('PENDING', 'BLOCKED')`,
      [studentId],
    ),
    core.storage.select<DbRow>(
      `SELECT id, COALESCE(definition_name_snapshot, '') AS name
       FROM student_task_track
       WHERE student_id = $1 AND status IN ('NOT_STARTED', 'ACTIVE')
       ORDER BY created_at, id`,
      [studentId],
    ),
    privateSequenceDefinitions(core, studentId),
  ]);
  return {
    pendingTaskCount: numberValue(taskCountRows[0], "count"),
    tracks: trackRows.map((row) => ({
      id: text(row, "id"),
      name: text(row, "name"),
    })),
    definitions: definitionRows.map((row) => ({
      id: text(row, "id"),
      name: text(row, "name"),
    })),
  };
}

export async function archiveStudent(
  core: LocalCore,
  studentId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const student = await core.studentRow(studentId);
  if (text(student, "status") === "ARCHIVED") {
    throw new ApiError(409, "学生已经归档", "STUDENT_ALREADY_ARCHIVED");
  }
  const expectedVersion = requiredNumber(input, "expectedVersion");
  const timestamp = now();
  const trackRows = await core.storage.select<DbRow>(
    `SELECT id FROM student_task_track
     WHERE student_id = $1 AND status IN ('NOT_STARTED', 'ACTIVE')
     ORDER BY id`,
    [studentId],
  );
  const definitionRows = await privateSequenceDefinitions(core, studentId);
  const snapshot: StudentArchiveSnapshot = {
    pausedTrackIds: trackRows.map((row) => text(row, "id")),
    archivedDefinitionIds: definitionRows.map((row) => text(row, "id")),
  };
  const statements: LocalSqlStatement[] = [
    {
      sql: `UPDATE task_instance
            SET status = 'CANCELLED', cancelled_at = $1,
                version = version + 1, updated_at = $1
            WHERE student_id = $2 AND status IN ('PENDING', 'BLOCKED')`,
      values: [timestamp, studentId],
    },
    ...snapshot.pausedTrackIds.map((trackId) => ({
      sql: `UPDATE student_task_track SET status = 'PAUSED',
              version = version + 1, updated_at = $1
            WHERE id = $2 AND status IN ('NOT_STARTED', 'ACTIVE')`,
      values: [timestamp, trackId],
      expectedRowsAffected: 1,
    })),
    ...snapshot.archivedDefinitionIds.map((definitionId) => ({
      sql: `UPDATE task_template SET status = 'ARCHIVED',
              version = version + 1, updated_at = $1
            WHERE id = $2 AND generation_mode = 'SEQUENCE' AND status = 'ACTIVE'`,
      values: [timestamp, definitionId],
      expectedRowsAffected: 1,
    })),
    {
      sql: `UPDATE student SET status = 'ARCHIVED', archived_at = $1,
              archive_snapshot_json = $2, version = version + 1, updated_at = $1
            WHERE id = $3 AND version = $4 AND status <> 'ARCHIVED'`,
      values: [timestamp, JSON.stringify(snapshot), studentId, expectedVersion],
      expectedRowsAffected: 1,
    },
  ];
  try {
    await core.storage.transaction(statements);
  } catch (error) {
    localError(error);
  }
  return {
    student: studentView(await core.studentRow(studentId)),
    cancelledTasks: numberValue(
      (
        await core.storage.select<DbRow>(
          `SELECT COUNT(*) AS count FROM task_instance
         WHERE student_id = $1 AND status = 'CANCELLED' AND cancelled_at = $2`,
          [studentId, timestamp],
        )
      )[0],
      "count",
    ),
    pausedTracks: snapshot.pausedTrackIds.length,
    archivedDefinitions: snapshot.archivedDefinitionIds.length,
  };
}

export async function restoreStudent(
  core: LocalCore,
  studentId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const student = await core.studentRow(studentId);
  if (text(student, "status") !== "ARCHIVED") {
    throw new ApiError(409, "学生未归档", "STUDENT_NOT_ARCHIVED");
  }
  const expectedVersion = requiredNumber(input, "expectedVersion");
  const snapshot = parseArchiveSnapshot(
    nullableText(student, "archive_snapshot_json"),
  );
  const timestamp = now();
  const candidateDate = shiftDate(
    typeof input.businessDate === "string"
      ? input.businessDate
      : formatDate(new Date()),
    1,
  );
  const statements: LocalSqlStatement[] = [];
  const warnings: string[] = [];

  for (const definitionId of snapshot.archivedDefinitionIds) {
    const [definition] = await core.storage.select<DbRow>(
      `SELECT id, name, normalized_key, status, generation_mode
       FROM task_template WHERE id = $1`,
      [definitionId],
    );
    if (!definition || text(definition, "status") !== "ARCHIVED") continue;
    const normalizedKey = nullableText(definition, "normalized_key");
    const conflicts = normalizedKey
      ? await core.storage.select<DbRow>(
          `SELECT id FROM task_template
           WHERE generation_mode = 'SEQUENCE' AND status = 'ACTIVE'
             AND normalized_key = $1 AND id <> $2 LIMIT 1`,
          [normalizedKey, definitionId],
        )
      : [];
    if (conflicts.length > 0) {
      warnings.push(
        `长期任务“${text(definition, "name")}”存在同名活动定义，未恢复`,
      );
      continue;
    }
    statements.push({
      sql: `UPDATE task_template SET status = 'ACTIVE',
              version = version + 1, updated_at = $1
            WHERE id = $2 AND status = 'ARCHIVED'`,
      values: [timestamp, definitionId],
      expectedRowsAffected: 1,
    });
  }

  let materializedTasks = 0;
  for (const trackId of snapshot.pausedTrackIds) {
    const [track] = await core.storage.select<DbRow>(
      `SELECT * FROM student_task_track WHERE id = $1 AND student_id = $2`,
      [trackId, studentId],
    );
    if (!track || text(track, "status") !== "PAUSED") continue;
    const ordinal = numberValue(track, "current_ordinal");
    const insertion =
      text(track, "generation_mode") === "SEQUENCE"
        ? await longTasks.sequenceTaskInsertStatement(core, {
            trackId,
            studentId,
            ordinal,
            title: renderSeriesTitlePattern(
              text(track, "title_pattern_snapshot"),
              ordinal,
            ),
            candidateDate,
            durationOverride:
              track.duration_override_minutes == null
                ? null
                : numberValue(track, "duration_override_minutes"),
          })
        : await itemizedRestoreInsertion(core, track, candidateDate);
    if (insertion.outcome === "CREATED") {
      statements.push(insertion.statement);
      materializedTasks += 1;
    } else if (insertion.outcome === "NO_AVAILABLE_DATE") {
      warnings.push(
        `轨道“${nullableText(track, "definition_name_snapshot") ?? trackId}”在 90 天内没有学习日`,
      );
    }
    statements.push({
      sql: `UPDATE student_task_track SET status = 'ACTIVE',
              next_candidate_date = $1, version = version + 1, updated_at = $2
            WHERE id = $3 AND status = 'PAUSED'`,
      values: [
        insertion.outcome === "CREATED" ? insertion.scheduledDate : null,
        timestamp,
        trackId,
      ],
      expectedRowsAffected: 1,
    });
  }
  statements.push({
    sql: `UPDATE student SET status = 'ACTIVE', archived_at = NULL,
            archive_snapshot_json = NULL, version = version + 1, updated_at = $1
          WHERE id = $2 AND version = $3 AND status = 'ARCHIVED'`,
    values: [timestamp, studentId, expectedVersion],
    expectedRowsAffected: 1,
  });
  try {
    await core.storage.transaction(statements);
  } catch (error) {
    localError(error);
  }
  return {
    student: studentView(await core.studentRow(studentId)),
    restoredTracks: snapshot.pausedTrackIds.length,
    materializedTasks,
    warnings,
  };
}

async function privateSequenceDefinitions(
  core: LocalCore,
  studentId: string,
): Promise<DbRow[]> {
  return core.storage.select<DbRow>(
    `SELECT DISTINCT t.id, t.name
     FROM student_task_track stt
     JOIN task_template t ON t.id = stt.template_id
     WHERE stt.student_id = $1
       AND stt.generation_mode = 'SEQUENCE'
       AND stt.status IN ${STUDENT_SEQUENCE_STATUS_SET}
       AND t.status = 'ACTIVE'
       AND NOT EXISTS (
         SELECT 1 FROM student_task_track other
         WHERE other.template_id = t.id AND other.student_id <> $1
           AND other.status IN ${STUDENT_SEQUENCE_STATUS_SET}
       )
     ORDER BY t.id`,
    [studentId],
  );
}

function parseArchiveSnapshot(raw: string | null): StudentArchiveSnapshot {
  try {
    const parsed = JSON.parse(raw ?? "{}") as Partial<StudentArchiveSnapshot>;
    return {
      pausedTrackIds: Array.isArray(parsed.pausedTrackIds)
        ? parsed.pausedTrackIds.filter(
            (id): id is string => typeof id === "string",
          )
        : [],
      archivedDefinitionIds: Array.isArray(parsed.archivedDefinitionIds)
        ? parsed.archivedDefinitionIds.filter(
            (id): id is string => typeof id === "string",
          )
        : [],
    };
  } catch {
    return { pausedTrackIds: [], archivedDefinitionIds: [] };
  }
}

async function itemizedRestoreInsertion(
  core: LocalCore,
  track: DbRow,
  candidateDate: string,
) {
  const [item] = await core.storage.select<DbRow>(
    `SELECT * FROM task_template_item
     WHERE template_version_id = $1 AND ordinal = $2 AND active = 1`,
    [text(track, "template_version_id"), numberValue(track, "current_ordinal")],
  );
  if (!item) return { outcome: "ALREADY_PENDING" as const };
  return tracks.trackTaskInsertStatement(core, {
    trackId: text(track, "id"),
    studentId: text(track, "student_id"),
    templateVersionId: text(track, "template_version_id"),
    item,
    candidateDate,
    durationOverride:
      track.duration_override_minutes == null
        ? null
        : numberValue(track, "duration_override_minutes"),
  });
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
    statusLabelId: nullableText(row, "status_label_id"),
    statusLabel:
      typeof row.status_label_label === "string"
        ? {
            id: nullableText(row, "status_label_id"),
            label: text(row, "status_label_label"),
            color: nullableText(row, "status_label_color"),
          }
        : null,
    classType: nullableText(row, "class_type"),
    enrollmentDate: nullableText(row, "enrollment_date"),
    defaultDevicePolicy: text(row, "default_device_policy"),
    note: nullableText(row, "note"),
    examDate: nullableText(row, "exam_date"),
    archivedAt: nullableText(row, "archived_at"),
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
