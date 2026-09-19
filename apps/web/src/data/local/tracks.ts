//! 轨道（ITEMIZED 模板挂载）：挂载、进度，以及生成轨道任务行的语句。

import { ApiError } from "../../lib/api/ApiError";
import {
  findNextAvailableStudyDate,
  resolveStudyAvailability,
} from "../../domain/scheduling/availability";
import type { LocalSqlStatement } from "./LocalStorage";
import type { LocalCore } from "./localCore";
import {
  bool,
  localError,
  nullableInputString,
  nullableNumber,
  nullableText,
  numberValue,
  record,
  requiredNumber,
  requiredString,
  text,
  type DbRow,
} from "./rows";
import { now, shiftDate, STUDY_DATE_HORIZON_DAYS } from "./dates";

export async function listStudentTracks(
  core: LocalCore,
  studentId: string,
  status?: string,
): Promise<unknown> {
  const rows = await core.storage.select<DbRow>(
    `SELECT * FROM student_task_track WHERE student_id = $1
     ${status ? "AND status = $2" : ""}
     ORDER BY priority DESC, created_at`,
    status ? [studentId, status] : [studentId],
  );
  const stalled = await stalledSequenceTrackIds(core, rows);
  return rows.map((row) => trackView(row, stalled));
}

export async function getTrack(
  core: LocalCore,
  trackId: string,
): Promise<unknown> {
  const row = await getTrackRow(core, trackId);
  return trackView(row, await stalledSequenceTrackIds(core, [row]));
}

/**
 * ACTIVE 的长期任务轨道恒有一条待完成任务（挂载建首项、完成建下一项）；
 * 没有就是链条断了——排不到可学习日或被手动删了，得看得见。
 */
async function stalledSequenceTrackIds(
  core: LocalCore,
  rows: DbRow[],
): Promise<Set<string>> {
  const candidates = rows.filter(
    (row) =>
      text(row, "status") === "ACTIVE" &&
      nullableText(row, "generation_mode") === "SEQUENCE",
  );
  if (candidates.length === 0) return new Set();
  const ids = candidates.map((row) => text(row, "id"));
  const scheduled = await core.storage.select<DbRow>(
    `SELECT DISTINCT track_id FROM task_instance
     WHERE status = 'PENDING' AND track_id IN (${ids
       .map((_, index) => `$${index + 1}`)
       .join(", ")})`,
    ids,
  );
  const alive = new Set(scheduled.map((row) => text(row, "track_id")));
  return new Set(ids.filter((id) => !alive.has(id)));
}

export async function mountTrack(
  core: LocalCore,
  input: Record<string, unknown>,
): Promise<unknown> {
  const idempotencyKey = requiredString(input, "idempotencyKey");
  return core.idempotentCommand(
    idempotencyKey,
    async () => {
      const studentId = requiredString(input, "studentId");
      await core.activeStudentRow(studentId);
      const template = await core.templateRow(
        requiredString(input, "templateId"),
      );
      const versionRows = await core.storage.select<DbRow>(
        `SELECT * FROM task_template_version
     WHERE id = $1 AND template_id = $2`,
        [requiredString(input, "templateVersionId"), text(template, "id")],
      );
      const version = versionRows[0];
      if (!version || text(version, "status") !== "PUBLISHED") {
        throw new ApiError(
          422,
          "模板版本尚未发布",
          "TEMPLATE_VERSION_NOT_PUBLISHED",
        );
      }
      const startOrdinal = requiredNumber(input, "startOrdinal");
      const endOrdinal = requiredNumber(input, "endOrdinal");
      const items = await core.storage.select<DbRow>(
        `SELECT * FROM task_template_item WHERE template_version_id = $1
     AND ordinal BETWEEN $2 AND $3 AND active = 1 ORDER BY ordinal`,
        [text(version, "id"), startOrdinal, endOrdinal],
      );
      if (items.length !== endOrdinal - startOrdinal + 1) {
        throw new ApiError(
          422,
          "轨道单元必须连续",
          "TRACK_ORDINAL_RANGE_INVALID",
        );
      }
      const trackId = crypto.randomUUID();
      const timestamp = now();
      const defaultUnits = record(input, "defaultUnitsPerSession");
      const priority = record(input, "priority");
      const schedulingPolicy = record(input, "schedulingPolicy");
      const statements: LocalSqlStatement[] = [
        {
          sql: `INSERT INTO student_task_track(
              id, student_id, template_id, template_version_id, status,
              start_ordinal, current_ordinal, end_ordinal,
              default_units_per_session, start_date, next_candidate_date,
              priority, allow_parallel_items, scheduling_policy,
              duration_override_minutes, device_policy_override, note,
              version, created_at, updated_at
            ) SELECT $1, s.id, $3, $4, 'ACTIVE', $5, $5, $6, $7, $8, $8,
                      $9, 0, $10, NULL, NULL, $11, 0, $12, $12
                FROM student s WHERE s.id = $2 AND s.status = 'ACTIVE'`,
          values: [
            trackId,
            studentId,
            text(template, "id"),
            text(version, "id"),
            startOrdinal,
            endOrdinal,
            typeof defaultUnits === "number" ? defaultUnits : 1,
            requiredString(input, "startDate"),
            typeof priority === "number" ? priority : 50,
            typeof schedulingPolicy === "string" ? schedulingPolicy : "MANUAL",
            nullableInputString(input, "note"),
            timestamp,
          ],
          expectedRowsAffected: 1,
        },
      ];
      if (record(input, "createFirstInstance") === true) {
        const firstTask = await trackTaskInsertStatement(core, {
          trackId,
          studentId,
          templateVersionId: text(version, "id"),
          item: items[0],
          candidateDate: requiredString(input, "startDate"),
          durationOverride: null,
        });
        if (firstTask.outcome !== "CREATED") {
          throw new ApiError(
            409,
            firstTask.outcome === "NO_AVAILABLE_DATE"
              ? "90 天内没有可用学习日，无法生成轨道首项任务"
              : "该序号已有待完成任务",
            firstTask.outcome === "NO_AVAILABLE_DATE"
              ? "TRACK_NO_AVAILABLE_DATE"
              : "TRACK_ITEM_ALREADY_PENDING",
          );
        }
        statements.push(firstTask.statement);
      }
      statements.push(
        core.idempotencyStatement(idempotencyKey, "MOUNT_TRACK", trackId),
      );
      try {
        await core.storage.transaction(statements);
      } catch (error) {
        localError(error);
      }
      return getTrack(core, trackId);
    },
    (value) => getTrack(core, String(value)),
  );
}

function trackView(row: DbRow, stalled: Set<string>): Record<string, unknown> {
  const startOrdinal = numberValue(row, "start_ordinal");
  const currentOrdinal = numberValue(row, "current_ordinal");
  // 开放型长期任务没有结束序号：totalUnits/percent 无定义，交由 UI 隐藏。
  const endOrdinal = nullableNumber(row, "end_ordinal");
  const totalUnits = endOrdinal == null ? null : endOrdinal - startOrdinal + 1;
  const completedUnits =
    totalUnits == null
      ? Math.max(0, currentOrdinal - startOrdinal)
      : Math.min(totalUnits, Math.max(0, currentOrdinal - startOrdinal));
  return {
    id: text(row, "id"),
    studentId: text(row, "student_id"),
    templateId: text(row, "template_id"),
    templateVersionId: nullableText(row, "template_version_id"),
    generationMode: nullableText(row, "generation_mode") ?? "ITEMIZED",
    definitionName: nullableText(row, "definition_name_snapshot"),
    titlePatternSnapshot: nullableText(row, "title_pattern_snapshot"),
    status: text(row, "status"),
    startOrdinal,
    currentOrdinal,
    endOrdinal,
    defaultUnitsPerSession: numberValue(row, "default_units_per_session"),
    startDate: text(row, "start_date"),
    nextCandidateDate: nullableText(row, "next_candidate_date"),
    priority: numberValue(row, "priority"),
    allowParallelItems: bool(row, "allow_parallel_items"),
    schedulingPolicy: nullableText(row, "scheduling_policy") ?? "MANUAL",
    durationOverrideMinutes: nullableNumber(row, "duration_override_minutes"),
    devicePolicyOverride: nullableText(row, "device_policy_override"),
    note: nullableText(row, "note"),
    completedAt: nullableText(row, "completed_at"),
    version: numberValue(row, "version"),
    updatedAt: text(row, "updated_at"),
    progress: {
      currentOrdinal,
      endOrdinal,
      completedUnits,
      totalUnits,
      percent:
        totalUnits == null || totalUnits === 0
          ? null
          : Math.round((completedUnits / totalUnits) * 100),
    },
    warnings: stalled.has(text(row, "id"))
      ? ["没有待完成任务，下一项未排期"]
      : [],
  };
}

export async function getTrackRow(
  core: LocalCore,
  trackId: string,
): Promise<DbRow> {
  const rows = await core.storage.select<DbRow>(
    "SELECT * FROM student_task_track WHERE id = $1",
    [trackId],
  );
  if (!rows[0]) throw new ApiError(404, "任务轨道不存在", "TRACK_NOT_FOUND");
  return rows[0];
}

/**
 * 生成轨道任务行的三态结果。前两态过去都是 null，调用方分不清"正常去重"
 * 和"排不出下一项"——挂载路径要抛 409，完成路径不能抛但必须让人看见。
 */
export type TaskInsert =
  | {
      outcome: "CREATED";
      statement: LocalSqlStatement;
      taskId: string;
      scheduledDate: string;
    }
  | { outcome: "ALREADY_PENDING" }
  | { outcome: "NO_AVAILABLE_DATE" };

export async function trackTaskInsertStatement(
  core: LocalCore,
  input: {
    trackId: string;
    studentId: string;
    templateVersionId: string;
    item: DbRow;
    candidateDate: string;
    durationOverride: number | null;
    manualOverride?: boolean;
    overrideReason?: string | null;
  },
): Promise<TaskInsert> {
  const existing = await core.storage.select<DbRow>(
    `SELECT id FROM task_instance
     WHERE track_id = $1 AND template_item_id = $2 AND status = 'PENDING' LIMIT 1`,
    [input.trackId, text(input.item, "id")],
  );
  if (existing[0]) return { outcome: "ALREADY_PENDING" };
  const calendar = await core.studentCalendar(
    input.studentId,
    input.candidateDate,
    shiftDate(input.candidateDate, 90),
  );
  const requiresDevice =
    input.item.requires_device == null
      ? false
      : bool(input.item, "requires_device");
  const availability = resolveStudyAvailability(calendar, input.candidateDate);
  const candidateAllowed =
    availability.available &&
    (!requiresDevice || availability.devicePolicy === "ALLOWED");
  const scheduledDate = candidateAllowed
    ? input.candidateDate
    : findNextAvailableStudyDate({
        calendar,
        afterDate: input.candidateDate,
        requiresDevice,
        horizonDays: STUDY_DATE_HORIZON_DAYS,
      });
  if (!scheduledDate) return { outcome: "NO_AVAILABLE_DATE" };
  const timestamp = now();
  const taskId = crypto.randomUUID();
  return {
    outcome: "CREATED",
    taskId,
    scheduledDate,
    statement: {
      sql: `INSERT INTO task_instance(
            id, student_id, source_type, track_id, template_version_id,
            template_item_id, item_ordinal, scheduled_date, original_scheduled_date,
            status, title_snapshot, short_title_snapshot,
            duration_minutes_snapshot, requires_device_snapshot,
            schedule_origin, manual_override, override_reason, locked, star,
            version, created_at, updated_at
          ) VALUES ($1, $2, 'TRACK', $3, $4, $5, $6, $7, $7, 'PENDING',
                    $8, $9, $10, $11, $12, $13, $14, 0, 0, 0, $15, $15)`,
      values: [
        taskId,
        input.studentId,
        input.trackId,
        input.templateVersionId,
        text(input.item, "id"),
        numberValue(input.item, "ordinal"),
        scheduledDate,
        text(input.item, "title"),
        nullableText(input.item, "short_title"),
        input.durationOverride ??
          nullableNumber(input.item, "duration_minutes"),
        requiresDevice,
        input.manualOverride ? "MANUAL" : "TRACK",
        input.manualOverride ?? false,
        input.manualOverride ? input.overrideReason : null,
        timestamp,
      ],
      expectedRowsAffected: 1,
    },
  };
}
