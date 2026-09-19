import { z } from "zod";
import { getDataAdapter } from "../../data/runtime";
import { getPlatformAdapter } from "../../lib/platform/runtimePlatformAdapter";
import type {
  ScheduleImportPlan,
  ScheduleImportRow,
} from "../../data/local/scheduleImport";
import * as XLSX from "xlsx";

const columnPreviewSchema = z.object({
  columnLabel: z.string(),
  metadata: z.string(),
  parsedUnit: z.string().nullable(),
  parsedTotal: z.number().nullable(),
  parsedDurationMinutes: z.number().nullable(),
  nonEmptyCount: z.number(),
  sampleTitles: z.array(z.string()),
  allTitles: z.array(z.string()),
  error: z.string().nullable(),
});

export const importPreviewSchema = z.object({
  jobId: z.string().uuid(),
  fileName: z.string(),
  fileSha256: z.string(),
  columns: z.array(columnPreviewSchema),
  totalColumns: z.number(),
  validColumns: z.number(),
});

export type ImportPreview = z.infer<typeof importPreviewSchema>;
export type ColumnPreview = z.infer<typeof columnPreviewSchema>;

export const importJobStatusSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  fileName: z.string(),
  summary: z.string(),
  totalColumns: z.number(),
  succeededColumns: z.number(),
  failedColumns: z.number(),
  errors: z.array(z.string()),
});

export type ImportJobStatus = z.infer<typeof importJobStatusSchema>;

export const importErrorSchema = z.object({
  sheet: z.string(),
  rowNumber: z.number().nullable(),
  columnName: z.string().nullable(),
  errorCode: z.string().nullable(),
  message: z.string().nullable(),
  rawValue: z.string().nullable(),
});

export const importErrorListSchema = z.object({
  jobId: z.string(),
  errors: z.array(importErrorSchema),
  total: z.number(),
});

export type ImportError = z.infer<typeof importErrorSchema>;
export type ImportErrorList = z.infer<typeof importErrorListSchema>;

const scheduleImportCreateSchema = z.object({
  studentId: z.string().uuid(),
  studentCode: z.string().optional(),
  studentName: z.string(),
  date: z.string(),
  titles: z.array(z.string()).length(1),
});
const scheduleImportPlanSchema = z.object({
  toCreate: z.array(scheduleImportCreateSchema),
  skippedDuplicates: z.number().int().nonnegative(),
  unmatchedStudents: z.array(
    z.object({
      studentCode: z.string().optional(),
      studentName: z.string(),
      rowNumbers: z.array(z.number()),
    }),
  ),
  invalidRows: z.array(
    z.object({
      rowNumber: z.number(),
      reason: z.string(),
      row: z.object({
        studentCode: z.string().optional(),
        studentName: z.string(),
        date: z.string(),
        titles: z.array(z.string()),
      }),
    }),
  ),
});
const scheduleImportResultSchema = z.object({
  created: z.number().int().nonnegative(),
});

export type ScheduleImportPreview = z.infer<typeof scheduleImportPlanSchema>;
export type ScheduleImportResult = z.infer<typeof scheduleImportResultSchema>;

/** Parse the exported workbook shape; date columns are identified by ISO prefix. */
function workbookCellText(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return "";
}

export async function parseScheduleWorkbook(
  file: File,
): Promise<ScheduleImportRow[]> {
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, {
    type: "array",
    raw: false,
    cellDates: true,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
  if (!sheet) return [];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  const headers = (matrix[0] ?? []).map((value) =>
    workbookCellText(value).trim(),
  );
  const nameIndex = headers.indexOf("姓名");
  const codeIndex = headers.indexOf("编号");
  const dateColumns = headers
    .map((header, index) => ({
      header,
      index,
      match: /^(\d{4}-\d{2}-\d{2})/.exec(header),
    }))
    .filter(
      (
        column,
      ): column is { header: string; index: number; match: RegExpExecArray } =>
        Boolean(column.match),
    );
  if (nameIndex < 0 || dateColumns.length === 0) return [];
  const rows: ScheduleImportRow[] = [];
  for (const rawRow of matrix.slice(1)) {
    const studentName = workbookCellText(rawRow[nameIndex]).trim();
    const studentCode =
      codeIndex >= 0 ? workbookCellText(rawRow[codeIndex]).trim() : "";
    if (!studentName) continue;
    for (const { index, match } of dateColumns) {
      const value = workbookCellText(rawRow[index]).trim();
      if (!value || value === "休息") continue;
      const titles = value
        .split(/\r?\n/)
        .map((line) =>
          line
            .trim()
            .replace(/^\s*\d+\s*[.、)]\s*/, "")
            .trim(),
        )
        .filter((title) => title && title !== "休息");
      if (titles.length === 0) continue;
      rows.push({
        ...(studentCode ? { studentCode } : {}),
        studentName,
        date: match[1],
        titles,
      });
    }
  }
  return rows;
}

export type ColumnMapping = {
  columnLabel: string;
  action: "CREATE" | "IGNORE";
  templateCode: string;
  templateName: string;
  shortName?: string;
  subjectCode?: string;
  categoryCode?: string;
  unitLabel?: string;
  defaultDurationMinutes?: number;
  defaultRequiresDevice?: boolean;
};

export async function uploadTemplateXlsx(file: File): Promise<ImportPreview> {
  return importPreviewSchema.parse(
    await getDataAdapter().previewTemplateImport(file),
  );
}

export function executeImport(
  jobId: string,
  mappings: ColumnMapping[],
): Promise<ImportJobStatus> {
  return getDataAdapter()
    .executeTemplateImport(jobId, mappings)
    .then((value) => importJobStatusSchema.parse(value));
}

/**
 * List row-level import errors for a job (GET /imports/{jobId}/errors). Returns
 * JSON with simple limit/offset pagination.
 */
export function getImportErrors(
  jobId: string,
  limit = 200,
  offset = 0,
): Promise<ImportErrorList> {
  return getDataAdapter()
    .getImportErrors(jobId, limit, offset)
    .then((value) => importErrorListSchema.parse(value));
}

/**
 * Save the row-level import errors as a CSV file through the platform adapter.
 */
export async function downloadImportErrorsCsv(jobId: string): Promise<void> {
  const result = await getImportErrors(jobId, 200, 0);
  const rows = [
    ["Sheet", "行号", "列", "错误码", "信息", "原始值"],
    ...result.errors.map((error) => [
      error.sheet,
      error.rowNumber,
      error.columnName,
      error.errorCode,
      error.message,
      error.rawValue,
    ]),
  ];
  const csv = rows
    .map((row) => row.map((value) => csvCell(value)).join(","))
    .join("\r\n");
  await getPlatformAdapter().saveFile(
    new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
    `import-errors-${jobId}.csv`,
  );
}

export function previewScheduleImport(
  rows: ScheduleImportRow[],
): Promise<ScheduleImportPreview> {
  return getDataAdapter()
    .previewScheduleImport(rows)
    .then((value) => scheduleImportPlanSchema.parse(value));
}

export function executeScheduleImport(
  plan: ScheduleImportPlan,
): Promise<ScheduleImportResult> {
  return getDataAdapter()
    .executeScheduleImport(plan)
    .then((value) => scheduleImportResultSchema.parse(value));
}

function csvCell(value: unknown): string {
  const text =
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
      ? String(value)
      : "";
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
