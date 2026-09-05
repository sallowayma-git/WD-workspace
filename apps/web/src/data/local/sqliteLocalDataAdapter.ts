import { ApiError } from "../../lib/api/ApiError";
import {
  findNextAvailableStudyDate,
  resolveStudyAvailability,
  type AvailabilityCalendar,
  type StudyDateOverride,
  type WeeklyStudyDay,
} from "../../domain/scheduling/availability";
import {
  completeTask as transitionCompleteTask,
  carryForwardTask as transitionCarryForwardTask,
  reopenTask as transitionReopenTask,
  rescheduleTask as transitionRescheduleTask,
  TaskTransitionError,
  type TaskInstanceSnapshot,
  type TrackSnapshot,
} from "../../domain/task/taskTransitions";
import {
  buildPlainTitlePattern,
  buildSeriesTitlePattern,
  formatSeriesTitle,
  isSameSeries,
  parseSeriesTitle,
  renderSeriesTitlePattern,
  seriesNormalizedKey,
} from "../../domain/task/seriesTitle";
import type { DataAdapter } from "../DataAdapter";
import type { LocalSqlStatement, LocalStorage } from "./LocalStorage";
import * as XLSX from "xlsx";

type DbRow = Record<string, unknown>;

const TASK_COLUMNS = `
  id, student_id, source_type, track_id, template_version_id,
  template_item_id, item_ordinal, scheduled_date, original_scheduled_date,
  status, title_snapshot, short_title_snapshot, duration_minutes_snapshot,
  requires_device_snapshot, schedule_origin, manual_override, override_reason,
  locked, note, carried_from_instance_id, carried_to_instance_id,
  completed_at, cancelled_at, parent_task_id, linked_parent_task_id,
  priority, sort_order, star, version, updated_at
`;

function text(row: DbRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Missing text column ${key}`);
  return value;
}

function nullableText(row: DbRow, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function numberValue(row: DbRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number")
    throw new Error(`Missing number column ${key}`);
  return value;
}

function nullableNumber(row: DbRow, key: string): number | null {
  const value = row[key];
  return typeof value === "number" ? value : null;
}

function bool(row: DbRow, key: string): boolean {
  return numberValue(row, key) !== 0;
}

function record(input: Record<string, unknown>, key: string): unknown {
  return input[key];
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = record(input, key);
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(422, `${key} is required`, "LOCAL_VALIDATION_ERROR");
  }
  return value;
}

function requiredNumber(input: Record<string, unknown>, key: string): number {
  const value = record(input, key);
  if (typeof value !== "number") {
    throw new ApiError(422, `${key} is required`, "LOCAL_VALIDATION_ERROR");
  }
  return value;
}

function nullableInputString(
  input: Record<string, unknown>,
  key: string,
): string | null {
  const value = record(input, key);
  return typeof value === "string" && value !== "" ? value : null;
}

function nullableInputNumber(
  input: Record<string, unknown>,
  key: string,
): number | null {
  const value = record(input, key);
  return typeof value === "number" ? value : null;
}

function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function now(): string {
  return new Date().toISOString();
}

function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new ApiError(422, "日期格式无效", "INVALID_DATE");
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  // JS Date 会把越界字段静默进位（2026-02-31 → 2026-03-03），所以正则通过
  // 不等于日期真实存在。round-trip 校验拒绝 02-31 / 04-31 / 非闰年 02-29 /
  // 13-01 / 00-10 这类输入，保证库里的 scheduled_date 都是合法日历日。
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    throw new ApiError(422, `日历上不存在的日期：${value}`, "INVALID_DATE");
  }
  return date;
}

/** Optional date input: returns null when absent, rejects impossible dates. */
function optionalDateString(
  input: Record<string, unknown>,
  key: string,
): string | null {
  const value = nullableInputString(input, key);
  if (value != null) parseDate(value);
  return value;
}

function formatDate(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function datesBetween(from: string, to: string): string[] {
  const start = parseDate(from);
  const end = parseDate(to);
  const dates: string[] = [];
  for (
    const date = new Date(start);
    date <= end;
    date.setDate(date.getDate() + 1)
  ) {
    dates.push(formatDate(date));
  }
  return dates;
}

function shiftDate(value: string, days: number): string {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

/** Monday of the ISO week containing `value`. */
function mondayOf(value: string): string {
  const date = parseDate(value);
  const weekday = date.getDay();
  date.setDate(date.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  return formatDate(date);
}

/**
 * The inclusive date window a schedule view covers. Day means one day, week
 * means the Monday-first ISO week, month means the whole calendar month — the
 * grid the page draws must be backed by real days, otherwise a month view
 * shows mostly empty placeholder cells.
 */
function scheduleWindow(
  anchorDate: string,
  view: string,
): { start: string; end: string } {
  if (view === "day") {
    return { start: anchorDate, end: anchorDate };
  }
  if (view === "month") {
    // The month grid is a Monday-first six-week block, so it also shows the
    // tail of the previous month and the head of the next one. Those cells must
    // carry real tasks, otherwise a task in the leading week looks deleted.
    const date = parseDate(anchorDate);
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    const gridStart = mondayOf(formatDate(first));
    return { start: gridStart, end: shiftDate(gridStart, 41) };
  }
  const start = mondayOf(anchorDate);
  return { start, end: shiftDate(start, 6) };
}

function localError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof TaskTransitionError) {
    throw new ApiError(409, error.message, error.code);
  }
  throw new ApiError(
    409,
    error instanceof Error ? error.message : "本地数据操作失败",
    "LOCAL_DATABASE_ERROR",
  );
}

type LocalImportColumn = {
  columnLabel: string;
  metadata: string;
  parsedUnit: string | null;
  parsedTotal: number | null;
  parsedDurationMinutes: number | null;
  nonEmptyCount: number;
  sampleTitles: string[];
  allTitles: string[];
  error: string | null;
};

type LocalImportJob = {
  fileName: string;
  sheetName: string;
  columns: LocalImportColumn[];
  errors: Array<Record<string, unknown>>;
};

function parseImportMetadata(metadata: string): {
  unit: string | null;
  total: number | null;
  durationMinutes: number | null;
  error: string | null;
} {
  const value = metadata.trim();
  if (!value) {
    return { unit: null, total: null, durationMinutes: null, error: null };
  }
  const structured =
    /^(\d+)\s*([^/\d]+?)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*(分钟|mins|minutes|小时|hour|hours)$/i.exec(
      value,
    );
  if (structured) {
    const duration = Number(structured[4]);
    const unit = structured[5].toLowerCase();
    return {
      unit: structured[2].trim(),
      total: Number(structured[3]),
      durationMinutes:
        unit === "小时" || unit === "hour" || unit === "hours"
          ? duration * 60
          : duration,
      error: null,
    };
  }
  const perItem = /^每(.+?)(\d+)\s*(分钟|mins|minutes)$/i.exec(value);
  if (perItem) {
    return {
      unit: perItem[1],
      total: null,
      durationMinutes: Number(perItem[2]),
      error: null,
    };
  }
  const hours = /^(\d+)\s*([^/\d]+?)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*(h|hr)$/i.exec(
    value,
  );
  if (hours) {
    return {
      unit: hours[2].trim(),
      total: Number(hours[3]),
      durationMinutes: Number(hours[4]) * 60,
      error: null,
    };
  }
  return {
    unit: null,
    total: null,
    durationMinutes: null,
    error: `无法解析元数据: ${value}`,
  };
}

function importCellText(value: unknown): string {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value)
    : "";
}

function importStringValue(
  input: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

export class SqliteLocalDataAdapter implements DataAdapter {
  private readonly importJobs = new Map<string, LocalImportJob>();

  constructor(private readonly storage: LocalStorage) {}

  async previewTemplateImport(file: File): Promise<unknown> {
    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(bytes, { type: "array", cellDates: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new ApiError(422, "Excel 文件中没有工作表", "IMPORT_FILE_INVALID");
    }
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });
    const headers = rows[0] ?? [];
    if (!headers.length) {
      throw new ApiError(
        422,
        "Excel 第一行必须为任务类别列名",
        "IMPORT_FILE_INVALID",
      );
    }
    const metadata = rows[1] ?? [];
    const columns: LocalImportColumn[] = [];
    for (let index = 0; index < Math.min(headers.length, 50); index += 1) {
      const columnLabel = importCellText(headers[index]).trim();
      if (!columnLabel) continue;
      const titles = rows
        .slice(2, 5002)
        .map((row) => importCellText(row[index]).trim())
        .filter(Boolean);
      const metadataText = importCellText(metadata[index]).trim();
      const parsed = parseImportMetadata(metadataText);
      columns.push({
        columnLabel,
        metadata: metadataText,
        parsedUnit: parsed.unit,
        parsedTotal: parsed.total,
        parsedDurationMinutes: parsed.durationMinutes,
        nonEmptyCount: titles.length,
        sampleTitles: titles.slice(0, 3),
        allTitles: titles,
        error: parsed.error,
      });
    }
    const jobId = crypto.randomUUID();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const fileSha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    this.importJobs.set(jobId, {
      fileName: file.name,
      sheetName,
      columns,
      errors: [],
    });
    return {
      jobId,
      fileName: file.name,
      fileSha256,
      columns,
      totalColumns: columns.length,
      validColumns: columns.filter((column) => column.nonEmptyCount > 0).length,
    };
  }

  async executeTemplateImport(
    jobId: string,
    mappings: Array<Record<string, unknown>>,
  ): Promise<unknown> {
    const job = this.importJobs.get(jobId);
    if (!job) throw new ApiError(404, "导入任务不存在", "IMPORT_JOB_NOT_FOUND");
    const errors: Array<Record<string, unknown>> = [];
    let succeededColumns = 0;
    for (const mapping of mappings) {
      const columnLabel = requiredString(mapping, "columnLabel");
      const column = job.columns.find(
        (candidate) => candidate.columnLabel === columnLabel,
      );
      if (!column) {
        errors.push({
          sheet: job.sheetName,
          rowNumber: null,
          columnName: columnLabel,
          errorCode: "IMPORT_COLUMN_NOT_FOUND",
          message: `未找到列: ${columnLabel}`,
          rawValue: null,
        });
        continue;
      }
      try {
        const created = (await this.createTemplate({
          templateCode: importStringValue(mapping, "templateCode", columnLabel),
          name: importStringValue(mapping, "templateName", columnLabel),
          shortName: importStringValue(
            mapping,
            "shortName",
            columnLabel.slice(0, 10),
          ),
          subjectCode: importStringValue(mapping, "subjectCode", "OTHER"),
          categoryCode: mapping.categoryCode,
          unitLabel: importStringValue(
            mapping,
            "unitLabel",
            column.parsedUnit ?? "单元",
          ),
          defaultDurationMinutes:
            mapping.defaultDurationMinutes ?? column.parsedDurationMinutes,
          defaultRequiresDevice: mapping.defaultRequiresDevice === true,
        })) as { id: string };
        const detail = (await this.getTemplateDetail(created.id)) as {
          versions: Array<{ id: string; status: string }>;
        };
        const draft = detail.versions.find(
          (version) => version.status === "DRAFT",
        );
        if (!draft) throw new Error("模板草稿版本不存在");
        await this.replaceVersionItems(draft.id, {
          changeNote: `本地导入: ${job.fileName}`,
          items: column.allTitles.map((title, index) => ({
            ordinal: index + 1,
            itemCode: `${importStringValue(mapping, "templateCode", columnLabel)}-${index + 1}`,
            title,
            shortTitle: title.slice(0, 80),
            durationMinutes: column.parsedDurationMinutes,
            requiresDevice: mapping.defaultRequiresDevice === true,
            contentRef: null,
            instructions: null,
            active: true,
          })),
        });
        await this.publishVersion(draft.id);
        succeededColumns += 1;
      } catch (error) {
        errors.push({
          sheet: job.sheetName,
          rowNumber: null,
          columnName: columnLabel,
          errorCode:
            error instanceof ApiError ? error.code : "IMPORT_EXECUTE_FAILED",
          message: error instanceof Error ? error.message : "导入失败",
          rawValue: null,
        });
      }
    }
    job.errors = errors;
    const totalColumns = mappings.length;
    const status =
      errors.length === 0
        ? "SUCCEEDED"
        : succeededColumns === 0
          ? "FAILED"
          : "PARTIAL";
    return {
      jobId,
      status,
      fileName: job.fileName,
      summary: `本地导入完成: ${succeededColumns} 成功, ${errors.length} 失败`,
      totalColumns,
      succeededColumns,
      failedColumns: errors.length,
      errors: errors.map((error) =>
        typeof error.message === "string" ? error.message : "导入失败",
      ),
    };
  }

  getImportErrors(jobId: string, limit = 200, offset = 0): Promise<unknown> {
    const job = this.importJobs.get(jobId);
    if (!job) throw new ApiError(404, "导入任务不存在", "IMPORT_JOB_NOT_FOUND");
    return Promise.resolve({
      jobId,
      errors: job.errors.slice(offset, offset + limit),
      total: job.errors.length,
    });
  }

  async listStudents(query?: string): Promise<unknown> {
    const normalized = query?.trim().toLocaleLowerCase();
    const where = normalized
      ? "WHERE lower(name) LIKE $1 OR lower(student_code) LIKE $1"
      : "";
    const values = normalized ? [`%${normalized}%`] : [];
    const rows = await this.storage.select<DbRow>(
      `SELECT * FROM student ${where} ORDER BY name, student_code`,
      values,
    );
    return {
      items: rows.map((row) => this.studentView(row)),
      page: 0,
      size: rows.length,
      total: rows.length,
      hasNext: false,
    };
  }

  async getStudent(studentId: string): Promise<unknown> {
    const rows = await this.storage.select<DbRow>(
      "SELECT * FROM student WHERE id = $1",
      [studentId],
    );
    if (!rows[0]) throw new ApiError(404, "学生不存在", "STUDENT_NOT_FOUND");
    return this.studentView(rows[0]);
  }

  /**
   * 学生编号不是助教必须操心的东西，界面上已改为选填。缺省时按现有编号里最大的
   * 数字顺延生成一个（S001、S002…），既保住 UNIQUE 约束，也保证列表里仍有编号可读。
   */
  private async nextStudentCode(): Promise<string> {
    const rows = await this.storage.select<DbRow>(
      `SELECT student_code FROM student WHERE student_code LIKE 'S%'`,
    );
    let max = 0;
    for (const row of rows) {
      const match = /^S(\d+)$/.exec(text(row, "student_code"));
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `S${String(max + 1).padStart(3, "0")}`;
  }

  async createStudent(input: Record<string, unknown>): Promise<unknown> {
    const id = crypto.randomUUID();
    const timestamp = now();
    const providedCode = nullableInputString(input, "studentCode");
    const studentCode =
      providedCode && providedCode.trim().length > 0
        ? providedCode.trim()
        : await this.nextStudentCode();
    const subjectPreferences = this.normalizeSubjectPreferences(
      record(input, "subjectPreferences"),
      timestamp,
    );
    await this.storage.transaction([
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
    return this.getStudent(id);
  }

  async updateStudent(
    studentId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const existing = await this.studentRow(studentId);
    const timestamp = now();
    const preferences = this.normalizeSubjectPreferences(
      record(input, "subjectPreferences"),
      timestamp,
    );
    try {
      await this.storage.transaction([
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
    return this.getStudent(studentId);
  }

  /**
   * 硬删除学生及其全部从属数据（常规周、日期覆盖、轨道、任务、生词）。
   * 外键虽然声明了 ON DELETE CASCADE，但级联依赖连接级 PRAGMA foreign_keys，
   * 浏览器/桌面两个存储实现并不保证开启，所以按依赖顺序显式删除，保证任何
   * 存储下都不留孤儿行。删除前先把其他学生任务指向本学生任务的
   * linked_parent/carried 指针置空——linkMainTask 与跨学生改期允许产生
   * 跨学生引用，整批 DELETE 语句会把它们一起连带删掉并触发外键错误。
   */
  async deleteStudent(studentId: string): Promise<void> {
    await this.studentRow(studentId);
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
      await this.storage.transaction(statements);
    } catch (error) {
      localError(error);
    }
  }

  async getWeeklyPattern(studentId: string): Promise<unknown> {
    const patterns = await this.storage.select<DbRow>(
      `SELECT * FROM student_weekly_pattern
       WHERE student_id = $1 AND status = 'ACTIVE'
       ORDER BY effective_from DESC LIMIT 1`,
      [studentId],
    );
    const pattern = patterns[0];
    if (!pattern) {
      throw new ApiError(404, "学生常规周不存在", "WEEKLY_PATTERN_NOT_FOUND");
    }
    const days = await this.storage.select<DbRow>(
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

  async saveWeeklyPattern(
    studentId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    await this.getStudent(studentId);
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
    await this.storage.transaction(statements);
    return this.getWeeklyPattern(studentId);
  }

  async getWeekPlan(studentId: string, weekStart: string): Promise<unknown> {
    const weekEnd = shiftDate(weekStart, 6);
    const rows = await this.storage.select<DbRow>(
      `SELECT * FROM student_date_override
       WHERE student_id = $1 AND business_date BETWEEN $2 AND $3
       ORDER BY business_date`,
      [studentId, weekStart, weekEnd],
    );
    if (rows.length !== 7) {
      throw new ApiError(404, "周计划不存在", "WEEK_PLAN_NOT_FOUND");
    }
    return this.weekPlanView(studentId, weekStart, rows);
  }

  async saveWeekPlan(
    studentId: string,
    weekStart: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    await this.getStudent(studentId);
    const sourceType = requiredString(input, "sourceType");
    let days = record(input, "days");
    if (!Array.isArray(days)) {
      if (sourceType === "BASE_PATTERN") {
        const pattern = (await this.getWeeklyPattern(studentId)) as {
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
        const previous = (await this.getWeekPlan(
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
    const statements: LocalSqlStatement[] = [
      {
        sql: `DELETE FROM student_date_override
              WHERE student_id = $1 AND business_date BETWEEN $2 AND $3`,
        values: [studentId, weekStart, shiftDate(weekStart, 6)],
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
    await this.storage.transaction(statements);
    return this.getWeekPlan(studentId, weekStart);
  }

  async listTemplates(query?: string): Promise<unknown> {
    const normalized = query?.trim().toLocaleLowerCase();
    const rows = await this.storage.select<DbRow>(
      `SELECT t.*, v.version_number AS current_version_number,
              v.item_count AS current_item_count
       FROM task_template t
       LEFT JOIN task_template_version v ON v.id = t.current_published_version_id
       ${normalized ? "WHERE lower(t.name) LIKE $1 OR lower(t.template_code) LIKE $1" : ""}
       ORDER BY t.name, t.template_code`,
      normalized ? [`%${normalized}%`] : [],
    );
    return {
      items: rows.map((row) => this.templateView(row)),
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
  private async nextTemplateCode(): Promise<string> {
    const rows = await this.storage.select<DbRow>(
      `SELECT template_code FROM task_template WHERE template_code LIKE 'T%'`,
    );
    let max = 0;
    for (const row of rows) {
      const match = /^T(\d+)$/.exec(text(row, "template_code"));
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `T${String(max + 1).padStart(3, "0")}`;
  }

  async createTemplate(input: Record<string, unknown>): Promise<unknown> {
    const templateId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const timestamp = now();
    const providedCode = nullableInputString(input, "templateCode");
    const templateCode = providedCode ?? (await this.nextTemplateCode());
    const subjectCode = nullableInputString(input, "subjectCode") ?? "OTHER";
    try {
      await this.storage.transaction([
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
    return this.getTemplateSummary(templateId);
  }

  async getTemplateDetail(templateId: string): Promise<unknown> {
    const rows = await this.storage.select<DbRow>(
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
    const versions = await this.storage.select<DbRow>(
      `SELECT * FROM task_template_version
       WHERE template_id = $1 ORDER BY version_number DESC`,
      [templateId],
    );
    return {
      ...this.templateView(rows[0]),
      versions: versions.map((version) => this.templateVersionView(version)),
    };
  }

  async listVersionItems(versionId: string): Promise<unknown> {
    const rows = await this.storage.select<DbRow>(
      `SELECT * FROM task_template_item
       WHERE template_version_id = $1 ORDER BY ordinal`,
      [versionId],
    );
    return rows.map((row) => this.templateItemView(row));
  }

  async replaceVersionItems(
    versionId: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    const versions = await this.storage.select<DbRow>(
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
    await this.storage.transaction(statements);
  }

  async publishVersion(versionId: string): Promise<unknown> {
    const versions = await this.storage.select<DbRow>(
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
    await this.storage.transaction([
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
    return this.getTemplateSummary(templateId);
  }

  async createTemplateDraft(templateId: string): Promise<unknown> {
    const template = await this.getTemplateRow(templateId);
    const drafts = await this.storage.select<DbRow>(
      `SELECT * FROM task_template_version
       WHERE template_id = $1 AND status = 'DRAFT' LIMIT 1`,
      [templateId],
    );
    if (drafts[0]) return this.getTemplateSummary(templateId);
    const versions = await this.storage.select<DbRow>(
      `SELECT COALESCE(MAX(version_number), 0) AS max_version
       FROM task_template_version WHERE template_id = $1`,
      [templateId],
    );
    const id = crypto.randomUUID();
    const timestamp = now();
    await this.storage.transaction([
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
    return this.getTemplateSummary(templateId);
  }

  async getTemplateUsage(templateId: string): Promise<unknown> {
    const rows = await this.storage.select<DbRow>(
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

  async getTemplateItemUsage(itemId: string): Promise<unknown> {
    const rows = await this.storage.select<DbRow>(
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

  async listStudentTracks(
    studentId: string,
    status?: string,
  ): Promise<unknown> {
    const rows = await this.storage.select<DbRow>(
      `SELECT * FROM student_task_track WHERE student_id = $1
       ${status ? "AND status = $2" : ""}
       ORDER BY priority DESC, created_at`,
      status ? [studentId, status] : [studentId],
    );
    return rows.map((row) => this.trackView(row));
  }

  async getTrack(trackId: string): Promise<unknown> {
    return this.trackView(await this.getTrackRow(trackId));
  }

  async mountTrack(input: Record<string, unknown>): Promise<unknown> {
    const idempotencyKey = requiredString(input, "idempotencyKey");
    const existing = await this.idempotentResult(idempotencyKey);
    if (existing.found) return this.getTrack(String(existing.value));
    const studentId = requiredString(input, "studentId");
    await this.getStudent(studentId);
    const template = await this.getTemplateRow(
      requiredString(input, "templateId"),
    );
    const versionRows = await this.storage.select<DbRow>(
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
    const items = await this.storage.select<DbRow>(
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
              ) VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $5, $6, $7, $8, $8,
                        $9, 0, $10, NULL, NULL, $11, 0, $12, $12)`,
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
      const firstTask = await this.trackTaskInsertStatement({
        trackId,
        studentId,
        templateVersionId: text(version, "id"),
        item: items[0],
        candidateDate: requiredString(input, "startDate"),
        durationOverride: null,
      });
      if (!firstTask) {
        throw new ApiError(
          409,
          "90 天内没有可用学习日，无法生成轨道首项任务",
          "TRACK_NO_AVAILABLE_DATE",
        );
      }
      statements.push(firstTask.statement);
    }
    statements.push(
      this.idempotencyStatement(idempotencyKey, "MOUNT_TRACK", trackId),
    );
    await this.storage.transaction(statements);
    return this.getTrack(trackId);
  }

  async scheduleTrackItems(
    trackId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const track = await this.getTrackRow(trackId);
    const status = text(track, "status");
    if (status === "COMPLETED" || status === "CANCELLED") {
      throw new ApiError(
        409,
        "已完成或已取消的轨道不能排期",
        "TRACK_IMMUTABLE",
      );
    }
    if (nullableText(track, "generation_mode") === "SEQUENCE") {
      // 长期任务轨道按序号自动推进（完成即生成下一项），批量排期是 ITEMIZED
      // 课程的概念；混用会绕过 title_pattern 渲染造成同序号双实例。
      throw new ApiError(
        422,
        "长期任务轨道按序号自动推进，不支持手动批量排期",
        "SEQUENCE_TRACK_SCHEDULE_NOT_SUPPORTED",
      );
    }
    const startOrdinal = requiredNumber(input, "startOrdinal");
    const unitCount = requiredNumber(input, "unitCount");
    const preferredDate = requiredString(input, "date");
    if (unitCount < 1) {
      throw new ApiError(
        422,
        "单元数必须大于 0",
        "SCHEDULE_UNIT_COUNT_INVALID",
      );
    }
    const currentOrdinal = numberValue(track, "current_ordinal");
    if (startOrdinal !== currentOrdinal) {
      throw new ApiError(
        422,
        `排期必须从当前指针 ${currentOrdinal} 开始连续`,
        "SCHEDULE_ORDINAL_NOT_FROM_POINTER",
      );
    }
    const endOrdinal = startOrdinal + unitCount - 1;
    if (endOrdinal > numberValue(track, "end_ordinal")) {
      throw new ApiError(
        422,
        "排期序号超出轨道结束单元",
        "SCHEDULE_ORDINAL_OUT_OF_RANGE",
      );
    }
    const items = await this.storage.select<DbRow>(
      `SELECT * FROM task_template_item WHERE template_version_id = $1
       AND ordinal BETWEEN $2 AND $3 AND active = 1 ORDER BY ordinal`,
      [text(track, "template_version_id"), startOrdinal, endOrdinal],
    );
    if (items.length !== unitCount) {
      throw new ApiError(
        422,
        "模板单元在指定序号范围内存在缺失或非连续",
        "SCHEDULE_ORDINAL_GAP",
      );
    }

    const statements: LocalSqlStatement[] = [];
    const taskIds: string[] = [];
    const warnings: string[] = [];
    let candidateDate = preferredDate;
    for (const item of items) {
      const ordinal = numberValue(item, "ordinal");
      const existing = await this.storage.select<DbRow>(
        `SELECT id FROM task_instance
         WHERE track_id = $1 AND item_ordinal = $2 AND status = 'PENDING' LIMIT 1`,
        [trackId, ordinal],
      );
      if (existing[0]) {
        taskIds.push(text(existing[0], "id"));
        warnings.push(`序号 ${ordinal} 已存在待办实例，复用现有`);
        continue;
      }
      const pending = await this.trackTaskInsertStatement({
        trackId,
        studentId: text(track, "student_id"),
        templateVersionId: text(track, "template_version_id"),
        item,
        candidateDate,
        durationOverride: nullableNumber(track, "duration_override_minutes"),
        manualOverride: record(input, "manualOverride") === true,
        overrideReason: nullableInputString(input, "overrideReason"),
      });
      if (!pending) {
        warnings.push(`序号 ${ordinal} 在 ${candidateDate} 起无可学习日，跳过`);
        continue;
      }
      statements.push(pending.statement);
      taskIds.push(pending.taskId);
      if (pending.scheduledDate !== preferredDate) {
        warnings.push(
          `序号 ${ordinal} 由 ${preferredDate} 顺延至 ${pending.scheduledDate}`,
        );
      }
      candidateDate = shiftDate(pending.scheduledDate, 1);
    }
    if (statements.length > 0) await this.storage.transaction(statements);
    return {
      instances: await Promise.all(
        taskIds.map((taskId) => this.getTaskView(taskId)),
      ),
      warnings,
    };
  }

  // -------------------------------------------------------------------------
  // 长期任务（SEQUENCE）：定义复用 task_template 表（generation_mode =
  // 'SEQUENCE'），但不使用 version/item；挂载后的 Track 带定义快照，完成一项
  // 即按标题模板渲染并生成下一项，顺延保持序号不变。
  // -------------------------------------------------------------------------

  async listLongTasks(query?: string): Promise<unknown> {
    const normalized = query?.trim().toLocaleLowerCase();
    const rows = await this.storage.select<DbRow>(
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
      items: rows.map((row) => this.longTaskView(row)),
      page: 0,
      size: rows.length,
      total: rows.length,
      hasNext: false,
    };
  }

  async createLongTask(input: Record<string, unknown>): Promise<unknown> {
    const sampleTitle = requiredString(input, "sampleTitle");
    const shape = this.sequencePatternFromTitle(sampleTitle);
    const startOrdinal =
      record(input, "startOrdinal") != null
        ? requiredNumber(input, "startOrdinal")
        : (shape.detectedOrdinal ?? 1);
    const endOrdinal =
      record(input, "endOrdinal") != null
        ? requiredNumber(input, "endOrdinal")
        : null;
    if (startOrdinal < 1) {
      throw new ApiError(
        422,
        "起始序号必须大于 0",
        "LONG_TASK_ORDINAL_INVALID",
      );
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
      await this.storage.transaction([
        this.sequenceDefinitionInsertStatement({
          id,
          name: shape.name,
          normalizedKey: shape.normalizedKey,
          titlePattern: shape.pattern,
          startOrdinal,
          endOrdinal,
          durationMinutes: nullableInputNumber(input, "defaultDurationMinutes"),
        }),
      ]);
    } catch (error) {
      localError(error);
    }
    return this.longTaskView(await this.getLongTaskRow(id));
  }

  async mountLongTask(input: Record<string, unknown>): Promise<unknown> {
    const idempotencyKey = requiredString(input, "idempotencyKey");
    const existing = await this.idempotentResult(idempotencyKey);
    if (existing.found) return this.getTrack(String(existing.value));
    const studentId = requiredString(input, "studentId");
    await this.getStudent(studentId);
    const definition = await this.getTemplateRow(
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
    await this.requireNoActiveSequenceTrack(studentId, definition);
    const trackId = crypto.randomUUID();
    const firstTask = await this.sequenceTaskInsertStatement({
      trackId,
      studentId,
      ordinal: currentOrdinal,
      title: renderSeriesTitlePattern(
        text(definition, "title_pattern"),
        currentOrdinal,
      ),
      candidateDate: anchorDate,
      durationOverride: nullableNumber(definition, "default_duration_minutes"),
    });
    if (!firstTask) {
      throw new ApiError(
        409,
        "90 天内没有可用学习日，无法生成首项任务",
        "TRACK_NO_AVAILABLE_DATE",
      );
    }
    await this.storage.transaction([
      this.sequenceTrackInsertStatement({
        trackId,
        studentId,
        definition,
        currentOrdinal,
        startDate: anchorDate,
      }),
      firstTask.statement,
      this.idempotencyStatement(idempotencyKey, "MOUNT_LONG_TASK", trackId),
    ]);
    return this.getTrack(trackId);
  }

  async convertTaskToLongTask(
    taskId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const idempotencyKey = requiredString(input, "idempotencyKey");
    const existing = await this.idempotentResult(idempotencyKey);
    if (existing.found) return existing.value;
    const task = await this.taskRow(taskId);
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
    const shape = this.sequencePatternFromTitle(text(task, "title_snapshot"));
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
    let definition = await this.findSequenceDefinitionByKey(
      shape.normalizedKey,
    );
    let definitionCreated = false;
    if (definition) {
      const definitionEnd = nullableNumber(definition, "sequence_end_ordinal");
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
      await this.storage.transaction([
        this.sequenceDefinitionInsertStatement({
          id: definitionId,
          name: shape.name,
          normalizedKey: shape.normalizedKey,
          titlePattern: shape.pattern,
          startOrdinal: ordinal,
          endOrdinal: inputEnd,
          durationMinutes: nullableInputNumber(input, "durationMinutes"),
        }),
      ]);
      definition = await this.getTemplateRow(definitionId);
      definitionCreated = true;
    }
    await this.requireNoActiveSequenceTrack(
      text(task, "student_id"),
      definition,
    );
    const trackId = crypto.randomUUID();
    const response = {
      taskId: text(task, "id"),
      trackId,
      ordinal,
      definitionCreated,
    };
    await this.storage.transaction([
      this.sequenceTrackInsertStatement({
        trackId,
        studentId: text(task, "student_id"),
        definition,
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
      this.idempotencyStatement(
        idempotencyKey,
        "CONVERT_TO_LONG_TASK",
        response,
      ),
    ]);
    return { ...response, track: await this.getTrack(trackId) };
  }

  async createAdHocTask(input: Record<string, unknown>): Promise<unknown> {
    await this.getStudent(requiredString(input, "studentId"));
    const scheduledDate = requiredString(input, "scheduledDate");
    // 日历有效性校验：2026-02-31 这类形状合法但不存在的日期必须在这里
    // 拒绝（422 INVALID_DATE），否则原样字符串入库后对排期/今日视图永远
    // 不可见，却仍会被日结的 scheduled_date <= 日期 字符串比较扫进来。
    parseDate(scheduledDate);
    const idempotencyKey = requiredString(input, "idempotencyKey");
    const existing = await this.idempotentResult(idempotencyKey);
    if (existing.found) {
      // 幂等记录只存了 {taskId}。重放必须像 mountTrack 一样重新读出完整
      // 任务视图返回——此前直接回 {taskId}，任何持有稳定 key 的调用方
      // （脚本/测试/未来的离线队列）在重试时都会拿到残缺形状。
      const replayedTaskId = (existing.value as { taskId?: unknown }).taskId;
      if (typeof replayedTaskId !== "string") {
        throw new ApiError(409, "幂等记录损坏", "LOCAL_DATABASE_ERROR");
      }
      return this.getTaskView(replayedTaskId);
    }
    const id = crypto.randomUUID();
    const timestamp = now();
    await this.storage.transaction([
      {
        sql: `INSERT INTO task_instance(
                id, student_id, source_type, scheduled_date, original_scheduled_date,
                status, title_snapshot, duration_minutes_snapshot,
                requires_device_snapshot, schedule_origin, locked, note,
                manual_override, star, version, created_at, updated_at
              ) VALUES ($1, $2, 'AD_HOC', $3, $3, 'PENDING', $4, $5, $6,
                        'AD_HOC', $7, $8, 0, 0, 0, $9, $9)`,
        values: [
          id,
          requiredString(input, "studentId"),
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
      this.idempotencyStatement(idempotencyKey, "CREATE_AD_HOC", {
        taskId: id,
      }),
    ]);
    return this.getTaskView(id);
  }

  async carryForwardTask(input: Record<string, unknown>): Promise<unknown> {
    const source = await this.taskRow(requiredString(input, "sourceTaskId"));
    const sourceSnapshot = this.taskSnapshot(source);
    const existingRows = await this.storage.select<DbRow>(
      `SELECT ${TASK_COLUMNS} FROM task_instance
       WHERE carried_from_instance_id = $1 AND status <> 'CANCELLED' LIMIT 1`,
      [sourceSnapshot.id],
    );
    const calendar = await this.studentCalendar(
      sourceSnapshot.studentId,
      sourceSnapshot.scheduledDate,
      shiftDate(sourceSnapshot.scheduledDate, 90),
    );
    try {
      const newTaskId = crypto.randomUUID();
      const result = transitionCarryForwardTask({
        source: sourceSnapshot,
        newTaskId,
        calendar,
        targetDate: nullableInputString(input, "targetDate") ?? undefined,
        reason: nullableInputString(input, "reason") ?? undefined,
        existingTarget: existingRows[0]
          ? this.taskSnapshot(existingRows[0])
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
      if (statements.length > 0) await this.storage.transaction(statements);
      // 不变式：statements 为空意味着 domain 原样复用了既有顺延目标，本次
      // 没有任何写库动作，源行保持数据库里的当前状态。此时重读源行、以真实
      // status 作答，而不是硬编码 CARRIED_OVER——正常路径下源行此时必然已是
      // CARRIED_OVER，这道防御只兜"源行异常仍 PENDING"的脏状态（审计
      // E MINOR-5）。
      const responseStatus =
        statements.length === 0
          ? text(await this.taskRow(sourceSnapshot.id), "status")
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

  async triggerDayClose(businessDate: string): Promise<unknown> {
    parseDate(businessDate);
    const startedAt = now();
    const candidates = await this.storage.select<DbRow>(
      `SELECT ${TASK_COLUMNS} FROM task_instance
       WHERE scheduled_date IS NOT NULL
         AND scheduled_date <= $1
         AND status = 'PENDING'
         AND locked = 0
       ORDER BY scheduled_date, COALESCE(sort_order, 2147483647), id`,
      [businessDate],
    );
    // ACC-067: an outcome row has to name the student and the task, otherwise a
    // blocked item is only a hex fragment and the assistant cannot act on it.
    const studentIds = [
      ...new Set(candidates.map((row) => text(row, "student_id"))),
    ];
    const studentNames = new Map<string, string>();
    if (studentIds.length > 0) {
      const placeholders = studentIds
        .map((_id, index) => `$${String(index + 1)}`)
        .join(", ");
      const nameRows = await this.storage.select<DbRow>(
        `SELECT id, name FROM student WHERE id IN (${placeholders})`,
        studentIds,
      );
      for (const row of nameRows) {
        studentNames.set(text(row, "id"), text(row, "name"));
      }
    }

    const items: Array<Record<string, unknown>> = [];
    let carried = 0;
    let blocked = 0;
    let skipped = 0;
    let failed = 0;
    let errorSummary: string | null = null;

    for (const candidate of candidates) {
      const sourceTaskId = text(candidate, "id");
      const studentId = text(candidate, "student_id");
      const descriptor = {
        studentId,
        studentName: studentNames.get(studentId) ?? null,
        title:
          nullableText(candidate, "short_title_snapshot") ??
          text(candidate, "title_snapshot"),
      };
      try {
        const result = (await this.carryForwardTask({
          sourceTaskId,
          targetDate: null,
          reason: `DAY_CLOSE:${businessDate}`,
        })) as Record<string, unknown>;
        const outcome =
          typeof result.status === "string" ? result.status : "SKIPPED";
        if (outcome === "CARRIED_OVER") carried += 1;
        else if (outcome === "BLOCKED") blocked += 1;
        else skipped += 1;
        items.push({
          ...descriptor,
          sourceTaskId,
          targetTaskId:
            typeof result.targetTaskId === "string"
              ? result.targetTaskId
              : null,
          targetDate:
            typeof result.targetDate === "string" ? result.targetDate : null,
          outcome,
          reason: typeof result.reason === "string" ? result.reason : null,
        });
      } catch (error) {
        failed += 1;
        const message =
          error instanceof Error ? error.message : "本地日结处理失败";
        errorSummary ??= message.slice(0, 200);
        items.push({
          ...descriptor,
          sourceTaskId,
          targetTaskId: null,
          targetDate: null,
          outcome: "FAILED",
          reason: message,
        });
      }
    }

    const finishedAt = now();
    return {
      runId: crypto.randomUUID(),
      businessDate,
      startedAt,
      finishedAt,
      scanned: candidates.length,
      carried,
      blocked,
      skipped,
      failed,
      status:
        failed === 0
          ? "SUCCEEDED"
          : carried + blocked + skipped > 0
            ? "PARTIAL"
            : "FAILED",
      errorSummary,
      items,
    };
  }

  async getTodayCarryovers(targetDate: string): Promise<unknown> {
    const rows = await this.storage.select<DbRow>(
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

  async undoCarryover(input: Record<string, unknown>): Promise<unknown> {
    const idempotencyKey = requiredString(input, "idempotencyKey");
    const existing = await this.idempotentResult(idempotencyKey);
    if (existing.found) return existing.value;
    const source = await this.taskRow(requiredString(input, "sourceTaskId"));
    const targetId = nullableText(source, "carried_to_instance_id");
    if (!targetId || text(source, "status") !== "CARRIED_OVER") {
      throw new ApiError(409, "顺延关系不存在", "CARRYOVER_NOT_FOUND");
    }
    const target = await this.taskRow(targetId);
    const timestamp = now();
    const response = {
      sourceTaskId: text(source, "id"),
      targetTaskId: targetId,
      sourceStatus: "PENDING",
      targetStatus: "CANCELLED",
      reason: "UNDO_CARRYOVER",
    };
    await this.storage.transaction([
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
      this.idempotencyStatement(idempotencyKey, "UNDO_CARRYOVER", response),
    ]);
    return response;
  }

  async getToday(date?: string): Promise<unknown> {
    const businessDate = date ?? formatDate(new Date());
    const students = await this.activeStudents();
    const tasks = await this.tasksBetween(businessDate, businessDate);
    const byStudent = new Map<string, DbRow[]>();
    for (const task of tasks) {
      const studentId = text(task, "student_id");
      byStudent.set(studentId, [...(byStudent.get(studentId) ?? []), task]);
    }
    const groups = students
      .map((student) => ({
        studentId: text(student, "id"),
        studentName: text(student, "name"),
        studentCode: text(student, "student_code"),
        devicePolicy: text(student, "default_device_policy"),
        tasks: (byStudent.get(text(student, "id")) ?? []).map((task) =>
          this.taskSummary(task),
        ),
      }))
      .filter((group) => group.tasks.length > 0);
    const allTasks = groups.flatMap((group) => group.tasks);
    return {
      businessDate,
      metrics: {
        totalStudents: groups.length,
        totalPendingTasks: allTasks.filter((task) => task.status === "PENDING")
          .length,
        totalCompletedTasks: allTasks.filter(
          (task) => task.status === "COMPLETED",
        ).length,
        carriedOverTasks: allTasks.filter(
          (task) => task.status === "CARRIED_OVER",
        ).length,
        blockedTasks: allTasks.filter((task) => task.status === "BLOCKED")
          .length,
        conflictCount: 0,
      },
      students: groups,
    };
  }

  async getWorkbench(from?: string, to?: string): Promise<unknown> {
    const start = from ?? formatDate(new Date());
    const end = to ?? shiftDate(start, 6);
    const dates = datesBetween(start, end);
    const students = await this.activeStudents();
    const tasks = await this.tasksBetween(start, end);
    const calendars = await this.availabilityCalendars(students, start, end);
    const vocabulary = await this.vocabularyCounts(start, end);
    return {
      range: { from: start, to: end },
      students: students.map((student) => {
        const studentId = text(student, "id");
        const calendar = calendars.get(studentId)!;
        return {
          id: studentId,
          name: text(student, "name"),
          code: text(student, "student_code"),
          devicePolicy: text(student, "default_device_policy"),
          tags: parseJsonArray(student.tags_json),
          vocabularyCountThisWeek: vocabulary.get(studentId) ?? 0,
          days: Object.fromEntries(
            dates.map((date) => {
              const availability = resolveStudyAvailability(calendar, date);
              return [
                date,
                {
                  date,
                  available: availability.available,
                  availableMinutes: availability.availableMinutes,
                  tasks: tasks
                    .filter(
                      (task) =>
                        text(task, "student_id") === studentId &&
                        nullableText(task, "scheduled_date") === date,
                    )
                    .map((task) => this.workbenchTaskSummary(task)),
                },
              ];
            }),
          ),
        };
      }),
    };
  }

  async getSchedule(
    studentId: string,
    params?: { from?: string; to?: string; view?: string },
  ): Promise<unknown> {
    const student = await this.studentRow(studentId);
    const view = params?.view ?? "week";
    const anchorDate = params?.from ?? formatDate(new Date());
    // An explicit `to` wins; otherwise the view decides how wide the window is.
    const window = params?.to
      ? { start: anchorDate, end: params.to }
      : scheduleWindow(anchorDate, view);
    const start = window.start;
    const end = window.end;
    const dates = datesBetween(start, end);
    const tasks = await this.tasksBetween(start, end, studentId);
    const calendar = (
      await this.availabilityCalendars([student], start, end)
    ).get(studentId)!;
    return {
      studentId,
      studentName: text(student, "name"),
      studentCode: text(student, "student_code"),
      devicePolicy: text(student, "default_device_policy"),
      fromDate: start,
      toDate: end,
      view,
      days: dates.map((date) => {
        const availability = resolveStudyAvailability(calendar, date);
        return {
          date,
          available: availability.available,
          availableMinutes: availability.availableMinutes,
          devicePolicy: availability.devicePolicy,
          tasks: tasks
            .filter((task) => nullableText(task, "scheduled_date") === date)
            .map((task) => this.taskSummary(task)),
        };
      }),
    };
  }

  /**
   * 本机单用户产品里，前端传来的 expectedVersion 与数据库不一致只可能是界面缓存
   * 陈旧，不存在两个人抢同一条任务。所以写命令以数据库当前版本为准直接执行，而
   * 不是把陈旧缓存当成冲突去拦住用户的操作。`AND version = ?` 仍然保留，用来保证
   * 同一事务内读到的行没有在中途被改写。
   */
  private async currentVersion(taskId: string): Promise<number> {
    return numberValue(await this.taskRow(taskId), "version");
  }

  async completeTask(input: Record<string, unknown>): Promise<unknown> {
    const idempotencyKey = requiredString(input, "idempotencyKey");
    const existing = await this.idempotentResult(idempotencyKey);
    if (existing.found) return existing.value;
    const task = await this.taskRow(requiredString(input, "taskId"));
    const track = await this.trackSnapshot(task);
    try {
      const result = transitionCompleteTask(
        this.taskSnapshot(task),
        track?.snapshot,
        idempotencyKey,
      );
      const timestamp = now();
      const response = {
        taskId: text(task, "id"),
        status: result.task.status,
        currentOrdinal: result.track?.currentOrdinal ?? null,
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
            const nextTask = await this.sequenceTaskInsertStatement({
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
            if (nextTask) statements.push(nextTask.statement);
          } else {
            const nextItems = await this.storage.select<DbRow>(
              `SELECT * FROM task_template_item
               WHERE template_version_id = $1 AND ordinal = $2 AND active = 1`,
              [
                text(track.row, "template_version_id"),
                result.track.currentOrdinal,
              ],
            );
            if (nextItems[0]) {
              const nextTask = await this.trackTaskInsertStatement({
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
              if (nextTask) statements.push(nextTask.statement);
            }
          }
        }
      }
      statements.push(
        this.idempotencyStatement(idempotencyKey, "COMPLETE_TASK", response),
      );
      await this.storage.transaction(statements);
      return response;
    } catch (error) {
      localError(error);
    }
  }

  async reopenTask(input: Record<string, unknown>): Promise<unknown> {
    const idempotencyKey = requiredString(input, "idempotencyKey");
    const existing = await this.idempotentResult(idempotencyKey);
    if (existing.found) return existing.value;
    const task = await this.taskRow(requiredString(input, "taskId"));
    const track = await this.trackSnapshot(task);
    try {
      const result = transitionReopenTask(
        this.taskSnapshot(task),
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
        this.idempotencyStatement(idempotencyKey, "REOPEN_TASK", response),
      );
      await this.storage.transaction(statements);
      return response;
    } catch (error) {
      localError(error);
    }
  }

  async rescheduleTask(input: Record<string, unknown>): Promise<unknown> {
    const task = await this.taskRow(requiredString(input, "taskId"));
    const targetDate = requiredString(input, "targetDate");
    // 与 createAdHocTask 同一口径：改期目标必须是真实存在的日历日。
    parseDate(targetDate);
    const targetStudentId =
      nullableInputString(input, "targetStudentId") ?? text(task, "student_id");
    // 学习日日历按目标学生取：跨学生移动时要用接收方的学习日规则判断。
    const calendar = await this.studentCalendar(
      targetStudentId,
      targetDate,
      targetDate,
    );
    try {
      const result = transitionRescheduleTask({
        task: this.taskSnapshot(task),
        targetDate,
        targetStudentId,
        calendar,
        overrideReason:
          nullableInputString(input, "overrideReason") ?? undefined,
      });
      const timestamp = now();
      await this.storage.transaction([
        {
          // status 走 $7（domain 计算结果）：完成状态保持不变，唯一的变更
          // 是 BLOCKED → PENDING——改期是 PRD §7.1 里阻塞任务唯一的人工
          // 出口，落到有效日期即解除阻塞。改期不推进 Track。
          // 跨学生时（student_id <> $2 对比的是更新前的旧值）任务脱离原
          // Track 与原学生的结构关系：track/模板三列与 parent_task_id /
          // linked_parent_task_id 一并清空，避免把一个学生的轨道实例或
          // 父子关系挂到另一个学生身上。
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

  async updateTask(
    taskId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const version = await this.currentVersion(taskId);
    const timestamp = now();
    try {
      await this.storage.transaction([
        {
          sql: `UPDATE task_instance SET
                title_snapshot = COALESCE($1, title_snapshot),
                note = CASE WHEN $2 IS NULL THEN note ELSE $2 END,
                priority = CASE WHEN $3 IS NULL THEN priority ELSE $3 END,
                star = CASE WHEN $4 IS NULL THEN star ELSE $4 END,
                version = version + 1, updated_at = $5
                WHERE id = $6 AND version = $7`,
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
    return this.getTaskView(taskId);
  }

  async duplicateTask(
    taskId: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    const source = await this.taskRow(taskId);
    const targetDate = optionalDateString(input, "targetDate");
    const timestamp = now();
    await this.storage.transaction([
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
   * 系列推进（用户反馈：完成“一天一句长难句day1”后点箭头，希望下一天自动
   * 变成 day2；当天已有 day1~day3 时，向下复制要接出 day4~day6）。以源任务
   * 为样板在其下一天生成新待办：标题尾部序号取同一学生同前缀（去掉尾部数字）
   * 已出现的最大值 +1，所以从系列任意一项点“下一项”都接在全局队尾，连续
   * 点几行就得到连续的下一个序号。标题没有尾部数字时退化为普通复制（标题
   * 不变，排到下一天）。新行不锁星标/优先级/时长以外的东西，仍然是独立的
   * AD_HOC 任务，改期删除互不影响。
   */
  async createNextSeriesTask(taskId: string): Promise<unknown> {
    const source = await this.taskRow(taskId);
    const sourceDate =
      nullableText(source, "scheduled_date") ?? formatDate(new Date());
    const targetDate = shiftDate(sourceDate, 1);
    const parsed = parseSeriesTitle(text(source, "title_snapshot"));
    let title = text(source, "title_snapshot");
    let shortTitle = nullableText(source, "short_title_snapshot");
    if (parsed) {
      // 任务量是本机单学生的量级，直接全量拉标题在内存里比对，避免 LIKE
      // 转义 %/_ 的坑。CANCELLED 行也计入最大值：序号已被占用就不复用。
      const rows = await this.storage.select<DbRow>(
        `SELECT title_snapshot FROM task_instance WHERE student_id = $1`,
        [text(source, "student_id")],
      );
      let max = parsed.number;
      for (const row of rows) {
        const candidate = parseSeriesTitle(text(row, "title_snapshot"));
        if (candidate && isSameSeries(candidate, parsed)) {
          max = Math.max(max, candidate.number);
        }
      }
      title = formatSeriesTitle(parsed, max + 1);
      // 短标题若是同一系列的编号形式（“真题24”之于“真题2024”），按主标题
      // 前进的增量同步 +1，保持缩写关系；其他形态原样保留。
      const shortParsed = shortTitle ? parseSeriesTitle(shortTitle) : null;
      if (shortTitle && shortParsed && isSameSeries(shortParsed, parsed)) {
        shortTitle = formatSeriesTitle(
          shortParsed,
          shortParsed.number + (max + 1 - parsed.number),
        );
      }
    }
    const id = crypto.randomUUID();
    const timestamp = now();
    await this.storage.transaction([
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
    return this.getTaskView(id);
  }

  async createSubTask(
    parentTaskId: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    const parent = await this.taskRow(parentTaskId);
    const scheduledDate = optionalDateString(input, "scheduledDate");
    const timestamp = now();
    await this.storage.transaction([
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

  async linkMainTask(
    taskId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const linkedParentTaskId = requiredString(input, "linkedParentTaskId");
    await this.taskRow(linkedParentTaskId);
    const version = await this.currentVersion(taskId);
    try {
      await this.storage.transaction([
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
    return this.getTaskView(taskId);
  }

  async deleteTask(
    taskId: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    const expectedVersion = requiredNumber(input, "expectedVersion");
    const task = await this.taskRow(taskId);
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

    // 轨道任务被删掉后，指针不能停在一个已经不存在的实例上。若该任务已完成且指针
    // 已经走到它后面，把指针退回它的序号，等于撤销这一次完成（与 reopen 一致）。
    const trackId = nullableText(task, "track_id");
    const ordinal = nullableNumber(task, "item_ordinal");
    if (trackId && ordinal != null) {
      const trackRows = await this.storage.select<DbRow>(
        `SELECT id, current_ordinal, version FROM student_task_track WHERE id = $1`,
        [trackId],
      );
      const track = trackRows[0];
      if (track && numberValue(track, "current_ordinal") > ordinal) {
        statements.push({
          sql: `UPDATE student_task_track SET current_ordinal = $1,
                status = 'ACTIVE', completed_at = NULL,
                version = version + 1, updated_at = $2
                WHERE id = $3 AND version = $4`,
          values: [ordinal, timestamp, trackId, numberValue(track, "version")],
          expectedRowsAffected: 1,
        });
      }
    }

    statements.push({
      // 顺延目标可能继承 TRACK 来源，但只要仍是可操作的 PENDING 任务就允许删除。
      // expectedVersion 必须来自调用方，避免旧卡片误删已经更新过的数据。
      sql: `DELETE FROM task_instance WHERE id = $1 AND version = $2`,
      values: [taskId, expectedVersion],
      expectedRowsAffected: 1,
    });

    try {
      await this.storage.transaction(statements);
    } catch (error) {
      localError(error);
    }
  }

  async reorderTask(
    taskId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const version = await this.currentVersion(taskId);
    try {
      await this.storage.transaction([
        {
          sql: `UPDATE task_instance SET sort_order = $1,
                version = version + 1, updated_at = $2
                WHERE id = $3 AND version = $4`,
          values: [
            requiredNumber(input, "newSortOrder"),
            now(),
            taskId,
            version,
          ],
          expectedRowsAffected: 1,
        },
      ]);
    } catch (error) {
      localError(error);
    }
    return this.getTaskView(taskId);
  }

  async listVocabulary(
    studentId: string,
    params?: { from?: string; to?: string; subject?: string },
  ): Promise<unknown> {
    const conditions = ["e.student_id = $1"];
    const values: unknown[] = [studentId];
    if (params?.from) {
      values.push(params.from);
      conditions.push(`e.occurred_date >= $${values.length}`);
    }
    if (params?.to) {
      values.push(params.to);
      conditions.push(`e.occurred_date <= $${values.length}`);
    }
    if (params?.subject) {
      values.push(params.subject);
      conditions.push(`e.subject_code = $${values.length}`);
    }
    const rows = await this.storage.select<DbRow>(
      `SELECT e.* FROM vocabulary_entry e
       WHERE ${conditions.join(" AND ")}
       ORDER BY e.created_at DESC, e.term_normalized`,
      values,
    );
    return {
      entries: rows.map((row) => this.vocabularyEntryView(row)),
      total: rows.length,
    };
  }

  async previewVocabularyBatch(
    studentId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    await this.getStudent(studentId);
    const terms = this.normalizeVocabularyTerms(
      requiredString(input, "rawText"),
    );
    const existingRows = terms.length
      ? await this.storage.select<DbRow>(
          `SELECT term_normalized FROM vocabulary_entry
           WHERE student_id = $1 AND term_normalized IN (${terms
             .map((_, index) => `$${index + 2}`)
             .join(", ")})`,
          [studentId, ...terms.map((term) => term.normalized)],
        )
      : [];
    const existing = new Set(
      existingRows.map((row) => text(row, "term_normalized")),
    );
    const entries = terms.map((term) => ({
      termOriginal: term.original,
      termNormalized: term.normalized,
      isDuplicate: existing.has(term.normalized),
    }));
    return {
      entries,
      totalCount: entries.length,
      duplicateCount: entries.filter((entry) => entry.isDuplicate).length,
      duplicates: entries
        .filter((entry) => entry.isDuplicate)
        .map((entry) => entry.termOriginal),
    };
  }

  async saveVocabularyBatch(
    studentId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    await this.getStudent(studentId);
    const rawTerms = record(input, "terms");
    const terms = Array.isArray(rawTerms)
      ? this.normalizeVocabularyTerms(rawTerms.join("\n"))
      : this.normalizeVocabularyTerms(requiredString(input, "rawText"));
    const batchId = crypto.randomUUID();
    const timestamp = now();
    const occurredDate =
      nullableInputString(input, "occurredDate") ?? formatDate(new Date());
    const statements: LocalSqlStatement[] = [
      {
        sql: `INSERT INTO vocabulary_batch(
                id, student_id, occurred_date, source_type, subject_code,
                source_label, raw_text, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        values: [
          batchId,
          studentId,
          occurredDate,
          nullableInputString(input, "sourceType") ?? "MANUAL",
          nullableInputString(input, "subjectCode"),
          nullableInputString(input, "sourceLabel"),
          nullableInputString(input, "rawText"),
          timestamp,
        ],
        expectedRowsAffected: 1,
      },
    ];
    for (const term of terms) {
      statements.push({
        sql: `INSERT INTO vocabulary_entry(
                id, batch_id, student_id, occurred_date, subject_code,
                term_original, term_normalized, status, version,
                created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', 0, $8, $8)`,
        values: [
          crypto.randomUUID(),
          batchId,
          studentId,
          occurredDate,
          nullableInputString(input, "subjectCode"),
          term.original,
          term.normalized,
          timestamp,
        ],
        expectedRowsAffected: 1,
      });
    }
    await this.storage.transaction(statements);
    return batchId;
  }

  async updateVocabularyEntry(
    entryId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const entryRows = await this.storage.select<DbRow>(
      `SELECT version FROM vocabulary_entry WHERE id = $1`,
      [entryId],
    );
    const entry = entryRows[0];
    if (!entry) {
      throw new ApiError(404, "生词条目不存在", "VOCABULARY_ENTRY_NOT_FOUND");
    }
    try {
      await this.storage.transaction([
        {
          sql: `UPDATE vocabulary_entry SET
                status = CASE WHEN $1 IS NULL THEN status ELSE $1 END,
                note = CASE WHEN $2 IS NULL THEN note ELSE $2 END,
                version = version + 1, updated_at = $3
                WHERE id = $4 AND version = $5`,
          values: [
            record(input, "status") ?? null,
            record(input, "note") ?? null,
            now(),
            entryId,
            numberValue(entry, "version"),
          ],
          expectedRowsAffected: 1,
        },
      ]);
    } catch (error) {
      localError(error);
    }
    const rows = await this.storage.select<DbRow>(
      "SELECT * FROM vocabulary_entry WHERE id = $1",
      [entryId],
    );
    if (!rows[0]) {
      throw new ApiError(404, "生词条目不存在", "VOCABULARY_ENTRY_NOT_FOUND");
    }
    return this.vocabularyEntryView(rows[0]);
  }

  async searchGlobal(query: string, limit: number): Promise<unknown> {
    const pattern = `%${query.trim().toLocaleLowerCase()}%`;
    if (pattern === "%%") return { query, groups: [], parsedDateHint: null };
    const [students, templates, tasks, vocabulary] = await Promise.all([
      this.storage.select<DbRow>(
        `SELECT id, name, student_code, status FROM student
         WHERE lower(name) LIKE $1 OR lower(student_code) LIKE $1 LIMIT $2`,
        [pattern, limit],
      ),
      this.storage.select<DbRow>(
        `SELECT id, name, template_code, status FROM task_template
         WHERE lower(name) LIKE $1 OR lower(template_code) LIKE $1 LIMIT $2`,
        [pattern, limit],
      ),
      this.storage.select<DbRow>(
        `SELECT id, title_snapshot, scheduled_date, status FROM task_instance
         WHERE lower(title_snapshot) LIKE $1 LIMIT $2`,
        [pattern, limit],
      ),
      this.storage.select<DbRow>(
        `SELECT id, term_original, student_id, status FROM vocabulary_entry
         WHERE lower(term_normalized) LIKE $1 LIMIT $2`,
        [pattern, limit],
      ),
    ]);
    const groups = [
      {
        type: "STUDENT",
        items: students.map((row) => ({
          id: text(row, "id"),
          type: "STUDENT",
          title: text(row, "name"),
          subtitle: text(row, "student_code"),
          status: text(row, "status"),
          payload: null,
        })),
      },
      {
        type: "TEMPLATE",
        items: templates.map((row) => ({
          id: text(row, "id"),
          type: "TEMPLATE",
          title: text(row, "name"),
          subtitle: text(row, "template_code"),
          status: text(row, "status"),
          payload: null,
        })),
      },
      {
        type: "TASK",
        items: tasks.map((row) => ({
          id: text(row, "id"),
          type: "TASK",
          title: text(row, "title_snapshot"),
          subtitle: nullableText(row, "scheduled_date"),
          status: text(row, "status"),
          payload: null,
        })),
      },
      {
        type: "VOCABULARY",
        items: vocabulary.map((row) => ({
          id: text(row, "id"),
          type: "VOCABULARY",
          title: text(row, "term_original"),
          subtitle: text(row, "student_id"),
          status: text(row, "status"),
          payload: null,
        })),
      },
    ].filter((group) => group.items.length > 0);
    return {
      query,
      groups,
      parsedDateHint: /^\d{4}-\d{2}-\d{2}$/.test(query) ? query : null,
    };
  }

  private vocabularyEntryView(row: DbRow): Record<string, unknown> {
    return {
      id: text(row, "id"),
      batchId: text(row, "batch_id"),
      studentId: text(row, "student_id"),
      termOriginal: text(row, "term_original"),
      termNormalized: text(row, "term_normalized"),
      status: text(row, "status"),
      note: nullableText(row, "note"),
      version: numberValue(row, "version"),
      createdAt: text(row, "created_at"),
    };
  }

  private normalizeVocabularyTerms(
    rawText: string,
  ): Array<{ original: string; normalized: string }> {
    const seen = new Set<string>();
    const result: Array<{ original: string; normalized: string }> = [];
    for (const original of rawText
      .split(/[\s,，;；]+/)
      .map((value) => value.trim())
      .filter(Boolean)) {
      const normalized = original.normalize("NFKC").toLocaleLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      result.push({ original, normalized });
    }
    return result;
  }

  private templateView(row: DbRow): Record<string, unknown> {
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

  private templateVersionView(row: DbRow): Record<string, unknown> {
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

  private templateItemView(row: DbRow): Record<string, unknown> {
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

  private async getTemplateRow(templateId: string): Promise<DbRow> {
    const rows = await this.storage.select<DbRow>(
      "SELECT * FROM task_template WHERE id = $1",
      [templateId],
    );
    if (!rows[0]) {
      throw new ApiError(404, "任务模板不存在", "TEMPLATE_NOT_FOUND");
    }
    return rows[0];
  }

  private async getLongTaskRow(templateId: string): Promise<DbRow> {
    const rows = await this.storage.select<DbRow>(
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

  private async getTemplateSummary(templateId: string): Promise<unknown> {
    const rows = await this.storage.select<DbRow>(
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
    return this.templateView(rows[0]);
  }

  private trackView(row: DbRow): Record<string, unknown> {
    const startOrdinal = numberValue(row, "start_ordinal");
    const currentOrdinal = numberValue(row, "current_ordinal");
    // 开放型长期任务没有结束序号：totalUnits/percent 无定义，交由 UI 隐藏。
    const endOrdinal = nullableNumber(row, "end_ordinal");
    const totalUnits =
      endOrdinal == null ? null : endOrdinal - startOrdinal + 1;
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
      warnings: [],
    };
  }

  private async getTrackRow(trackId: string): Promise<DbRow> {
    const rows = await this.storage.select<DbRow>(
      "SELECT * FROM student_task_track WHERE id = $1",
      [trackId],
    );
    if (!rows[0]) throw new ApiError(404, "任务轨道不存在", "TRACK_NOT_FOUND");
    return rows[0];
  }

  private async trackTaskInsertStatement(input: {
    trackId: string;
    studentId: string;
    templateVersionId: string;
    item: DbRow;
    candidateDate: string;
    durationOverride: number | null;
    manualOverride?: boolean;
    overrideReason?: string | null;
  }): Promise<{
    statement: LocalSqlStatement;
    taskId: string;
    scheduledDate: string;
  } | null> {
    const existing = await this.storage.select<DbRow>(
      `SELECT id FROM task_instance
       WHERE track_id = $1 AND template_item_id = $2 AND status = 'PENDING' LIMIT 1`,
      [input.trackId, text(input.item, "id")],
    );
    if (existing[0]) return null;
    const calendar = await this.studentCalendar(
      input.studentId,
      input.candidateDate,
      shiftDate(input.candidateDate, 90),
    );
    const requiresDevice =
      input.item.requires_device == null
        ? false
        : bool(input.item, "requires_device");
    const availability = resolveStudyAvailability(
      calendar,
      input.candidateDate,
    );
    const candidateAllowed =
      availability.available &&
      (!requiresDevice || availability.devicePolicy === "ALLOWED");
    const scheduledDate = candidateAllowed
      ? input.candidateDate
      : findNextAvailableStudyDate({
          calendar,
          afterDate: input.candidateDate,
          requiresDevice,
          horizonDays: 90,
        });
    if (!scheduledDate) return null;
    const timestamp = now();
    const taskId = crypto.randomUUID();
    return {
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

  /**
   * 任意任务标题 → 长期任务模板形状。尾部数字（含"第N天"）优先：数字既是
   * 模板起点也是当前序号；无数字的标题按"标题 + 空格 + {n}"成模板，从 1 起。
   */
  private sequencePatternFromTitle(title: string): {
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
        name: parsed.prefix.trim() || title.trim(),
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
  private async findSequenceDefinitionByKey(
    normalizedKey: string,
  ): Promise<DbRow | undefined> {
    const rows = await this.storage.select<DbRow>(
      `SELECT * FROM task_template
       WHERE generation_mode = 'SEQUENCE' AND status = 'ACTIVE'
         AND normalized_key = $1
       ORDER BY created_at LIMIT 1`,
      [normalizedKey],
    );
    return rows[0];
  }

  private sequenceDefinitionInsertStatement(input: {
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

  private sequenceTrackInsertStatement(input: {
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

  private async requireNoActiveSequenceTrack(
    studentId: string,
    definition: DbRow,
  ): Promise<void> {
    const duplicates = await this.storage.select<DbRow>(
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
   * 下一真实可学习日（AC-LT-003），90 天无解返回 null 由调用方决定语义。
   */
  private async sequenceTaskInsertStatement(input: {
    trackId: string;
    studentId: string;
    ordinal: number;
    title: string;
    candidateDate: string;
    durationOverride: number | null;
  }): Promise<{
    statement: LocalSqlStatement;
    taskId: string;
    scheduledDate: string;
  } | null> {
    const existing = await this.storage.select<DbRow>(
      `SELECT id FROM task_instance
       WHERE track_id = $1 AND item_ordinal = $2 AND status = 'PENDING' LIMIT 1`,
      [input.trackId, input.ordinal],
    );
    if (existing[0]) return null;
    const calendar = await this.studentCalendar(
      input.studentId,
      input.candidateDate,
      shiftDate(input.candidateDate, 90),
    );
    const availability = resolveStudyAvailability(
      calendar,
      input.candidateDate,
    );
    const scheduledDate = availability.available
      ? input.candidateDate
      : findNextAvailableStudyDate({
          calendar,
          afterDate: input.candidateDate,
          requiresDevice: false,
          horizonDays: 90,
        });
    if (!scheduledDate) return null;
    const timestamp = now();
    const taskId = crypto.randomUUID();
    return {
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

  private longTaskView(row: DbRow): Record<string, unknown> {
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

  private studentView(row: DbRow): Record<string, unknown> {
    return {
      id: text(row, "id"),
      studentCode: text(row, "student_code"),
      name: text(row, "name"),
      alias: nullableText(row, "alias"),
      status: text(row, "status"),
      classType: nullableText(row, "class_type"),
      enrollmentDate: nullableText(row, "enrollment_date"),
      defaultDevicePolicy: text(row, "default_device_policy"),
      primaryAssistantId: null,
      note: nullableText(row, "note"),
      tags: parseJsonArray(row.tags_json),
      subjectPreferences: parseJsonArray(row.subject_preferences_json),
      version: numberValue(row, "version"),
      updatedAt: text(row, "updated_at"),
    };
  }

  private normalizeSubjectPreferences(
    value: unknown,
    timestamp: string,
  ): unknown[] {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => {
      const preference = entry as Record<string, unknown>;
      return {
        id:
          typeof preference.id === "string"
            ? preference.id
            : crypto.randomUUID(),
        subjectCode: requiredString(preference, "subjectCode"),
        priority: requiredNumber(preference, "priority"),
        targetRatio: requiredNumber(preference, "targetRatio"),
        note: nullableInputString(preference, "note"),
        version:
          typeof preference.version === "number" ? preference.version : 0,
        updatedAt:
          typeof preference.updatedAt === "string"
            ? preference.updatedAt
            : timestamp,
      };
    });
  }

  private weekPlanView(studentId: string, weekStart: string, rows: DbRow[]) {
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

  private async activeStudents(): Promise<DbRow[]> {
    return this.storage.select<DbRow>(
      "SELECT * FROM student WHERE status = 'ACTIVE' ORDER BY name, student_code",
    );
  }

  private async studentRow(studentId: string): Promise<DbRow> {
    const rows = await this.storage.select<DbRow>(
      "SELECT * FROM student WHERE id = $1",
      [studentId],
    );
    if (!rows[0]) throw new ApiError(404, "学生不存在", "STUDENT_NOT_FOUND");
    return rows[0];
  }

  private async tasksBetween(
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

  private taskSummary(row: DbRow): Record<string, unknown> {
    return {
      id: text(row, "id"),
      title: text(row, "title_snapshot"),
      shortTitle: nullableText(row, "short_title_snapshot"),
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

  private workbenchTaskSummary(row: DbRow): Record<string, unknown> {
    const summary = this.taskSummary(row);
    return { ...summary, shortTitle: summary.shortTitle ?? summary.title };
  }

  private async availabilityCalendars(
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

  private async studentCalendar(
    studentId: string,
    from: string,
    to: string,
  ): Promise<AvailabilityCalendar> {
    const student = await this.studentRow(studentId);
    return (await this.availabilityCalendars([student], from, to)).get(
      studentId,
    )!;
  }

  private async vocabularyCounts(
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

  private async taskRow(taskId: string): Promise<DbRow> {
    const rows = await this.storage.select<DbRow>(
      `SELECT ${TASK_COLUMNS} FROM task_instance WHERE id = $1`,
      [taskId],
    );
    if (!rows[0]) throw new ApiError(404, "任务不存在", "TASK_NOT_FOUND");
    return rows[0];
  }

  private async getTaskView(taskId: string): Promise<Record<string, unknown>> {
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

  private taskSnapshot(row: DbRow): TaskInstanceSnapshot {
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

  private async trackSnapshot(
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

  private async idempotentResult(
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

  private idempotencyStatement(
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
