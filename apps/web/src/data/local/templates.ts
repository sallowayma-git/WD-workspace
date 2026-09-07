//! 任务模板：模板本体、版本、条目与发布，另含模板/条目使用量统计。

import { ApiError } from "../../lib/api/ApiError";
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
import { now } from "./dates";

export async function listTemplates(
  core: LocalCore,
  query?: string,
): Promise<unknown> {
  const normalized = query?.trim().toLocaleLowerCase();
  const rows = await core.storage.select<DbRow>(
    `SELECT t.*, v.version_number AS current_version_number,
            v.item_count AS current_item_count
     FROM task_template t
     LEFT JOIN task_template_version v ON v.id = t.current_published_version_id
     WHERE t.generation_mode = 'ITEMIZED'
     ${normalized ? "AND (lower(t.name) LIKE $1 OR lower(t.template_code) LIKE $1)" : ""}
     ORDER BY t.name, t.template_code`,
    normalized ? [`%${normalized}%`] : [],
  );
  return {
    items: rows.map((row) => templateView(row)),
    page: 0,
    size: rows.length,
    total: rows.length,
    hasNext: false,
  };
}

/**
 * 模板编码/学科编码不是助教必须操心的事情（用户反馈：表单必填项过多）。
 * 留空时静默生成：编码按现有 T 编号最大值顺延（T001、T002…）保住 UNIQUE
 * 约束，学科落 OTHER 兜底。Excel 导入等自带编码的调用方不受影响。
 */
async function nextTemplateCode(core: LocalCore): Promise<string> {
  const rows = await core.storage.select<DbRow>(
    `SELECT template_code FROM task_template WHERE template_code LIKE 'T%'`,
  );
  let max = 0;
  for (const row of rows) {
    const match = /^T(\d+)$/.exec(text(row, "template_code"));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `T${String(max + 1).padStart(3, "0")}`;
}

export async function createTemplate(
  core: LocalCore,
  input: Record<string, unknown>,
): Promise<unknown> {
  const templateId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const timestamp = now();
  const providedCode = nullableInputString(input, "templateCode");
  const templateCode = providedCode ?? (await nextTemplateCode(core));
  const subjectCode = nullableInputString(input, "subjectCode") ?? "OTHER";
  try {
    await core.storage.transaction([
      {
        sql: `INSERT INTO task_template(
                id, template_code, name, short_name, subject_code,
                category_code, unit_label, default_duration_minutes,
                default_requires_device, status, version, created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                        'DRAFT', 0, $10, $10)`,
        values: [
          templateId,
          templateCode,
          requiredString(input, "name"),
          nullableInputString(input, "shortName"),
          subjectCode,
          nullableInputString(input, "categoryCode"),
          requiredString(input, "unitLabel"),
          record(input, "defaultDurationMinutes") ?? null,
          record(input, "defaultRequiresDevice") === true,
          timestamp,
        ],
        expectedRowsAffected: 1,
      },
      {
        sql: `INSERT INTO task_template_version(
                id, template_id, version_number, status, item_count,
                version, created_at, updated_at
              ) VALUES ($1, $2, 1, 'DRAFT', 0, 0, $3, $3)`,
        values: [versionId, templateId, timestamp],
        expectedRowsAffected: 1,
      },
    ]);
  } catch (error) {
    localError(error);
  }
  return getTemplateSummary(core, templateId);
}

export async function getTemplateDetail(
  core: LocalCore,
  templateId: string,
): Promise<unknown> {
  const rows = await core.storage.select<DbRow>(
    `SELECT t.*, v.version_number AS current_version_number,
            v.item_count AS current_item_count
     FROM task_template t
     LEFT JOIN task_template_version v ON v.id = t.current_published_version_id
     WHERE t.id = $1`,
    [templateId],
  );
  if (!rows[0]) {
    throw new ApiError(404, "任务模板不存在", "TEMPLATE_NOT_FOUND");
  }
  const versions = await core.storage.select<DbRow>(
    `SELECT * FROM task_template_version
     WHERE template_id = $1 ORDER BY version_number DESC`,
    [templateId],
  );
  return {
    ...templateView(rows[0]),
    versions: versions.map((version) => templateVersionView(version)),
  };
}

export async function listVersionItems(
  core: LocalCore,
  versionId: string,
): Promise<unknown> {
  const rows = await core.storage.select<DbRow>(
    `SELECT * FROM task_template_item
     WHERE template_version_id = $1 ORDER BY ordinal`,
    [versionId],
  );
  return rows.map((row) => templateItemView(row));
}

export async function replaceVersionItems(
  core: LocalCore,
  versionId: string,
  input: Record<string, unknown>,
): Promise<void> {
  const versions = await core.storage.select<DbRow>(
    "SELECT * FROM task_template_version WHERE id = $1",
    [versionId],
  );
  if (!versions[0]) {
    throw new ApiError(404, "模板版本不存在", "TEMPLATE_VERSION_NOT_FOUND");
  }
  if (text(versions[0], "status") !== "DRAFT") {
    throw new ApiError(409, "仅草稿版本可编辑", "TEMPLATE_VERSION_NOT_DRAFT");
  }
  const items = record(input, "items");
  if (!Array.isArray(items)) {
    throw new ApiError(422, "模板项目不能为空", "TEMPLATE_ITEMS_REQUIRED");
  }
  const timestamp = now();
  const statements: LocalSqlStatement[] = [
    {
      sql: "DELETE FROM task_template_item WHERE template_version_id = $1",
      values: [versionId],
    },
  ];
  for (const value of items) {
    const item = value as Record<string, unknown>;
    statements.push({
      sql: `INSERT INTO task_template_item(
              id, template_version_id, item_code, ordinal, title, short_title,
              duration_minutes, requires_device, content_ref, instructions,
              active, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
      values: [
        crypto.randomUUID(),
        versionId,
        nullableInputString(item, "itemCode"),
        requiredNumber(item, "ordinal"),
        requiredString(item, "title"),
        nullableInputString(item, "shortTitle"),
        record(item, "durationMinutes") ?? null,
        Boolean(record(item, "requiresDevice")),
        nullableInputString(item, "contentRef"),
        nullableInputString(item, "instructions"),
        Boolean(record(item, "active")),
        timestamp,
      ],
      expectedRowsAffected: 1,
    });
  }
  statements.push({
    sql: `UPDATE task_template_version SET item_count = $1, change_note = $2,
          version = version + 1, updated_at = $3 WHERE id = $4 AND status = 'DRAFT'`,
    values: [
      items.length,
      nullableInputString(input, "changeNote"),
      timestamp,
      versionId,
    ],
    expectedRowsAffected: 1,
  });
  await core.storage.transaction(statements);
}

export async function publishVersion(
  core: LocalCore,
  versionId: string,
): Promise<unknown> {
  const versions = await core.storage.select<DbRow>(
    "SELECT * FROM task_template_version WHERE id = $1",
    [versionId],
  );
  const version = versions[0];
  if (!version) {
    throw new ApiError(404, "模板版本不存在", "TEMPLATE_VERSION_NOT_FOUND");
  }
  if (numberValue(version, "item_count") < 1) {
    throw new ApiError(422, "空模板版本不能发布", "TEMPLATE_ITEMS_REQUIRED");
  }
  const templateId = text(version, "template_id");
  const timestamp = now();
  await core.storage.transaction([
    {
      sql: `UPDATE task_template_version SET status = 'RETIRED',
            version = version + 1, updated_at = $1
            WHERE template_id = $2 AND status = 'PUBLISHED'`,
      values: [timestamp, templateId],
    },
    {
      sql: `UPDATE task_template_version SET status = 'PUBLISHED', published_at = $1,
            version = version + 1, updated_at = $1
            WHERE id = $2 AND status = 'DRAFT'`,
      values: [timestamp, versionId],
      expectedRowsAffected: 1,
    },
    {
      sql: `UPDATE task_template SET status = 'ACTIVE',
            current_published_version_id = $1, version = version + 1,
            updated_at = $2 WHERE id = $3`,
      values: [versionId, timestamp, templateId],
      expectedRowsAffected: 1,
    },
  ]);
  return getTemplateSummary(core, templateId);
}

export async function createTemplateDraft(
  core: LocalCore,
  templateId: string,
): Promise<unknown> {
  const template = await core.templateRow(templateId);
  const drafts = await core.storage.select<DbRow>(
    `SELECT * FROM task_template_version
     WHERE template_id = $1 AND status = 'DRAFT' LIMIT 1`,
    [templateId],
  );
  if (drafts[0]) return getTemplateSummary(core, templateId);
  const versions = await core.storage.select<DbRow>(
    `SELECT COALESCE(MAX(version_number), 0) AS max_version
     FROM task_template_version WHERE template_id = $1`,
    [templateId],
  );
  const id = crypto.randomUUID();
  const timestamp = now();
  await core.storage.transaction([
    {
      sql: `INSERT INTO task_template_version(
              id, template_id, version_number, status, item_count,
              version, created_at, updated_at
            ) VALUES ($1, $2, $3, 'DRAFT', 0, 0, $4, $4)`,
      values: [
        id,
        text(template, "id"),
        numberValue(versions[0], "max_version") + 1,
        timestamp,
      ],
      expectedRowsAffected: 1,
    },
  ]);
  return getTemplateSummary(core, templateId);
}

export async function getTemplateUsage(
  core: LocalCore,
  templateId: string,
): Promise<unknown> {
  const rows = await core.storage.select<DbRow>(
    `SELECT tr.id AS track_id, tr.student_id, s.name, s.student_code,
            tr.current_ordinal, tr.end_ordinal, tr.status, tr.next_candidate_date
     FROM student_task_track tr JOIN student s ON s.id = tr.student_id
     WHERE tr.template_id = $1 ORDER BY s.name`,
    [templateId],
  );
  return rows.map((row) => ({
    trackId: text(row, "track_id"),
    studentId: text(row, "student_id"),
    name: text(row, "name"),
    studentCode: text(row, "student_code"),
    currentOrdinal: numberValue(row, "current_ordinal"),
    endOrdinal: nullableNumber(row, "end_ordinal"),
    status: text(row, "status"),
    nextCandidateDate: nullableText(row, "next_candidate_date"),
  }));
}

export async function getTemplateItemUsage(
  core: LocalCore,
  itemId: string,
): Promise<unknown> {
  const rows = await core.storage.select<DbRow>(
    `SELECT ti.id AS task_id, ti.student_id, s.name, s.student_code,
            ti.status, ti.scheduled_date, ti.item_ordinal
     FROM task_instance ti JOIN student s ON s.id = ti.student_id
     WHERE ti.template_item_id = $1 ORDER BY ti.scheduled_date, s.name`,
    [itemId],
  );
  return rows.map((row) => ({
    taskId: text(row, "task_id"),
    studentId: text(row, "student_id"),
    name: text(row, "name"),
    studentCode: text(row, "student_code"),
    status: text(row, "status"),
    scheduledDate: nullableText(row, "scheduled_date"),
    itemOrdinal: nullableNumber(row, "item_ordinal"),
  }));
}

function templateView(row: DbRow): Record<string, unknown> {
  return {
    id: text(row, "id"),
    templateCode: text(row, "template_code"),
    name: text(row, "name"),
    shortName: nullableText(row, "short_name"),
    subjectCode: text(row, "subject_code"),
    categoryCode: nullableText(row, "category_code"),
    unitLabel: text(row, "unit_label"),
    defaultDurationMinutes: nullableNumber(row, "default_duration_minutes"),
    defaultRequiresDevice:
      row.default_requires_device == null
        ? false
        : bool(row, "default_requires_device"),
    status: text(row, "status"),
    currentPublishedVersionId: nullableText(
      row,
      "current_published_version_id",
    ),
    currentPublishedVersionNumber: nullableNumber(
      row,
      "current_version_number",
    ),
    currentItemCount: nullableNumber(row, "current_item_count"),
    version: numberValue(row, "version"),
    updatedAt: text(row, "updated_at"),
  };
}

function templateVersionView(row: DbRow): Record<string, unknown> {
  return {
    id: text(row, "id"),
    templateId: text(row, "template_id"),
    versionNumber: numberValue(row, "version_number"),
    status: text(row, "status"),
    itemCount: numberValue(row, "item_count"),
    changeNote: nullableText(row, "change_note"),
    publishedAt: nullableText(row, "published_at"),
    version: numberValue(row, "version"),
    updatedAt: text(row, "updated_at"),
  };
}

function templateItemView(row: DbRow): Record<string, unknown> {
  return {
    id: text(row, "id"),
    ordinal: numberValue(row, "ordinal"),
    itemCode: nullableText(row, "item_code"),
    title: text(row, "title"),
    shortTitle: nullableText(row, "short_title"),
    durationMinutes: nullableNumber(row, "duration_minutes"),
    requiresDevice:
      row.requires_device == null ? null : bool(row, "requires_device"),
    contentRef: nullableText(row, "content_ref"),
    instructions: nullableText(row, "instructions"),
    active: bool(row, "active"),
  };
}

async function getTemplateSummary(
  core: LocalCore,
  templateId: string,
): Promise<unknown> {
  const rows = await core.storage.select<DbRow>(
    `SELECT t.*, v.version_number AS current_version_number,
            v.item_count AS current_item_count
     FROM task_template t
     LEFT JOIN task_template_version v ON v.id = t.current_published_version_id
     WHERE t.id = $1`,
    [templateId],
  );
  if (!rows[0]) {
    throw new ApiError(404, "任务模板不存在", "TEMPLATE_NOT_FOUND");
  }
  return templateView(rows[0]);
}
