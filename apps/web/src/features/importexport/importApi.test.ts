import * as XLSX from "xlsx";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataAdapter } from "../../data/DataAdapter";
import { setDataAdapterForTests } from "../../data/runtime";
import { browserPlatformAdapter } from "../../lib/platform/browserPlatformAdapter";
import {
  downloadImportErrorsCsv,
  parseScheduleWorkbook,
  type ImportError,
} from "./importApi";

function workbookFile(rows: unknown[][]): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    "学生工作台",
  );
  const bytes = XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx",
  }) as ArrayBuffer;
  return new File([bytes], "schedule.xlsx");
}

describe("schedule and template import helpers", () => {
  afterEach(() => {
    setDataAdapterForTests(null);
    vi.restoreAllMocks();
  });

  it.each([[["编号", "2026-09-21 周一"]], [["姓名", "课程"]]])(
    "rejects a workbook without the required %j column",
    async (headers) => {
      await expect(
        parseScheduleWorkbook(workbookFile([headers])),
      ).rejects.toThrow("排期 Excel 格式错误");
    },
  );

  it("downloads every page of import errors", async () => {
    const errors = vi.fn<
      (
        _jobId: string,
        limit?: number,
        offset?: number,
      ) => Promise<{ jobId: string; total: number; errors: ImportError[] }>
    >((_jobId, limit = 200, offset = 0) =>
      Promise.resolve({
        jobId: "job-1",
        total: 401,
        errors: Array.from(
          { length: Math.min(limit, 401 - offset) },
          (_, index) => ({
            sheet: "学生工作台",
            rowNumber: offset + index + 2,
            columnName: "2026-09-21 周一",
            errorCode: "INVALID",
            message: `错误 ${offset + index}`,
            rawValue: null,
          }),
        ),
      }),
    );
    setDataAdapterForTests({
      getImportErrors: errors,
    } as unknown as DataAdapter);
    const saveFile = vi
      .spyOn(browserPlatformAdapter, "saveFile")
      .mockResolvedValue(true);

    await expect(downloadImportErrorsCsv("job-1")).resolves.toBe(true);
    expect(errors).toHaveBeenNthCalledWith(1, "job-1", 200, 0);
    expect(errors).toHaveBeenNthCalledWith(2, "job-1", 200, 200);
    expect(errors).toHaveBeenNthCalledWith(3, "job-1", 200, 400);
    const savedBlob = saveFile.mock.calls[0]?.[0];
    if (!savedBlob) throw new Error("saveFile was not called");
    const csv = await savedBlob.text();
    expect(csv.split("\r\n")).toHaveLength(402);
    expect(csv).toContain("错误 400");
  });
});
