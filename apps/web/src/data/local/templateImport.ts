//! Excel 模板导入：唯一有内存态的领域模块（jobId → 解析结果），所以做成工厂闭包。

import * as XLSX from "xlsx";
import { ApiError } from "../../lib/api/ApiError";
import { requiredString } from "./rows";

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

/** 导入落库要经过模板模块，这里只声明用到的那四个入口。 */
export type TemplateImportDeps = {
  createTemplate(input: Record<string, unknown>): Promise<unknown>;
  getTemplateDetail(templateId: string): Promise<unknown>;
  replaceVersionItems(
    versionId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  publishVersion(versionId: string): Promise<unknown>;
};

export type TemplateImport = {
  previewTemplateImport(file: File): Promise<unknown>;
  executeTemplateImport(
    jobId: string,
    mappings: Array<Record<string, unknown>>,
  ): Promise<unknown>;
  getImportErrors(
    jobId: string,
    limit?: number,
    offset?: number,
  ): Promise<unknown>;
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

export function createTemplateImport(deps: TemplateImportDeps): TemplateImport {
  const importJobs = new Map<string, LocalImportJob>();

  function requireJob(jobId: string): LocalImportJob {
    const job = importJobs.get(jobId);
    if (!job) throw new ApiError(404, "导入任务不存在", "IMPORT_JOB_NOT_FOUND");
    return job;
  }

  async function previewTemplateImport(file: File): Promise<unknown> {
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
    importJobs.set(jobId, {
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

  async function executeTemplateImport(
    jobId: string,
    mappings: Array<Record<string, unknown>>,
  ): Promise<unknown> {
    const job = requireJob(jobId);
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
        const created = (await deps.createTemplate({
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
        const detail = (await deps.getTemplateDetail(created.id)) as {
          versions: Array<{ id: string; status: string }>;
        };
        const draft = detail.versions.find(
          (version) => version.status === "DRAFT",
        );
        if (!draft) throw new Error("模板草稿版本不存在");
        await deps.replaceVersionItems(draft.id, {
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
        await deps.publishVersion(draft.id);
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
      totalColumns: mappings.length,
      succeededColumns,
      failedColumns: errors.length,
      errors: errors.map((error) =>
        typeof error.message === "string" ? error.message : "导入失败",
      ),
    };
  }

  function getImportErrors(
    jobId: string,
    limit = 200,
    offset = 0,
  ): Promise<unknown> {
    const job = requireJob(jobId);
    return Promise.resolve({
      jobId,
      errors: job.errors.slice(offset, offset + limit),
      total: job.errors.length,
    });
  }

  return { previewTemplateImport, executeTemplateImport, getImportErrors };
}
