//! 长期任务（SEQUENCE）：定义复用 task_template（generation_mode='SEQUENCE'）但不用
//! version/item；挂载后的轨道带定义快照，完成一项即按标题模板渲染下一项。

import { ApiError } from "../../lib/api/ApiError";
import {
  findNextAvailableStudyDate,
  resolveStudyAvailability,
} from "../../domain/scheduling/availability";
import {
  buildPlainTitlePattern,
  buildSeriesTitlePattern,
  parseSeriesTitle,
  renderSeriesTitlePattern,
  seriesDisplayName,
  seriesNormalizedKey,
} from "../../domain/task/seriesTitle";
import type { LocalSqlStatement } from "./LocalStorage";
import type { LocalCore } from "./localCore";
import {
  bool,
  localError,
  nullableInputNumber,
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
  shiftDate,
  STUDY_DATE_HORIZON_DAYS,
} from "./dates";
import * as tracks from "./tracks";
import type { TaskInsert } from "./tracks";

export async function listLongTasks(
  core: LocalCore,
  query?: string,
): Promise<unknown> {
  const normalized = query?.trim().toLocaleLowerCase();
  const rows = await core.storage.select<DbRow>(
    `SELECT t.*, (
       SELECT COUNT(*) FROM student_task_track stt
       WHERE stt.template_id = t.id
         AND stt.status IN ('NOT_STARTED', 'ACTIVE', 'PAUSED')
     ) AS active_track_count
     FROM task_template t
     WHERE t.generation_mode = 'SEQUENCE' AND t.status <> 'ARCHIVED'
     ${normalized ? "AND (lower(t.name) LIKE $1 OR lower(t.title_pattern) LIKE $1)" : ""}
     ORDER BY t.created_at DESC, t.name`,
    normalized ? [`%${normalized}%`] : [],
  );
  return {
    items: rows.map((row) => longTaskView(row)),
    page: 0,
    size: rows.length,
    total: rows.length,
    hasNext: false,
  };
}

export async function createLongTask(
  core: LocalCore,
  input: Record<string, unknown>,
): Promise<unknown> {
  const suppliedKey = record(input, "idempotencyKey");
  const idempotencyKey =
    typeof suppliedKey === "string" && suppliedKey.trim() !== ""
      ? suppliedKey
      : crypto.randomUUID();
  const existing = await core.idempotentResult(idempotencyKey);
  if (existing.found)
    return longTaskView(await getLongTaskRow(core, String(existing.value)));
  const sampleTitle = requiredString(input, "sampleTitle");
  const shape = sequencePatternFromTitle(sampleTitle);
  const startOrdinal =
    record(input, "startOrdinal") != null
      ? requiredNumber(input, "startOrdinal")
      : (shape.detectedOrdinal ?? 1);
  const endOrdinal =
    record(input, "endOrdinal") != null
      ? requiredNumber(input, "endOrdinal")
      : null;
  if (startOrdinal < 1) {
    throw new ApiError(422, "起始序号必须大于 0", "LONG_TASK_ORDINAL_INVALID");
  }
  if (endOrdinal != null && endOrdinal < startOrdinal) {
    throw new ApiError(
      422,
      "结束序号不能小于起始序号",
      "LONG_TASK_END_BEFORE_START",
    );
  }
  const id = crypto.randomUUID();
  try {
    await core.storage.transaction([
      sequenceDefinitionInsertStatement({
        id,
        name: shape.name,
        normalizedKey: shape.normalizedKey,
        titlePattern: shape.pattern,
        startOrdinal,
        endOrdinal,
        durationMinutes: nullableInputNumber(input, "defaultDurationMinutes"),
      }),
      core.idempotencyStatement(idempotencyKey, "CREATE_LONG_TASK", id),
    ]);
  } catch (error) {
    const replay = await core.idempotentResult(idempotencyKey);
    if (replay.found) {
      return longTaskView(await getLongTaskRow(core, String(replay.value)));
    }
    if (await findSequenceDefinitionByKey(core, shape.normalizedKey)) {
      throw new ApiError(409, "已存在同名长期任务", "LONG_TASK_ALREADY_EXISTS");
    }
    localError(error);
  }
  return longTaskView(await getLongTaskRow(core, id));
}

/** 单个长期任务定义（编辑页读取用）。 */
export async function getLongTask(
  core: LocalCore,
  templateId: string,
): Promise<unknown> {
  return longTaskView(await getLongTaskRow(core, templateId));
}

/**
 * 编辑长期任务定义。已挂载学生的轨道持有名称/标题模板/起止序号快照，编辑
 * 定义不会回写他们的历史任务——改的是"以后新挂载的人看到什么"。
 */
export async function updateLongTask(
  core: LocalCore,
  templateId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const existing = await getLongTaskRow(core, templateId);
  if (text(existing, "generation_mode") !== "SEQUENCE") {
    throw new ApiError(
      422,
      "该任务定义不是长期任务（序号生成型）",
      "LONG_TASK_MODE_MISMATCH",
    );
  }
  const shape = sequencePatternFromTitle(requiredString(input, "sampleTitle"));
  const startOrdinal =
    record(input, "startOrdinal") != null
      ? requiredNumber(input, "startOrdinal")
      : (shape.detectedOrdinal ??
        numberValue(existing, "default_start_ordinal"));
  const endOrdinal =
    record(input, "endOrdinal") != null
      ? requiredNumber(input, "endOrdinal")
      : null;
  if (startOrdinal < 1) {
    throw new ApiError(422, "起始序号必须大于 0", "LONG_TASK_ORDINAL_INVALID");
  }
  if (endOrdinal != null && endOrdinal < startOrdinal) {
    throw new ApiError(
      422,
      "结束序号不能小于起始序号",
      "LONG_TASK_END_BEFORE_START",
    );
  }
  // 归一键在 ACTIVE 定义间必须唯一；命中自己说明只是改了序号，不算冲突。
  const conflict = await findSequenceDefinitionByKey(core, shape.normalizedKey);
  if (conflict && text(conflict, "id") !== templateId) {
    throw new ApiError(409, "已存在同名长期任务", "LONG_TASK_ALREADY_EXISTS");
  }
  try {
    await core.storage.transaction([
      {
        sql: `UPDATE task_template SET
          name = $1, normalized_key = $2, title_pattern = $3,
          default_start_ordinal = $4, sequence_end_ordinal = $5,
          default_duration_minutes = $6, version = version + 1, updated_at = $7
        WHERE id = $8 AND version = $9`,
        values: [
          shape.name,
          shape.normalizedKey,
          shape.pattern,
          startOrdinal,
          endOrdinal,
          nullableInputNumber(input, "defaultDurationMinutes"),
          now(),
          templateId,
          numberValue(existing, "version"),
        ],
        expectedRowsAffected: 1,
      },
    ]);
  } catch (error) {
    localError(error);
  }
  return longTaskView(await getLongTaskRow(core, templateId));
}

export interface DeleteLongTaskResult {
  /** DELETED = 物理删除；ARCHIVED = 有挂载历史，退化为归档。 */
  mode: "DELETED" | "ARCHIVED";
  /** 引用该定义的学生轨道数（含已结束的历史轨道）。 */
  trackCount: number;
}

/**
 * 删除长期任务定义。student_task_track.template_id 没有 ON DELETE CASCADE，
 * 而且物理删除会连带毁掉学生已经完成的历史任务——所以只要被挂载过就退化为
 * 归档（status='ARCHIVED'，listLongTasks 已过滤该状态），列表里立刻消失，
 * 历史轨道保持可读。没有任何轨道引用时才真正删除。
 */
export async function deleteLongTask(
  core: LocalCore,
  templateId: string,
): Promise<DeleteLongTaskResult> {
  const existing = await getLongTaskRow(core, templateId);
  if (text(existing, "generation_mode") !== "SEQUENCE") {
    throw new ApiError(
      422,
      "该任务定义不是长期任务（序号生成型）",
      "LONG_TASK_MODE_MISMATCH",
    );
  }
  const counted = await core.storage.select<DbRow>(
    "SELECT COUNT(*) AS track_count FROM student_task_track WHERE template_id = $1",
    [templateId],
  );
  const trackCount = counted[0] ? numberValue(counted[0], "track_count") : 0;
  try {
    await core.storage.transaction(
      trackCount > 0
        ? [
            {
              sql: `UPDATE task_template SET status = 'ARCHIVED',
                version = version + 1, updated_at = $1 WHERE id = $2`,
              values: [now(), templateId],
              expectedRowsAffected: 1,
            },
          ]
        : [
            {
              sql: "DELETE FROM task_template WHERE id = $1",
              values: [templateId],
              expectedRowsAffected: 1,
            },
          ],
    );
  } catch (error) {
    localError(error);
  }
  return { mode: trackCount > 0 ? "ARCHIVED" : "DELETED", trackCount };
}

export async function mountLongTask(
  core: LocalCore,
  input: Record<string, unknown>,
): Promise<unknown> {
  const idempotencyKey = requiredString(input, "idempotencyKey");
  return core.idempotentCommand(
    idempotencyKey,
    async () => {
      const studentId = requiredString(input, "studentId");
      await core.studentRow(studentId);
      const definition = await core.templateRow(
        requiredString(input, "longTaskId"),
      );
      if (text(definition, "generation_mode") !== "SEQUENCE") {
        throw new ApiError(
          422,
          "该任务定义不是长期任务（序号生成型）",
          "LONG_TASK_MODE_MISMATCH",
        );
      }
      if (text(definition, "status") !== "ACTIVE") {
        throw new ApiError(422, "长期任务已停用", "LONG_TASK_NOT_ACTIVE");
      }
      const endOrdinal = nullableNumber(definition, "sequence_end_ordinal");
      const currentOrdinal =
        record(input, "currentOrdinal") != null
          ? requiredNumber(input, "currentOrdinal")
          : numberValue(definition, "default_start_ordinal");
      if (currentOrdinal < 1) {
        throw new ApiError(
          422,
          "起始序号必须大于 0",
          "LONG_TASK_ORDINAL_INVALID",
        );
      }
      if (endOrdinal != null && currentOrdinal > endOrdinal) {
        throw new ApiError(
          422,
          `起始序号超出长期任务范围（结束序号 ${endOrdinal}）`,
          "LONG_TASK_ORDINAL_OUT_OF_RANGE",
        );
      }
      const anchorDate =
        optionalDateString(input, "anchorDate") ?? formatDate(new Date());
      await requireNoActiveSequenceTrack(core, studentId, definition);
      const trackId = crypto.randomUUID();
      const firstTask = await sequenceTaskInsertStatement(core, {
        trackId,
        studentId,
        ordinal: currentOrdinal,
        title: renderSeriesTitlePattern(
          text(definition, "title_pattern"),
          currentOrdinal,
        ),
        candidateDate: anchorDate,
        durationOverride: nullableNumber(
          definition,
          "default_duration_minutes",
        ),
      });
      if (firstTask.outcome !== "CREATED") {
        throw new ApiError(
          409,
          firstTask.outcome === "NO_AVAILABLE_DATE"
            ? "90 天内没有可用学习日，无法生成首项任务"
            : "该序号已有待完成任务",
          firstTask.outcome === "NO_AVAILABLE_DATE"
            ? "TRACK_NO_AVAILABLE_DATE"
            : "TRACK_ITEM_ALREADY_PENDING",
        );
      }
      try {
        await core.storage.transaction([
          sequenceTrackInsertStatement({
            trackId,
            studentId,
            definition,
            currentOrdinal,
            startDate: anchorDate,
          }),
          firstTask.statement,
          core.idempotencyStatement(idempotencyKey, "MOUNT_LONG_TASK", trackId),
        ]);
      } catch (error) {
        await requireNoActiveSequenceTrack(core, studentId, definition);
        localError(error);
      }
      return tracks.getTrack(core, trackId);
    },
    (value) => tracks.getTrack(core, String(value)),
  );
}

export async function convertTaskToLongTask(
  core: LocalCore,
  taskId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const idempotencyKey = requiredString(input, "idempotencyKey");
  return core.idempotentCommand(
    idempotencyKey,
    async () => {
      const task = await core.taskRow(taskId);
      if (
        text(task, "source_type") !== "AD_HOC" ||
        text(task, "status") !== "PENDING" ||
        bool(task, "locked")
      ) {
        throw new ApiError(
          409,
          "只有待办且未锁定的普通任务可以转为长期任务",
          "TASK_NOT_CONVERTIBLE",
        );
      }
      const scheduledDate = nullableText(task, "scheduled_date");
      if (scheduledDate == null) {
        throw new ApiError(
          409,
          "任务没有排期日期，无法转为长期任务",
          "TASK_NOT_CONVERTIBLE",
        );
      }
      // 原地升级：任务 id 不变，只换 source_type 并落到轨道当前序号上；标题
      // 快照保持原样（AC-LT-008/012），历史任务（Day1～3）不回填（AC-LT-009）。
      const shape = sequencePatternFromTitle(text(task, "title_snapshot"));
      const inputStart =
        record(input, "startOrdinal") != null
          ? requiredNumber(input, "startOrdinal")
          : null;
      const inputEnd =
        record(input, "endOrdinal") != null
          ? requiredNumber(input, "endOrdinal")
          : null;
      const ordinal = shape.detectedOrdinal ?? inputStart ?? 1;
      if (ordinal < 1) {
        throw new ApiError(
          422,
          "起始序号必须大于 0",
          "LONG_TASK_ORDINAL_INVALID",
        );
      }
      let definition = await findSequenceDefinitionByKey(
        core,
        shape.normalizedKey,
      );
      let definitionInsert: LocalSqlStatement | undefined;
      if (definition) {
        const definitionEnd = nullableNumber(
          definition,
          "sequence_end_ordinal",
        );
        if (definitionEnd != null && ordinal > definitionEnd) {
          throw new ApiError(
            422,
            `当前序号超出长期任务范围（结束序号 ${definitionEnd}）`,
            "LONG_TASK_ORDINAL_OUT_OF_RANGE",
          );
        }
      } else {
        if (inputEnd != null && inputEnd < ordinal) {
          throw new ApiError(
            422,
            "结束序号不能小于当前序号",
            "LONG_TASK_END_BEFORE_START",
          );
        }
        const definitionId = crypto.randomUUID();
        definitionInsert = sequenceDefinitionInsertStatement({
          id: definitionId,
          name: shape.name,
          normalizedKey: shape.normalizedKey,
          titlePattern: shape.pattern,
          startOrdinal: ordinal,
          endOrdinal: inputEnd,
          durationMinutes: nullableInputNumber(input, "durationMinutes"),
        });
        definition = {
          id: definitionId,
          name: shape.name,
          normalized_key: shape.normalizedKey,
          title_pattern: shape.pattern,
          sequence_end_ordinal: inputEnd,
          default_duration_minutes: nullableInputNumber(
            input,
            "durationMinutes",
          ),
        };
      }
      await requireNoActiveSequenceTrack(
        core,
        text(task, "student_id"),
        definition,
      );
      const executeConversion = async (
        selectedDefinition: DbRow,
        insert: LocalSqlStatement | undefined,
      ): Promise<unknown> => {
        const trackId = crypto.randomUUID();
        const response = {
          taskId: text(task, "id"),
          trackId,
          ordinal,
          definitionCreated: insert != null,
        };
        const statements: LocalSqlStatement[] = [];
        if (insert) statements.push(insert);
        statements.push(
          sequenceTrackInsertStatement({
            trackId,
            studentId: text(task, "student_id"),
            definition: selectedDefinition,
            currentOrdinal: ordinal,
            startDate: scheduledDate,
          }),
          {
            // 本任务即轨道当前项：不另建实例，指针就停在它的序号上。
            sql: `UPDATE task_instance SET source_type = 'TRACK', track_id = $1,
                item_ordinal = $2, template_version_id = NULL,
                template_item_id = NULL, version = version + 1, updated_at = $3
              WHERE id = $4 AND version = $5 AND source_type = 'AD_HOC'
                AND status = 'PENDING'`,
            values: [
              trackId,
              ordinal,
              now(),
              text(task, "id"),
              numberValue(task, "version"),
            ],
            expectedRowsAffected: 1,
          },
          core.idempotencyStatement(
            idempotencyKey,
            "CONVERT_TO_LONG_TASK",
            response,
          ),
        );
        await core.storage.transaction(statements);
        return hydrateConvertResult(core, response);
      };

      try {
        return await executeConversion(definition, definitionInsert);
      } catch (error) {
        // 两个学生同时把同名系列转为长期任务时，定义唯一约束只允许一个
        // 获胜。输家复用获胜定义并重新执行自己的转换事务。
        if (definitionInsert) {
          const winner = await findSequenceDefinitionByKey(
            core,
            shape.normalizedKey,
          );
          if (winner) {
            await requireNoActiveSequenceTrack(
              core,
              text(task, "student_id"),
              winner,
            );
            try {
              return await executeConversion(winner, undefined);
            } catch (retryError) {
              await requireNoActiveSequenceTrack(
                core,
                text(task, "student_id"),
                winner,
              );
              localError(retryError);
            }
          }
        }
        await requireNoActiveSequenceTrack(
          core,
          text(task, "student_id"),
          definition,
        );
        localError(error);
      }
    },
    (value) => hydrateConvertResult(core, value),
  );
}

async function hydrateConvertResult(
  core: LocalCore,
  value: unknown,
): Promise<Record<string, unknown>> {
  if (value == null || typeof value !== "object") {
    throw new ApiError(409, "幂等结果已损坏", "IDEMPOTENCY_RESULT_INVALID");
  }
  const response = value as Record<string, unknown>;
  const trackId = requiredString(response, "trackId");
  return { ...response, track: await tracks.getTrack(core, trackId) };
}

/** 学习日规则调整后，显式补回断链 SEQUENCE 轨道的当前项。 */
export async function resumeSequenceTrack(
  core: LocalCore,
  trackId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const idempotencyKey = requiredString(input, "idempotencyKey");
  return core.idempotentCommand(
    idempotencyKey,
    async () => {
      const track = await tracks.getTrackRow(core, trackId);
      if (
        text(track, "status") !== "ACTIVE" ||
        nullableText(track, "generation_mode") !== "SEQUENCE"
      ) {
        throw new ApiError(
          409,
          "只有进行中且断链的长期任务可以重新接排",
          "SEQUENCE_TRACK_NOT_RESUMABLE",
        );
      }
      const expectedVersion = requiredNumber(input, "expectedVersion");
      const ordinal = numberValue(track, "current_ordinal");
      const pending = await core.storage.select<DbRow>(
        `SELECT id FROM task_instance
     WHERE track_id = $1 AND item_ordinal = $2 AND status = 'PENDING' LIMIT 1`,
        [trackId, ordinal],
      );
      if (pending[0]) {
        throw new ApiError(
          409,
          "当前项已经存在，无需重新接排",
          "SEQUENCE_TRACK_ALREADY_PENDING",
        );
      }

      const nextTask = await sequenceTaskInsertStatement(core, {
        trackId,
        studentId: text(track, "student_id"),
        ordinal,
        title: renderSeriesTitlePattern(
          text(track, "title_pattern_snapshot"),
          ordinal,
        ),
        candidateDate:
          optionalDateString(input, "candidateDate") ?? formatDate(new Date()),
        durationOverride: nullableNumber(track, "duration_override_minutes"),
      });
      if (nextTask.outcome !== "CREATED") {
        throw new ApiError(
          409,
          nextTask.outcome === "NO_AVAILABLE_DATE"
            ? "90 天内仍没有可用学习日"
            : "当前项已经存在，无需重新接排",
          nextTask.outcome === "NO_AVAILABLE_DATE"
            ? "TRACK_NO_AVAILABLE_DATE"
            : "SEQUENCE_TRACK_ALREADY_PENDING",
        );
      }

      try {
        await core.storage.transaction([
          nextTask.statement,
          {
            sql: `UPDATE student_task_track SET next_candidate_date = $1,
              version = version + 1, updated_at = $2
              WHERE id = $3 AND version = $4 AND status = 'ACTIVE'`,
            values: [nextTask.scheduledDate, now(), trackId, expectedVersion],
            expectedRowsAffected: 1,
          },
          core.idempotencyStatement(
            idempotencyKey,
            "RESUME_SEQUENCE_TRACK",
            trackId,
          ),
        ]);
      } catch (error) {
        const nowPending = await core.storage.select<DbRow>(
          `SELECT id FROM task_instance
       WHERE track_id = $1 AND item_ordinal = $2 AND status = 'PENDING' LIMIT 1`,
          [trackId, ordinal],
        );
        if (nowPending[0]) {
          throw new ApiError(
            409,
            "当前项已经由另一操作接排",
            "SEQUENCE_TRACK_ALREADY_PENDING",
          );
        }
        localError(error);
      }
      return tracks.getTrack(core, trackId);
    },
    (value) => tracks.getTrack(core, String(value)),
  );
}

async function getLongTaskRow(
  core: LocalCore,
  templateId: string,
): Promise<DbRow> {
  const rows = await core.storage.select<DbRow>(
    `SELECT t.*, (
       SELECT COUNT(*) FROM student_task_track stt
       WHERE stt.template_id = t.id
         AND stt.status IN ('NOT_STARTED', 'ACTIVE', 'PAUSED')
     ) AS active_track_count
     FROM task_template t WHERE t.id = $1`,
    [templateId],
  );
  if (!rows[0]) {
    throw new ApiError(404, "任务模板不存在", "TEMPLATE_NOT_FOUND");
  }
  return rows[0];
}

/**
 * 任意任务标题 → 长期任务模板形状。尾部数字（含"第N天"）优先：数字既是
 * 模板起点也是当前序号；无数字的标题按"标题 + 空格 + {n}"成模板，从 1 起。
 */
function sequencePatternFromTitle(title: string): {
  pattern: string;
  name: string;
  normalizedKey: string;
  detectedOrdinal: number | null;
} {
  const parsed = parseSeriesTitle(title);
  if (parsed) {
    return {
      pattern: buildSeriesTitlePattern({
        prefix: parsed.prefix,
        suffix: parsed.suffix,
      }),
      name: seriesDisplayName(parsed.prefix) || title.trim(),
      normalizedKey: seriesNormalizedKey(parsed.prefix),
      detectedOrdinal: parsed.number,
    };
  }
  return {
    pattern: buildPlainTitlePattern(title),
    name: title.trim(),
    normalizedKey: seriesNormalizedKey(title),
    detectedOrdinal: null,
  };
}

/** 归一键找 ACTIVE 的 SEQUENCE 定义；找不到不隐式复用停用的定义。 */
async function findSequenceDefinitionByKey(
  core: LocalCore,
  normalizedKey: string,
): Promise<DbRow | undefined> {
  const rows = await core.storage.select<DbRow>(
    `SELECT * FROM task_template
     WHERE generation_mode = 'SEQUENCE' AND status = 'ACTIVE'
       AND normalized_key = $1
     ORDER BY created_at LIMIT 1`,
    [normalizedKey],
  );
  return rows[0];
}

function sequenceDefinitionInsertStatement(input: {
  id: string;
  name: string;
  normalizedKey: string;
  titlePattern: string;
  startOrdinal: number;
  endOrdinal: number | null;
  durationMinutes: number | null;
}): LocalSqlStatement {
  const timestamp = now();
  return {
    // SEQUENCE 定义创建即 ACTIVE：没有草稿/版本/发布流程（用户不应该
    // 感知 Version 概念）。template_code 等遗留列由服务端生成兼容值。
    sql: `INSERT INTO task_template(
            id, template_code, name, short_name, subject_code,
            category_code, unit_label, default_duration_minutes,
            default_requires_device, generation_mode, normalized_key,
            title_pattern, default_start_ordinal, sequence_end_ordinal,
            status, version, created_at, updated_at
          ) VALUES ($1, $2, $3, NULL, 'OTHER', NULL, '项', $4, 0,
                    'SEQUENCE', $5, $6, $7, $8, 'ACTIVE', 0, $9, $9)`,
    values: [
      input.id,
      `LT-${input.id.slice(0, 8)}`,
      input.name,
      input.durationMinutes,
      input.normalizedKey,
      input.titlePattern,
      input.startOrdinal,
      input.endOrdinal,
      timestamp,
    ],
    expectedRowsAffected: 1,
  };
}

function sequenceTrackInsertStatement(input: {
  trackId: string;
  studentId: string;
  definition: DbRow;
  currentOrdinal: number;
  startDate: string;
}): LocalSqlStatement {
  const timestamp = now();
  return {
    // 新 Track 的 startOrdinal = currentOrdinal（MVP：不回填历史），定义的
    // 名称与标题模板同时落入快照，后续定义编辑不影响已挂载学生。
    sql: `INSERT INTO student_task_track(
            id, student_id, template_id, template_version_id, generation_mode,
            status, start_ordinal, current_ordinal, end_ordinal,
            default_units_per_session, start_date, next_candidate_date,
            definition_name_snapshot, title_pattern_snapshot, priority,
            allow_parallel_items, scheduling_policy, duration_override_minutes,
            device_policy_override, note, version, created_at, updated_at
          ) VALUES ($1, $2, $3, NULL, 'SEQUENCE', 'ACTIVE', $4, $4, $5,
                    1, $6, $6, $7, $8, 50, 0, 'AUTO', NULL, NULL, NULL,
                    0, $9, $9)`,
    values: [
      input.trackId,
      input.studentId,
      text(input.definition, "id"),
      input.currentOrdinal,
      nullableNumber(input.definition, "sequence_end_ordinal"),
      input.startDate,
      nullableText(input.definition, "name"),
      text(input.definition, "title_pattern"),
      timestamp,
    ],
    expectedRowsAffected: 1,
  };
}

async function requireNoActiveSequenceTrack(
  core: LocalCore,
  studentId: string,
  definition: DbRow,
): Promise<void> {
  const duplicates = await core.storage.select<DbRow>(
    `SELECT id FROM student_task_track
     WHERE student_id = $1 AND template_id = $2
       AND status IN ('NOT_STARTED', 'ACTIVE', 'PAUSED') LIMIT 1`,
    [studentId, text(definition, "id")],
  );
  if (duplicates[0]) {
    throw new ApiError(
      409,
      "该学生已挂载此长期任务",
      "LONG_TASK_ALREADY_MOUNTED",
    );
  }
}

/**
 * SEQUENCE 轨道实例落库：按 (track_id, item_ordinal) 去重，标题由模板渲染
 * 后作为快照写入；不引用 template_version/item。落点从候选日开始解析到
 * 下一真实可学习日（AC-LT-003），三态含义见 tracks.TaskInsert。
 */
export async function sequenceTaskInsertStatement(
  core: LocalCore,
  input: {
    trackId: string;
    studentId: string;
    ordinal: number;
    title: string;
    candidateDate: string;
    durationOverride: number | null;
  },
): Promise<TaskInsert> {
  const existing = await core.storage.select<DbRow>(
    `SELECT id FROM task_instance
     WHERE track_id = $1 AND item_ordinal = $2 AND status = 'PENDING' LIMIT 1`,
    [input.trackId, input.ordinal],
  );
  if (existing[0]) return { outcome: "ALREADY_PENDING" };
  const calendar = await core.studentCalendar(
    input.studentId,
    input.candidateDate,
    shiftDate(input.candidateDate, 90),
  );
  const availability = resolveStudyAvailability(calendar, input.candidateDate);
  const scheduledDate = availability.available
    ? input.candidateDate
    : findNextAvailableStudyDate({
        calendar,
        afterDate: input.candidateDate,
        requiresDevice: false,
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
              schedule_origin, manual_override, locked, star,
              version, created_at, updated_at
            ) VALUES ($1, $2, 'TRACK', $3, NULL, NULL, $4, $5, $5, 'PENDING',
                      $6, NULL, $7, 0, 'TRACK', 0, 0, 0, 0, $8, $8)`,
      values: [
        taskId,
        input.studentId,
        input.trackId,
        input.ordinal,
        scheduledDate,
        input.title,
        input.durationOverride,
        timestamp,
      ],
      expectedRowsAffected: 1,
    },
  };
}

function longTaskView(row: DbRow): Record<string, unknown> {
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    status: text(row, "status"),
    generationMode: text(row, "generation_mode"),
    titlePattern: text(row, "title_pattern"),
    defaultStartOrdinal: numberValue(row, "default_start_ordinal"),
    endOrdinal: nullableNumber(row, "sequence_end_ordinal"),
    defaultDurationMinutes: nullableNumber(row, "default_duration_minutes"),
    activeTrackCount: numberValue(row, "active_track_count"),
    version: numberValue(row, "version"),
    updatedAt: text(row, "updated_at"),
  };
}
