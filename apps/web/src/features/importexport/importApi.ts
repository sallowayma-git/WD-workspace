import { z } from "zod";
import { getJson, postJson } from "../../lib/api/http";
import { getAccessToken } from "../auth/authStore";

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
  const formData = new FormData();
  formData.append("file", file);
  const environment = import.meta.env as unknown as Record<string, unknown>;
  const baseUrl =
    typeof environment.VITE_API_BASE_URL === "string"
      ? environment.VITE_API_BASE_URL
      : "/api/v1";
  const response = await fetch(`${baseUrl}/imports/template-xlsx`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(getAccessToken()
        ? { Authorization: `Bearer ${getAccessToken()}` }
        : {}),
    },
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`上传失败: ${response.status} ${response.statusText}`);
  }
  return importPreviewSchema.parse(await response.json());
}

export function executeImport(
  jobId: string,
  mappings: ColumnMapping[],
): Promise<ImportJobStatus> {
  return postJson(`/imports/${jobId}/execute`, importJobStatusSchema, {
    mappings,
  });
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
  return getJson(
    `/imports/${jobId}/errors?limit=${limit}&offset=${offset}`,
    importErrorListSchema,
  );
}

/**
 * Trigger a browser download of the row-level import errors as a CSV file
 * (GET /imports/{jobId}/errors?format=csv).
 */
export async function downloadImportErrorsCsv(jobId: string): Promise<void> {
  const environment = import.meta.env as unknown as Record<string, unknown>;
  const baseUrl =
    typeof environment.VITE_API_BASE_URL === "string"
      ? environment.VITE_API_BASE_URL
      : "/api/v1";
  const response = await fetch(
    `${baseUrl}/imports/${jobId}/errors?format=csv`,
    {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "text/csv",
        ...(getAccessToken()
          ? { Authorization: `Bearer ${getAccessToken()}` }
          : {}),
      },
    },
  );
  if (!response.ok) {
    throw new Error(`下载错误明细失败: ${response.status} ${response.statusText}`);
  }
  const blob = await response.blob();
  const filename = parseCsvFilename(
    response.headers.get("Content-Disposition"),
    `import-errors-${jobId}.csv`,
  );
  triggerBrowserDownload(blob, filename);
}

function parseCsvFilename(
  contentDisposition: string | null,
  fallback: string,
): string {
  if (!contentDisposition) return fallback;
  const match = contentDisposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] ? decodeURIComponent(match[1]) : fallback;
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
