//! 任务写命令：手工任务、完成/回退/改期/编辑，以及顺延、子任务与系列续接。

import { ApiError } from "../../lib/api/ApiError";
import { findNextAvailableStudyDate } from "../../domain/scheduling/availability";
import {
  completeTask as transitionCompleteTask,
  carryForwardTask as transitionCarryForwardTask,
  reopenTask as transitionReopenTask,
  rescheduleTask as transitionRescheduleTask,
} from "../../domain/task/taskTransitions";
import {
  formatSeriesTitle,
  isSameSeries,
  parseSeriesTitle,
  renderSeriesTitlePattern,
} from "../../domain/task/seriesTitle";
import type { LocalSqlStatement } from "./LocalStorage";
import { TASK_COLUMNS, type LocalCore } from "./localCore";
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
import {
  formatDate,
  now,
  optionalDateString,
  parseDate,
  shiftDate,
  STUDY_DATE_HORIZON_DAYS,
} from "./dates";
import * as tracks from "./tracks";
import * as longTasks from "./longTasks";

export async function createAdHocTask(
  core: LocalCore,
  input: Record<string, unknown>,
): Promise<unknown> {
  const idempotencyKey = requiredString(input, "idempotencyKey");
  return core.idempotentCommand(
    idempotencyKey,
    async () => {
      const studentId = requiredString(input, "studentId");
      await core.activeStudentRow(studentId);
      const scheduledDate = requiredString(input, "scheduledDate");
      // 日历有效性校验：2026-02-31 这类形状合法但不存在的日期必须在这里
      // 拒绝（422 INVALID_DATE），否则原样字符串入库后对排期/今日视图永远
      // 不可见，却仍会被日结的 scheduled_date <= 日期 字符串比较扫进来。
      parseDate(scheduledDate);
      const id = crypto.randomUUID();
      const timestamp = now();
      try {
        await core.storage.transaction([
          {
            sql: `INSERT INTO task_instance(
              id, student_id, source_type, scheduled_date, original_scheduled_date,
              status, title_snapshot, duration_minutes_snapshot,
              requires_device_snapshot, schedule_origin, locked, note,
              manual_override, star, version, created_at, updated_at
            ) SELECT $1, s.id, 'AD_HOC', $3, $3, 'PENDING', $4, $5, $6,
                      'AD_HOC', $7, $8, 0, 0, 0, $9, $9
                FROM student s WHERE s.id = $2 AND s.status = 'ACTIVE'
                  AND NOT EXISTS (
                    SELECT 1 FROM student_date_override rest
                    WHERE rest.student_id = s.id
                      AND rest.business_date = $3 AND rest.available = 0
                      AND rest.source_type = 'MANUAL' AND rest.note = '休息'
                  )`,
            values: [
              id,
              studentId,
              scheduledDate,
              requiredString(input, "title"),
              record(input, "durationMinutes") ?? null,
              record(input, "requiresDevice") ?? null,
              Boolean(record(input, "locked")),
              record(input, "note") ?? null,
              timestamp,
            ],
            expectedRowsAffected: 1,
          },
          core.idempotencyStatement(idempotencyKey, "CREATE_AD_HOC", {
            taskId: id,
          }),
        ]);
      } catch (error) {
        localError(error);
      }
      return core.getTaskView(id);
    },
    (value) => {
      const taskId = (value as { taskId?: unknown } | null)?.taskId;
      if (typeof taskId !== "string") {
        throw new ApiError(409, "幂等记录损坏", "LOCAL_DATABASE_ERROR");
      }
      return core.getTaskView(taskId);
    },
  );
}

export async function carryForwardTask(
  core: LocalCore,
  input: Record<string, unknown>,
): Promise<unknown> {
  const source = await core.taskRow(requiredString(input, "sourceTaskId"));
  const sourceSnapshot = core.taskSnapshot(source);
  const existingRows = await core.storage.select<DbRow>(
    `SELECT ${TASK_COLUMNS} FROM task_instance
     WHERE carried_from_instance_id = $1 AND status <> 'CANCELLED' LIMIT 1`,
    [sourceSnapshot.id],
  );
  const notBeforeDate = nullableInputString(input, "notBeforeDate");
  // 日历要盖到真正的起点之后 90 天，否则补日结跨的那几天会白吃掉窗口。
  const scanFrom =
    notBeforeDate && notBeforeDate > sourceSnapshot.scheduledDate
      ? notBeforeDate
      : sourceSnapshot.scheduledDate;
  const calendar = await core.studentCalendar(
    sourceSnapshot.studentId,
    sourceSnapshot.scheduledDate,
    shiftDate(scanFrom, 90),
  );
  try {
    const newTaskId = crypto.randomUUID();
    const result = transitionCarryForwardTask({
      source: sourceSnapshot,
      newTaskId,
      calendar,
      targetDate: nullableInputString(input, "targetDate") ?? undefined,
      notBeforeDate: notBeforeDate ?? undefined,
      reason: nullableInputString(input, "reason") ?? undefined,
      existingTarget: existingRows[0]
        ? core.taskSnapshot(existingRows[0])
        : undefined,
    });
    if (!result.changed && result.target == null) {
      return {
        sourceTaskId: sourceSnapshot.id,
        targetTaskId: null,
        targetDate: null,
        status: sourceSnapshot.status,
        reason: "NO_OP",
      };
    }
    const timestamp = now();
    const statements: LocalSqlStatement[] = [];
    if (!result.target) {
      statements.push({
        sql: `UPDATE task_instance SET status = 'BLOCKED', version = version + 1,
              updated_at = $1 WHERE id = $2 AND version = $3 AND status = 'PENDING'`,
        values: [timestamp, sourceSnapshot.id, sourceSnapshot.version],
        expectedRowsAffected: 1,
      });
    } else if (!existingRows[0]) {
      statements.push(
        {
          sql: `UPDATE task_instance SET status = 'CARRIED_OVER',
                version = version + 1, updated_at = $1
                WHERE id = $2 AND version = $3 AND status = 'PENDING' AND locked = 0`,
          values: [timestamp, sourceSnapshot.id, sourceSnapshot.version],
          expectedRowsAffected: 1,
        },
        {
          sql: `INSERT INTO task_instance(
                  id, student_id, source_type, track_id, template_version_id,
                  template_item_id, item_ordinal, scheduled_date, original_scheduled_date,
                  status, title_snapshot, short_title_snapshot,
                  duration_minutes_snapshot, requires_device_snapshot,
                  schedule_origin, manual_override, override_reason, locked, note,
                  carried_from_instance_id, parent_task_id, linked_parent_task_id,
                  priority, sort_order, star, version, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING',
                          $10, $11, $12, $13, 'CARRYOVER', 1, $14, $15, $16,
                          $17, $18, $19, $20, $21, $22, 0, $23, $23)`,
          values: [
            result.target.id,
            text(source, "student_id"),
            text(source, "source_type"),
            nullableText(source, "track_id"),
            nullableText(source, "template_version_id"),
            nullableText(source, "template_item_id"),
            nullableNumber(source, "item_ordinal"),
            result.target.scheduledDate,
            nullableText(source, "original_scheduled_date") ??
              sourceSnapshot.scheduledDate,
            text(source, "title_snapshot"),
            nullableText(source, "short_title_snapshot"),
            nullableNumber(source, "duration_minutes_snapshot"),
            source.requires_device_snapshot == null
              ? null
              : bool(source, "requires_device_snapshot"),
            result.target.overrideReason,
            bool(source, "locked"),
            nullableText(source, "note"),
            sourceSnapshot.id,
            nullableText(source, "parent_task_id"),
            nullableText(source, "linked_parent_task_id"),
            nullableText(source, "priority"),
            nullableNumber(source, "sort_order"),
            bool(source, "star"),
            timestamp,
          ],
          expectedRowsAffected: 1,
        },
        {
          sql: `UPDATE task_instance SET carried_to_instance_id = $1,
                updated_at = $2 WHERE id = $3 AND version = $4
                AND status = 'CARRIED_OVER'`,
          values: [
            result.target.id,
            timestamp,
            sourceSnapshot.id,
            sourceSnapshot.version + 1,
          ],
          expectedRowsAffected: 1,
        },
      );
    } else if (result.changed) {
      // 纵深防御（复核遗留③）：库里已有 carried_from 指向本源的行，但 domain
      // 判定它不可复用（非 PENDING 或学生/track/ordinal 不匹配），选择另建
      // newTaskId——而 INSERT 分支只在"库里没有既有行"时执行，此时 statements
      // 为空、newTaskId 从未落库，若照常返回就是把幽灵 id 当作 targetTaskId
      // 交给调用方。正常路径不可达（源行产生 carried_from 行时已转
      // CARRIED_OVER，不会再进这里），到达即数据脏，显式抛冲突而不是静默。
      throw new ApiError(
        409,
        "顺延目标与既有顺延行冲突，未写入新目标",
        "TASK_CARRY_TARGET_CONFLICT",
      );
    }
    if (statements.length > 0) await core.storage.transaction(statements);
    // 不变式：statements 为空意味着 domain 原样复用了既有顺延目标，本次
    // 没有任何写库动作，源行保持数据库里的当前状态。此时重读源行、以真实
    // status 作答，而不是硬编码 CARRIED_OVER——正常路径下源行此时必然已是
    // CARRIED_OVER，这道防御只兜"源行异常仍 PENDING"的脏状态（审计
    // E MINOR-5）。
    const responseStatus =
      statements.length === 0
        ? text(await core.taskRow(sourceSnapshot.id), "status")
        : result.target
          ? "CARRIED_OVER"
          : "BLOCKED";
    return {
      sourceTaskId: sourceSnapshot.id,
      targetTaskId: result.target?.id ?? null,
      targetDate: result.target?.scheduledDate ?? null,
      status: responseStatus,
      reason: result.target
        ? nullableInputString(input, "reason")
        : "90 天内没有符合学习日和设备规则的目标日期",
    };
  } catch (error) {
    localError(error);
  }
}

/**
 * 本机单用户产品里，前端传来的 expectedVersion 与数据库不一致只可能是界面缓存
 * 陈旧，不存在两个人抢同一条任务。所以写命令以数据库当前版本为准直接执行，而
 * 不是把陈旧缓存当成冲突去拦住用户的操作。`AND version = ?` 仍然保留，用来保证
 * 同一事务内读到的行没有在中途被改写。
 */
async function currentVersion(
  core: LocalCore,
  taskId: string,
): Promise<number> {
  return numberValue(await core.taskRow(taskId), "version");
}

export async function completeTask(
  core: LocalCore,
  input: Record<string, unknown>,
): Promise<unknown> {
  const idempotencyKey = requiredString(input, "idempotencyKey");
  const existing = await core.idempotentResult(idempotencyKey);
  if (existing.found) return existing.value;
  const task = await core.taskRow(requiredString(input, "taskId"));
  const track = await core.trackSnapshot(task);
  try {
    const result = transitionCompleteTask(
      core.taskSnapshot(task),
      track?.snapshot,
      idempotencyKey,
    );
    const timestamp = now();
    const response = {
      taskId: text(task, "id"),
      status: result.task.status,
      currentOrdinal: result.track?.currentOrdinal ?? null,
      // 接排失败不能把"已完成"变成失败，改用一句话把断点带回 UI。
      chainWarning: null as string | null,
    };
    const statements: LocalSqlStatement[] = [
      {
        sql: `UPDATE task_instance SET status = 'COMPLETED', completed_at = $1,
              version = version + 1, updated_at = $1
              WHERE id = $2 AND version = $3 AND status = 'PENDING'`,
        values: [timestamp, text(task, "id"), numberValue(task, "version")],
        expectedRowsAffected: 1,
      },
    ];
    if (track && result.track) {
      const endOrdinal = track.snapshot.endOrdinal;
      // 有限型越过结束序号即完成轨道；开放型永远 ACTIVE（AC-LT-005）。
      const finished =
        endOrdinal != null && result.track.currentOrdinal > endOrdinal;
      statements.push({
        sql: `UPDATE student_task_track SET current_ordinal = $1,
              status = $2, completed_at = $3, version = version + 1,
              updated_at = $4 WHERE id = $5 AND version = $6`,
        values: [
          result.track.currentOrdinal,
          finished ? "COMPLETED" : "ACTIVE",
          finished ? timestamp : null,
          timestamp,
          track.id,
          track.version,
        ],
        expectedRowsAffected: 1,
      });
      if (!finished) {
        if (nullableText(track.row, "generation_mode") === "SEQUENCE") {
          // 完成即推进：下一项由轨道快照里的标题模板渲染出来，直接落成
          // PENDING 任务（落在下一可学习日），用户无需再手动排一次。
          const nextTask = await longTasks.sequenceTaskInsertStatement(core, {
            trackId: track.id,
            studentId: text(track.row, "student_id"),
            ordinal: result.track.currentOrdinal,
            title: renderSeriesTitlePattern(
              text(track.row, "title_pattern_snapshot"),
              result.track.currentOrdinal,
            ),
            candidateDate: shiftDate(result.task.scheduledDate, 1),
            durationOverride: nullableNumber(
              track.row,
              "duration_override_minutes",
            ),
          });
          if (nextTask.outcome === "CREATED") {
            statements.push(nextTask.statement);
          } else if (nextTask.outcome === "NO_AVAILABLE_DATE") {
            response.chainWarning = `第 ${result.track.currentOrdinal} 项在 90 天内排不到可学习日，长期任务已停在这里，请调整常规周或手动排期`;
          }
        } else {
          const nextItems = await core.storage.select<DbRow>(
            `SELECT * FROM task_template_item
             WHERE template_version_id = $1 AND ordinal = $2 AND active = 1`,
            [
              text(track.row, "template_version_id"),
              result.track.currentOrdinal,
            ],
          );
          if (nextItems[0]) {
            const nextTask = await tracks.trackTaskInsertStatement(core, {
              trackId: track.id,
              studentId: text(track.row, "student_id"),
              templateVersionId: text(track.row, "template_version_id"),
              item: nextItems[0],
              candidateDate: shiftDate(result.task.scheduledDate, 1),
              durationOverride: nullableNumber(
                track.row,
                "duration_override_minutes",
              ),
            });
            if (nextTask.outcome === "CREATED") {
              statements.push(nextTask.statement);
            } else if (nextTask.outcome === "NO_AVAILABLE_DATE") {
              response.chainWarning = `第 ${result.track.currentOrdinal} 项在 90 天内排不到可学习日，轨道已停在这里，请调整常规周或手动排期`;
            }
          }
        }
      }
    }
    statements.push(
      core.idempotencyStatement(idempotencyKey, "COMPLETE_TASK", response),
    );
    await core.storage.transaction(statements);
    return response;
  } catch (error) {
    const replay = await core.idempotentResult(idempotencyKey);
    if (replay.found) return replay.value;
    localError(error);
  }
}

export async function reopenTask(
  core: LocalCore,
  input: Record<string, unknown>,
): Promise<unknown> {
  const idempotencyKey = requiredString(input, "idempotencyKey");
  const existing = await core.idempotentResult(idempotencyKey);
  if (existing.found) return existing.value;
  const task = await core.taskRow(requiredString(input, "taskId"));
  const track = await core.trackSnapshot(task);
  try {
    const result = transitionReopenTask(
      core.taskSnapshot(task),
      track?.snapshot,
    );
    const timestamp = now();
    const statements: LocalSqlStatement[] = [
      {
        sql: `UPDATE task_instance SET status = 'PENDING', completed_at = NULL,
              version = version + 1, updated_at = $1
              WHERE id = $2 AND version = $3 AND status = 'COMPLETED'`,
        values: [timestamp, text(task, "id"), numberValue(task, "version")],
        expectedRowsAffected: 1,
      },
    ];
    if (track && result.track) {
      statements.push({
        sql: `UPDATE student_task_track SET current_ordinal = $1, status = 'ACTIVE',
              completed_at = NULL, version = version + 1, updated_at = $2
              WHERE id = $3 AND version = $4`,
        values: [
          result.track.currentOrdinal,
          timestamp,
          track.id,
          track.version,
        ],
        expectedRowsAffected: 1,
      });
    }
    const response = { taskId: text(task, "id"), status: "PENDING" };
    statements.push(
      core.idempotencyStatement(idempotencyKey, "REOPEN_TASK", response),
    );
    await core.storage.transaction(statements);
    return response;
  } catch (error) {
    localError(error);
  }
}

export async function rescheduleTask(
  core: LocalCore,
  input: Record<string, unknown>,
): Promise<unknown> {
  const task = await core.taskRow(requiredString(input, "taskId"));
  const targetDate = requiredString(input, "targetDate");
  // 与 createAdHocTask 同一口径：改期目标必须是真实存在的日历日。
  parseDate(targetDate);
  const targetStudentId =
    nullableInputString(input, "targetStudentId") ?? text(task, "student_id");
  // 学习日日历按目标学生取：跨学生移动时要用接收方的学习日规则判断。
  const calendar = await core.studentCalendar(
    targetStudentId,
    targetDate,
    targetDate,
  );
  try {
    const result = transitionRescheduleTask({
      task: core.taskSnapshot(task),
      targetDate,
      targetStudentId,
      calendar,
      overrideReason: nullableInputString(input, "overrideReason") ?? undefined,
    });
    const timestamp = now();
    await core.storage.transaction([
      {
        // status 走 $7（domain 计算结果）：完成状态保持不变，唯一的变更
        // 是 BLOCKED → PENDING——改期是 PRD §7.1 里阻塞任务唯一的人工
        // 出口，落到有效日期即解除阻塞。改期不推进 Track。
        // 跨学生时（student_id <> $2 对比的是更新前的旧值）清空模板三列与
        // parent_task_id / linked_parent_task_id：不能把一个学生的父子关系
        // 挂到另一个学生身上。长期任务的实例本身已在 domain 层禁止换人。
        sql: `UPDATE task_instance SET scheduled_date = $1, student_id = $2,
              source_type = CASE WHEN student_id <> $2 THEN 'AD_HOC' ELSE source_type END,
              track_id = $3, template_version_id = CASE WHEN student_id <> $2 THEN NULL ELSE template_version_id END,
              template_item_id = CASE WHEN student_id <> $2 THEN NULL ELSE template_item_id END,
              parent_task_id = CASE WHEN student_id <> $2 THEN NULL ELSE parent_task_id END,
              linked_parent_task_id = CASE WHEN student_id <> $2 THEN NULL ELSE linked_parent_task_id END,
              item_ordinal = $4, schedule_origin = $5, manual_override = 1,
              override_reason = $6, status = $7, version = version + 1, updated_at = $8
              WHERE id = $9 AND version = $10`,
        values: [
          result.scheduledDate,
          result.studentId,
          result.trackId,
          result.itemOrdinal,
          result.scheduleOrigin,
          result.overrideReason,
          result.status,
          timestamp,
          text(task, "id"),
          numberValue(task, "version"),
        ],
        expectedRowsAffected: 1,
      },
    ]);
    return null;
  } catch (error) {
    localError(error);
  }
}

export async function updateTask(
  core: LocalCore,
  taskId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const version = requiredNumber(input, "expectedVersion");
  const timestamp = now();
  try {
    await core.storage.transaction([
      {
        sql: `UPDATE task_instance SET
              title_snapshot = COALESCE($1, title_snapshot),
              short_title_snapshot = CASE WHEN $1 IS NOT NULL THEN NULL ELSE short_title_snapshot END,
              note = CASE WHEN $2 IS NULL THEN note ELSE $2 END,
              priority = CASE WHEN $3 IS NULL THEN priority ELSE $3 END,
              star = CASE WHEN $4 IS NULL THEN star ELSE $4 END,
              version = version + 1, updated_at = $5
              WHERE id = $6 AND version = $7 AND locked = 0
                AND status NOT IN ('CARRIED_OVER', 'CANCELLED')`,
        values: [
          nullableInputString(input, "title"),
          record(input, "note") ?? null,
          record(input, "priority") ?? null,
          record(input, "star") ?? null,
          timestamp,
          taskId,
          version,
        ],
        expectedRowsAffected: 1,
      },
    ]);
  } catch (error) {
    localError(error);
  }
  return core.getTaskView(taskId);
}

export async function duplicateTask(
  core: LocalCore,
  taskId: string,
  input: Record<string, unknown>,
): Promise<void> {
  const source = await core.taskRow(taskId);
  const targetDate = optionalDateString(input, "targetDate");
  const timestamp = now();
  await core.storage.transaction([
    {
      sql: `INSERT INTO task_instance(
              id, student_id, source_type, scheduled_date, original_scheduled_date,
              status, title_snapshot, short_title_snapshot,
              duration_minutes_snapshot, requires_device_snapshot,
              schedule_origin, manual_override, locked, note, priority,
              sort_order, star, version, created_at, updated_at
            ) VALUES ($1, $2, 'AD_HOC', $3, $3, 'PENDING', $4, $5, $6,
                      $7, 'AD_HOC', 0, 0, $8, $9, $10, $11, 0, $12, $12)`,
      values: [
        crypto.randomUUID(),
        text(source, "student_id"),
        targetDate ?? nullableText(source, "scheduled_date"),
        text(source, "title_snapshot"),
        nullableText(source, "short_title_snapshot"),
        nullableNumber(source, "duration_minutes_snapshot"),
        source.requires_device_snapshot == null
          ? null
          : bool(source, "requires_device_snapshot"),
        nullableText(source, "note"),
        nullableText(source, "priority"),
        nullableNumber(source, "sort_order"),
        bool(source, "star"),
        timestamp,
      ],
      expectedRowsAffected: 1,
    },
  ]);
}

/**
 * 序号取同一学生同前缀已出现的最大值 +1，所以从系列任意一项点「继续」都接在
 * 全局队尾；标题没有尾部数字时退化为普通复制。新行是独立的 AD_HOC 任务。
 * 排期规则和长期任务轨道同一条：落在下一个可学习日，不是下一个日历日——
 * 「继续这个系列」是长期任务的手动版本，两边算出不同的日子就前后不一致了。
 */
export async function createNextSeriesTask(
  core: LocalCore,
  taskId: string,
  input: Record<string, unknown> = {},
): Promise<unknown> {
  const source = await core.taskRow(taskId);
  const sourceDate =
    nullableText(source, "scheduled_date") ?? formatDate(new Date());
  const requiresDevice =
    source.requires_device_snapshot == null
      ? false
      : bool(source, "requires_device_snapshot");
  const calendar = await core.studentCalendar(
    text(source, "student_id"),
    sourceDate,
    shiftDate(sourceDate, STUDY_DATE_HORIZON_DAYS),
  );
  const targetDate = findNextAvailableStudyDate({
    calendar,
    afterDate: sourceDate,
    requiresDevice,
    horizonDays: STUDY_DATE_HORIZON_DAYS,
  });
  if (!targetDate) {
    throw new ApiError(
      409,
      `未来 ${STUDY_DATE_HORIZON_DAYS} 天内没有可学习日，无法接排下一项`,
      "NO_AVAILABLE_STUDY_DATE",
    );
  }
  const numberIndex =
    record(input, "numberIndex") != null
      ? requiredNumber(input, "numberIndex")
      : undefined;
  const parsed = parseSeriesTitle(text(source, "title_snapshot"), numberIndex);
  let title = text(source, "title_snapshot");
  let shortTitle = nullableText(source, "short_title_snapshot");
  if (parsed) {
    // 任务量是本机单学生的量级，直接全量拉标题在内存里比对，避免 LIKE
    // 转义 %/_ 的坑。CANCELLED 行也计入最大值：序号已被占用就不复用。
    const rows = await core.storage.select<DbRow>(
      `SELECT title_snapshot FROM task_instance WHERE student_id = $1`,
      [text(source, "student_id")],
    );
    let max = parsed.number;
    for (const row of rows) {
      const candidate = parseSeriesTitle(
        text(row, "title_snapshot"),
        numberIndex,
      );
      if (candidate && isSameSeries(candidate, parsed)) {
        max = Math.max(max, candidate.number);
      }
    }
    title = formatSeriesTitle(parsed, max + 1);
    // 短标题若是同一系列的编号形式（“真题24”之于“真题2024”），按主标题
    // 前进的增量同步 +1，保持缩写关系；其他形态原样保留。
    const shortParsed = shortTitle
      ? parseSeriesTitle(shortTitle, numberIndex)
      : null;
    if (shortTitle && shortParsed && isSameSeries(shortParsed, parsed)) {
      shortTitle = formatSeriesTitle(
        shortParsed,
        shortParsed.number + (max + 1 - parsed.number),
      );
    }
  }
  const id = crypto.randomUUID();
  const timestamp = now();
  await core.storage.transaction([
    {
      sql: `INSERT INTO task_instance(
              id, student_id, source_type, scheduled_date, original_scheduled_date,
              status, title_snapshot, short_title_snapshot,
              duration_minutes_snapshot, requires_device_snapshot,
              schedule_origin, manual_override, locked, note, priority,
              sort_order, star, version, created_at, updated_at
            ) VALUES ($1, $2, 'AD_HOC', $3, $3, 'PENDING', $4, $5, $6,
                      $7, 'AD_HOC', 0, 0, $8, $9, $10, $11, 0, $12, $12)`,
      values: [
        id,
        text(source, "student_id"),
        targetDate,
        title,
        shortTitle,
        nullableNumber(source, "duration_minutes_snapshot"),
        source.requires_device_snapshot == null
          ? null
          : bool(source, "requires_device_snapshot"),
        nullableText(source, "note"),
        nullableText(source, "priority"),
        nullableNumber(source, "sort_order"),
        bool(source, "star"),
        timestamp,
      ],
      expectedRowsAffected: 1,
    },
  ]);
  return core.getTaskView(id);
}

export async function createSubTask(
  core: LocalCore,
  parentTaskId: string,
  input: Record<string, unknown>,
): Promise<void> {
  const parent = await core.taskRow(parentTaskId);
  const scheduledDate = optionalDateString(input, "scheduledDate");
  const timestamp = now();
  await core.storage.transaction([
    {
      sql: `INSERT INTO task_instance(
              id, student_id, source_type, scheduled_date, original_scheduled_date,
              status, title_snapshot, schedule_origin, manual_override, locked,
              parent_task_id, priority, star, version, created_at, updated_at
            ) VALUES ($1, $2, 'AD_HOC', $3, $3, 'PENDING', $4, 'AD_HOC',
                      0, 0, $5, $6, 0, 0, $7, $7)`,
      values: [
        crypto.randomUUID(),
        text(parent, "student_id"),
        scheduledDate ?? nullableText(parent, "scheduled_date"),
        requiredString(input, "title"),
        parentTaskId,
        nullableInputString(input, "priority"),
        timestamp,
      ],
      expectedRowsAffected: 1,
    },
  ]);
}

export async function linkMainTask(
  core: LocalCore,
  taskId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const linkedParentTaskId = requiredString(input, "linkedParentTaskId");
  await core.taskRow(linkedParentTaskId);
  const version = await currentVersion(core, taskId);
  try {
    await core.storage.transaction([
      {
        sql: `UPDATE task_instance SET linked_parent_task_id = $1,
              version = version + 1, updated_at = $2
              WHERE id = $3 AND version = $4`,
        values: [linkedParentTaskId, now(), taskId, version],
        expectedRowsAffected: 1,
      },
    ]);
  } catch (error) {
    localError(error);
  }
  return core.getTaskView(taskId);
}

export async function deleteTask(
  core: LocalCore,
  taskId: string,
  input: Record<string, unknown>,
): Promise<void> {
  const expectedVersion = requiredNumber(input, "expectedVersion");
  const task = await core.taskRow(taskId);
  const status = text(task, "status");
  if (status === "CARRIED_OVER" || status === "CANCELLED") {
    throw new ApiError(409, "历史任务不可删除", "TASK_NOT_DELETABLE");
  }
  const statements: LocalSqlStatement[] = [];
  const timestamp = now();

  // 顺延链的两个指针都是 task_instance 的外键，且没有 ON DELETE 规则。删除前
  // 必须把指向本行的对侧指针清空，否则 SQLite 会因为外键仍被引用而拒绝删除 ——
  // 这正是"顺延后的任务删不掉，只报本地数据操作失败"的原因。
  const carriedFrom = nullableText(task, "carried_from_instance_id");
  if (carriedFrom) {
    statements.push({
      sql: `UPDATE task_instance SET carried_to_instance_id = NULL,
            updated_at = $1 WHERE id = $2`,
      values: [timestamp, carriedFrom],
    });
  }
  const carriedTo = nullableText(task, "carried_to_instance_id");
  if (carriedTo) {
    statements.push({
      sql: `UPDATE task_instance SET carried_from_instance_id = NULL,
            updated_at = $1 WHERE id = $2`,
      values: [timestamp, carriedTo],
    });
  }

  statements.push({
    // 顺延目标可能继承 TRACK 来源，但只要仍是可操作的 PENDING 任务就允许删除。
    // expectedVersion 必须来自调用方，避免旧卡片误删已经更新过的数据。
    sql: `DELETE FROM task_instance WHERE id = $1 AND version = $2`,
    values: [taskId, expectedVersion],
    expectedRowsAffected: 1,
  });

  try {
    await core.storage.transaction(statements);
  } catch (error) {
    localError(error);
  }
}

export async function reorderTask(
  core: LocalCore,
  taskId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const version = await currentVersion(core, taskId);
  try {
    await core.storage.transaction([
      {
        sql: `UPDATE task_instance SET sort_order = $1,
              version = version + 1, updated_at = $2
              WHERE id = $3 AND version = $4`,
        values: [requiredNumber(input, "newSortOrder"), now(), taskId, version],
        expectedRowsAffected: 1,
      },
    ]);
  } catch (error) {
    localError(error);
  }
  return core.getTaskView(taskId);
}
