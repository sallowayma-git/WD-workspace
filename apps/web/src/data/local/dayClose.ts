//! 日结与顺延对账：批量顺延、启动补算漏跑的天，以及撤销顺延。

import { ApiError } from "../../lib/api/ApiError";
import type { LocalCore } from "./localCore";
import {
  nullableText,
  numberValue,
  requiredString,
  text,
  type DbRow,
} from "./rows";
import { now, parseDate } from "./dates";
import * as tasks from "./tasks";

/** 最近一次跑完日结的业务日，用来判断离开期间漏了几天。 */
const LAST_DAY_CLOSE_SETTING_KEY = "day_close.last_business_date";

export async function triggerDayClose(
  core: LocalCore,
  businessDate: string,
): Promise<unknown> {
  parseDate(businessDate);
  const candidates = await core.storage.select<DbRow>(
    `SELECT t.id FROM task_instance t
     JOIN student s ON s.id = t.student_id
     WHERE s.status = 'ACTIVE'
       AND t.scheduled_date IS NOT NULL
       AND t.scheduled_date <= $1
       AND t.status = 'PENDING'
       AND t.locked = 0
     ORDER BY t.scheduled_date, COALESCE(t.sort_order, 2147483647), t.id`,
    [businessDate],
  );
  let carried = 0;
  let blocked = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const sourceTaskId = text(candidate, "id");
    try {
      const result = (await tasks.carryForwardTask(core, {
        sourceTaskId,
        targetDate: null,
        // 落点必须在业务日之后：漏了几天的任务顺延到昨天等于没顺延。
        notBeforeDate: businessDate,
        reason: `DAY_CLOSE:${businessDate}`,
      })) as Record<string, unknown>;
      const outcome =
        typeof result.status === "string" ? result.status : "SKIPPED";
      if (outcome === "CARRIED_OVER") carried += 1;
      else if (outcome === "BLOCKED") blocked += 1;
      else skipped += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    businessDate,
    scanned: candidates.length,
    carried,
    blocked,
    skipped,
    failed,
  };
}

/**
 * 桌面端没有服务器帮忙跨夜跑日结，所以启动时补一次：
 * triggerDayClose 扫的是 scheduled_date <= 业务日，离开几天也是一次扫完。
 */
export async function reconcileStartup(
  core: LocalCore,
  businessDate: string,
): Promise<unknown> {
  parseDate(businessDate);
  const previousDate = await core.settingValue(LAST_DAY_CLOSE_SETTING_KEY);
  if (previousDate === businessDate) {
    return { ran: false, previousDate, businessDate, summary: null };
  }
  const summary = await triggerDayClose(core, businessDate);
  // 整体抛错时不记账，下次启动重试；单项失败已经写在 summary 里，明天照样会被扫到。
  await core.putSetting(LAST_DAY_CLOSE_SETTING_KEY, businessDate);
  return { ran: true, previousDate, businessDate, summary };
}

export async function getTodayCarryovers(
  core: LocalCore,
  targetDate: string,
): Promise<unknown> {
  const rows = await core.storage.select<DbRow>(
    `SELECT source.id AS source_task_id, target.id AS target_task_id,
            source.student_id, s.name AS student_name,
            source.original_scheduled_date AS original_date,
            target.scheduled_date AS target_date, source.title_snapshot AS title,
            target.override_reason AS reason, target.schedule_origin,
            target.created_at AS executed_at, target.version
     FROM task_instance source
     JOIN task_instance target ON target.id = source.carried_to_instance_id
     JOIN student s ON s.id = source.student_id
     WHERE target.scheduled_date = $1 AND source.status = 'CARRIED_OVER'
     ORDER BY s.name, source.title_snapshot`,
    [targetDate],
  );
  return rows.map((row) => ({
    sourceTaskId: text(row, "source_task_id"),
    targetTaskId: nullableText(row, "target_task_id"),
    studentId: text(row, "student_id"),
    studentName: text(row, "student_name"),
    originalDate: nullableText(row, "original_date"),
    targetDate: nullableText(row, "target_date"),
    title: text(row, "title"),
    reason: nullableText(row, "reason"),
    scheduleOrigin: nullableText(row, "schedule_origin"),
    executedAt: nullableText(row, "executed_at"),
    version: numberValue(row, "version"),
  }));
}

export async function undoCarryover(
  core: LocalCore,
  input: Record<string, unknown>,
): Promise<unknown> {
  const idempotencyKey = requiredString(input, "idempotencyKey");
  const existing = await core.idempotentResult(idempotencyKey);
  if (existing.found) return existing.value;
  const source = await core.taskRow(requiredString(input, "sourceTaskId"));
  const targetId = nullableText(source, "carried_to_instance_id");
  if (!targetId || text(source, "status") !== "CARRIED_OVER") {
    throw new ApiError(409, "顺延关系不存在", "CARRYOVER_NOT_FOUND");
  }
  const target = await core.taskRow(targetId);
  const timestamp = now();
  const response = {
    sourceTaskId: text(source, "id"),
    targetTaskId: targetId,
    sourceStatus: "PENDING",
    targetStatus: "CANCELLED",
    reason: "UNDO_CARRYOVER",
  };
  await core.storage.transaction([
    {
      sql: `UPDATE task_instance SET status = 'PENDING', carried_to_instance_id = NULL,
            version = version + 1, updated_at = $1
            WHERE id = $2 AND status = 'CARRIED_OVER'`,
      values: [timestamp, text(source, "id")],
      expectedRowsAffected: 1,
    },
    {
      sql: `UPDATE task_instance SET status = 'CANCELLED', cancelled_at = $1,
            version = version + 1, updated_at = $1
            WHERE id = $2 AND version = $3 AND status = 'PENDING'`,
      values: [timestamp, text(target, "id"), numberValue(target, "version")],
      expectedRowsAffected: 1,
    },
    core.idempotencyStatement(idempotencyKey, "UNDO_CARRYOVER", response),
  ]);
  return response;
}
