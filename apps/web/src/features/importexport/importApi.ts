import { z } from "zod";
import { getDataAdapter } from "../../data/runtime";
import { getPlatformAdapter } from "../../lib/platform/runtimePlatformAdapter";

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

function csvCell(value: unknown): string {
  const text =
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
      ? String(value)
      : "";
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
