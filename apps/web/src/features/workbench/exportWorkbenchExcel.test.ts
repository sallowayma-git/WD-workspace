import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { parseScheduleWorkbook } from "../importexport/importApi";
import { browserPlatformAdapter } from "../../lib/platform/browserPlatformAdapter";
import { exportWorkbenchExcel, workbenchRows } from "./exportWorkbenchExcel";
import type { WorkbenchResponse } from "./workbenchApi";

function sample(): WorkbenchResponse {
  return {
    range: { from: "2026-09-21", to: "2026-09-23" },
    students: [
      {
        id: "10000000-0000-4000-8000-000000000001",
        name: "林同学",
        code: "S001",
        classType: "强化班",
        examDate: "2026-12-01",
        status: "ACTIVE",
        note: null,
        devicePolicy: "CONFIRM",
        tags: [],
        vocabularyCountThisWeek: 0,
        days: {
          "2026-09-21": {
            date: "2026-09-21",
            available: true,
            availableMinutes: 90,
            tasks: [
              {
                id: "20000000-0000-4000-8000-000000000001",
                title: "2025真题1",
                shortTitle: "2025真题1",
                status: "PENDING",
                version: 0,
              },
              {
                id: "20000000-0000-4000-8000-000000000002",
                title: "生词",
                shortTitle: "生词",
                status: "PENDING",
                version: 0,
              },
            ],
          },
          "2026-09-22": {
            date: "2026-09-22",
            available: false,
            availableMinutes: 0,
            tasks: [],
          },
        },
      },
    ],
  };
}

describe("workbench Excel format", () => {
  it("uses the complete ISO range even when a day is absent from a student", () => {
    const rows = workbenchRows(sample());
    expect(rows[0]).toEqual([
      1,
      "林同学",
      "S001",
      "强化班",
      "2026-12-01",
      "不紧急",
      "",
      "1.2025真题1\n2.生词",
      "休息",
      "",
    ]);
  });

  it("parses a workbook cell back into numbered titles and skips rest days", async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [
        "序号",
        "姓名",
        "编号",
        "班级",
        "考试日期",
        "状态",
        "备注",
        "2026-09-21 周一",
        "2026-09-22 周二",
      ],
      [
        1,
        "林同学",
        "S001",
        "强化班",
        "",
        "ACTIVE",
        "",
        "1.2025真题1\n2、 生词",
        "休息",
      ],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "学生工作台");
    const bytes = XLSX.write(workbook, {
      type: "array",
      bookType: "xlsx",
    }) as ArrayBuffer;
    const rows = await parseScheduleWorkbook(
      new File([bytes], "schedule.xlsx"),
    );
    expect(rows).toEqual([
      {
        studentCode: "S001",
        studentName: "林同学",
        date: "2026-09-21",
        titles: ["2025真题1", "生词"],
      },
    ]);
  });

  it("writes wrapped cells and freezes the first two columns", async () => {
    let saved: Blob | undefined;
    vi.spyOn(browserPlatformAdapter, "saveFile").mockImplementation((blob) => {
      saved = blob;
      return Promise.resolve(true);
    });
    await exportWorkbenchExcel(sample());
    expect(saved).toBeInstanceOf(Blob);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await saved!.arrayBuffer());
    const sheet = workbook.getWorksheet("学生工作台")!;
    expect(sheet.views[0]).toMatchObject({
      state: "frozen",
      xSplit: 2,
      ySplit: 1,
    });
    expect(sheet.getCell(2, 8).alignment?.wrapText).toBe(true);
    expect(sheet.getCell(2, 9).value).toBe("休息");
  });

  it("reports a cancelled save instead of a successful export", async () => {
    vi.spyOn(browserPlatformAdapter, "saveFile").mockResolvedValue(false);
    await expect(exportWorkbenchExcel(sample())).resolves.toBe(false);
  });
});
