//! 各领域模块共享的读路径：只放跨模块复用的行读取、日历与幂等 helper。
//! 领域模块拿 LocalCore 当第一个参数，不再互相依赖。

import { ApiError } from "../../lib/api/ApiError";
import type {
  AvailabilityCalendar,
  StudyDateOverride,
  WeeklyStudyDay,
} from "../../domain/scheduling/availability";
import type {
  TaskInstanceSnapshot,
  TrackSnapshot,
} from "../../domain/task/taskTransitions";
import type { LocalSqlStatement, LocalStorage } from "./LocalStorage";
import {
  bool,
  nullableNumber,
  nullableText,
  numberValue,
  text,
  type DbRow,
} from "./rows";
import { formatDate, now } from "./dates";

export const TASK_COLUMNS = `
  id, student_id, source_type, track_id, template_version_id,
  template_item_id, item_ordinal, scheduled_date, original_scheduled_date,
  status, title_snapshot, short_title_snapshot, duration_minutes_snapshot,
  requires_device_snapshot, schedule_origin, manual_override, override_reason,
  locked, note, carried_from_instance_id, carried_to_instance_id,
  completed_at, cancelled_at, parent_task_id, linked_parent_task_id,
  priority, sort_order, star, version, updated_at
`;

export class LocalCore {
  constructor(readonly storage: LocalStorage) {}

  async activeStudents(): Promise<DbRow[]> {
    return this.storage.select<DbRow>(
      "SELECT * FROM student WHERE status = 'ACTIVE' ORDER BY name, student_code",
    );
  }

  async studentRow(studentId: string): Promise<DbRow> {
    const rows = await this.storage.select<DbRow>(
      "SELECT * FROM student WHERE id = $1",
      [studentId],
    );
    if (!rows[0]) throw new ApiError(404, "学生不存在", "STUDENT_NOT_FOUND");
    return rows[0];
  }

  /** 模板行是跨模块读路径：模板、轨道、长期任务都要先确认模板存在。 */
  async templateRow(templateId: string): Promise<DbRow> {
    const rows = await this.storage.select<DbRow>(
      "SELECT * FROM task_template WHERE id = $1",
      [templateId],
    );
    if (!rows[0]) {
      throw new ApiError(404, "任务模板不存在", "TEMPLATE_NOT_FOUND");
    }
    return rows[0];
  }

  async tasksBetween(
    from: string,
    to: string,
    studentId?: string,
  ): Promise<DbRow[]> {
    // INT-CAL-009 同日排序：星标优先 → 优先级（HIGH<MEDIUM<LOW，NONE/未设置
    // 沉底）→ 手动 sortOrder → 创建时间。carried_from_date 子查询解析顺延
    // 来源行的原排期日期，供三个投影渲染 DLY-022 的"由 YYYY-MM-DD 顺延"。
    // TodayPage.sortBySortOrder 保持同一权重链，别只改一头。
    return this.storage.select<DbRow>(
      `SELECT ${TASK_COLUMNS},
              (SELECT src.scheduled_date FROM task_instance src
               WHERE src.id = t.carried_from_instance_id) AS carried_from_date
       FROM task_instance t
       WHERE t.scheduled_date BETWEEN $1 AND $2
         AND t.status <> 'CANCELLED'
         ${studentId ? "AND t.student_id = $3" : ""}
       ORDER BY t.scheduled_date, t.star DESC,
                CASE t.priority WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1
                                 WHEN 'LOW' THEN 2 ELSE 3 END,
                COALESCE(t.sort_order, 2147483647), t.created_at`,
      studentId ? [from, to, studentId] : [from, to],
    );
  }

  taskSummary(row: DbRow): Record<string, unknown> {
    return {
      id: text(row, "id"),
      title: text(row, "title_snapshot"),
      shortTitle: nullableText(row, "short_title_snapshot"),
      note: nullableText(row, "note"),
      status: text(row, "status"),
      sourceType: text(row, "source_type"),
      trackId: nullableText(row, "track_id"),
      itemOrdinal: nullableNumber(row, "item_ordinal"),
      durationMinutes: nullableNumber(row, "duration_minutes_snapshot"),
      locked: bool(row, "locked"),
      carriedOver: text(row, "status") === "CARRIED_OVER",
      // DLY-022: 顺延来源行的原排期日期；tasksBetween 子查询列，其余调用方
      // 没有该列时回落 null。
      carriedFromDate: nullableText(row, "carried_from_date"),
      scheduledDate: nullableText(row, "scheduled_date"),
      version: numberValue(row, "version"),
      parentTaskId: nullableText(row, "parent_task_id"),
      linkedParentTaskId: nullableText(row, "linked_parent_task_id"),
      priority: nullableText(row, "priority"),
      sortOrder: nullableNumber(row, "sort_order"),
      star: bool(row, "star"),
    };
  }

  workbenchTaskSummary(row: DbRow): Record<string, unknown> {
    const summary = this.taskSummary(row);
    return { ...summary, shortTitle: summary.shortTitle ?? summary.title };
  }

  async availabilityCalendars(
    students: DbRow[],
    from: string,
    to: string,
  ): Promise<Map<string, AvailabilityCalendar>> {
    const weeklyRows = await this.storage.select<DbRow>(
      `SELECT p.student_id, d.day_of_week, d.available, d.available_minutes,
              d.device_policy_override
       FROM student_weekly_pattern p
       JOIN student_weekly_pattern_day d ON d.pattern_id = p.id
       WHERE p.status = 'ACTIVE'`,
    );
    const overrideRows = await this.storage.select<DbRow>(
      `SELECT student_id, business_date, available, available_minutes,
              device_policy_override
       FROM student_date_override WHERE business_date BETWEEN $1 AND $2`,
      [from, to],
    );
    const result = new Map<string, AvailabilityCalendar>();
    for (const student of students) {
      const studentId = text(student, "id");
      const weekly: WeeklyStudyDay[] = weeklyRows
        .filter((row) => text(row, "student_id") === studentId)
        .map((row) => ({
          dayOfWeek: numberValue(row, "day_of_week"),
          enabled: bool(row, "available"),
          availableMinutes: numberValue(row, "available_minutes"),
          devicePolicy: nullableText(row, "device_policy_override") as
            "ALLOWED" | "NOT_ALLOWED" | "CONFIRM" | null,
        }));
      const overrides: StudyDateOverride[] = overrideRows
        .filter((row) => text(row, "student_id") === studentId)
        .map((row) => ({
          date: text(row, "business_date"),
          available: bool(row, "available"),
          availableMinutes: numberValue(row, "available_minutes"),
          devicePolicy: nullableText(row, "device_policy_override") as
            "ALLOWED" | "NOT_ALLOWED" | "CONFIRM" | null,
        }));
      result.set(studentId, {
        weekly,
        overrides,
        defaultDevicePolicy: text(student, "default_device_policy") as
          "ALLOWED" | "NOT_ALLOWED" | "CONFIRM",
      });
    }
    return result;
  }

  async studentCalendar(
    studentId: string,
    from: string,
    to: string,
  ): Promise<AvailabilityCalendar> {
    const student = await this.studentRow(studentId);
    return (await this.availabilityCalendars([student], from, to)).get(
      studentId,
    )!;
  }

  async vocabularyCounts(
    from: string,
    to: string,
  ): Promise<Map<string, number>> {
    const rows = await this.storage.select<DbRow>(
      `SELECT student_id, COUNT(*) AS count FROM vocabulary_entry
       WHERE occurred_date BETWEEN $1 AND $2 GROUP BY student_id`,
      [from, to],
    );
    return new Map(
      rows.map((row) => [text(row, "student_id"), numberValue(row, "count")]),
    );
  }

  async taskRow(taskId: string): Promise<DbRow> {
    const rows = await this.storage.select<DbRow>(
      `SELECT ${TASK_COLUMNS} FROM task_instance WHERE id = $1`,
      [taskId],
    );
    if (!rows[0]) throw new ApiError(404, "任务不存在", "TASK_NOT_FOUND");
    return rows[0];
  }

  async getTaskView(taskId: string): Promise<Record<string, unknown>> {
    const row = await this.taskRow(taskId);
    return {
      id: text(row, "id"),
      studentId: text(row, "student_id"),
      sourceType: text(row, "source_type"),
      trackId: nullableText(row, "track_id"),
      templateVersionId: nullableText(row, "template_version_id"),
      templateItemId: nullableText(row, "template_item_id"),
      itemOrdinal: nullableNumber(row, "item_ordinal"),
      scheduledDate: nullableText(row, "scheduled_date"),
      originalScheduledDate: nullableText(row, "original_scheduled_date"),
      status: text(row, "status"),
      titleSnapshot: text(row, "title_snapshot"),
      shortTitleSnapshot: nullableText(row, "short_title_snapshot"),
      durationMinutesSnapshot: nullableNumber(row, "duration_minutes_snapshot"),
      requiresDeviceSnapshot:
        row.requires_device_snapshot == null
          ? null
          : bool(row, "requires_device_snapshot"),
      scheduleOrigin: nullableText(row, "schedule_origin"),
      manualOverride: bool(row, "manual_override"),
      overrideReason: nullableText(row, "override_reason"),
      locked: bool(row, "locked"),
      note: nullableText(row, "note"),
      carriedFromInstanceId: nullableText(row, "carried_from_instance_id"),
      carriedToInstanceId: nullableText(row, "carried_to_instance_id"),
      completedAt: nullableText(row, "completed_at"),
      completedBy: null,
      cancelledAt: nullableText(row, "cancelled_at"),
      cancelledBy: null,
      parentTaskId: nullableText(row, "parent_task_id"),
      linkedParentTaskId: nullableText(row, "linked_parent_task_id"),
      priority: nullableText(row, "priority"),
      sortOrder: nullableNumber(row, "sort_order"),
      star: bool(row, "star"),
      version: numberValue(row, "version"),
      updatedAt: text(row, "updated_at"),
    };
  }

  taskSnapshot(row: DbRow): TaskInstanceSnapshot {
    return {
      id: text(row, "id"),
      studentId: text(row, "student_id"),
      title: text(row, "title_snapshot"),
      scheduledDate:
        nullableText(row, "scheduled_date") ?? formatDate(new Date()),
      status: text(row, "status") as TaskInstanceSnapshot["status"],
      version: numberValue(row, "version"),
      locked: bool(row, "locked"),
      requiresDevice:
        row.requires_device_snapshot == null
          ? undefined
          : bool(row, "requires_device_snapshot"),
      trackId: nullableText(row, "track_id"),
      itemOrdinal: nullableNumber(row, "item_ordinal"),
      scheduleOrigin: nullableText(row, "schedule_origin") as
        TaskInstanceSnapshot["scheduleOrigin"] | undefined,
      manualOverride: bool(row, "manual_override"),
      overrideReason: nullableText(row, "override_reason"),
      carriedFromInstanceId: nullableText(row, "carried_from_instance_id"),
      carriedToInstanceId: nullableText(row, "carried_to_instance_id"),
    };
  }

  async trackSnapshot(
    row: DbRow,
  ): Promise<
    | { id: string; version: number; row: DbRow; snapshot: TrackSnapshot }
    | undefined
  > {
    const trackId = nullableText(row, "track_id");
    const itemOrdinal = nullableNumber(row, "item_ordinal");
    if (!trackId || itemOrdinal == null) return undefined;
    const tracks = await this.storage.select<DbRow>(
      "SELECT * FROM student_task_track WHERE id = $1",
      [trackId],
    );
    if (!tracks[0]) return undefined;
    const completed = await this.storage.select<DbRow>(
      `SELECT DISTINCT item_ordinal FROM task_instance
       WHERE track_id = $1 AND status = 'COMPLETED' AND item_ordinal IS NOT NULL`,
      [trackId],
    );
    return {
      id: trackId,
      version: numberValue(tracks[0], "version"),
      row: tracks[0],
      snapshot: {
        currentOrdinal: numberValue(tracks[0], "current_ordinal"),
        endOrdinal: nullableNumber(tracks[0], "end_ordinal"),
        completedOrdinals: completed.map((item) =>
          numberValue(item, "item_ordinal"),
        ),
      },
    };
  }

  /** app_setting 是通用键值表，系列建议与日结都往里写。 */
  async settingValue(key: string): Promise<string | null> {
    const rows = await this.storage.select<DbRow>(
      `SELECT setting_value FROM app_setting WHERE setting_key = $1`,
      [key],
    );
    return rows[0] ? nullableText(rows[0], "setting_value") : null;
  }

  async putSetting(key: string, value: string): Promise<void> {
    await this.storage.transaction([
      {
        sql: `INSERT INTO app_setting(setting_key, setting_value, updated_at)
              VALUES ($1, $2, $3)
              ON CONFLICT(setting_key) DO UPDATE
                SET setting_value = excluded.setting_value,
                    updated_at = excluded.updated_at`,
        values: [key, value, now()],
        expectedRowsAffected: 1,
      },
    ]);
  }

  /** UI preferences are the only app settings exposed to feature code. */
  async getAppSetting(key: string): Promise<string | null> {
    if (!key.startsWith("ui.")) {
      throw new Error("Only ui.* app settings are accessible");
    }
    return this.settingValue(key);
  }

  async putAppSetting(key: string, value: string): Promise<void> {
    if (!key.startsWith("ui.")) {
      throw new Error("Only ui.* app settings are writable");
    }
    return this.putSetting(key, value);
  }

  async idempotentResult(
    key: string,
  ): Promise<{ found: false } | { found: true; value: unknown }> {
    const rows = await this.storage.select<DbRow>(
      "SELECT result_json FROM idempotency_record WHERE operation_key = $1",
      [key],
    );
    const value = rows[0]?.result_json;
    if (typeof value !== "string") return { found: false };
    return { found: true, value: JSON.parse(value) as unknown };
  }

  /** The command must record its result in the same transaction as its writes. */
  async idempotentCommand<T>(
    key: string,
    command: () => Promise<T>,
    hydrate: (value: unknown) => Promise<T>,
  ): Promise<T> {
    const existing = await this.idempotentResult(key);
    if (existing.found) return hydrate(existing.value);
    try {
      return await command();
    } catch (error) {
      // A concurrent request can commit before either a precheck or a write.
      const committed = await this.idempotentResult(key);
      if (committed.found) return hydrate(committed.value);
      throw error;
    }
  }

  idempotencyStatement(
    key: string,
    operationType: string,
    result: unknown,
  ): LocalSqlStatement {
    return {
      sql: `INSERT INTO idempotency_record(
              operation_key, operation_type, result_json, created_at
            ) VALUES ($1, $2, $3, $4)`,
      values: [key, operationType, JSON.stringify(result), now()],
      expectedRowsAffected: 1,
    };
  }
}
