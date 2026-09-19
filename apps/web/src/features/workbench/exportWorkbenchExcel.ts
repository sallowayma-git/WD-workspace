import ExcelJS from "exceljs";
import type { WorkbenchResponse } from "./workbenchApi";
import { formatDayTaskList } from "./copyDayTasks";
import { getPlatformAdapter } from "../../lib/platform/runtimePlatformAdapter";
import { datesBetween, parseDate } from "../../data/local/dates";

export const WORKBENCH_FIXED_HEADERS = [
  "序号",
  "姓名",
  "编号",
  "班级",
  "考试日期",
  "状态",
  "备注",
] as const;

function isoDate(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : date.slice(0, 10);
}

function dateHeader(date: string): string {
  const parsed = parseDate(date);
  const names = ["日", "一", "二", "三", "四", "五", "六"];
  return `${isoDate(date)} 周${names[parsed.getDay()]}`;
}

export function workbenchRows(
  response: WorkbenchResponse,
): Array<Array<string | number>> {
  const dates = datesBetween(response.range.from, response.range.to);
  return response.students.map((student, index) => [
    index + 1,
    student.name,
    student.code,
    student.classType ?? "",
    student.examDate ?? "",
    student.statusLabel?.label ?? "不紧急",
    student.note ?? "",
    ...dates.map((date) => {
      const cell = student.days[date];
      if (!cell || cell.tasks.length === 0)
        return cell?.available === false ? "休息" : "";
      return formatDayTaskList(cell.tasks);
    }),
  ]);
}

/** Build and save an .xlsx workbook through the platform boundary. */
export async function exportWorkbenchExcel(
  response: WorkbenchResponse,
  suggestedName = `学生工作台-${response.range.from}-${response.range.to}.xlsx`,
): Promise<boolean> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "助教工作台";
  const sheet = workbook.addWorksheet("学生工作台", {
    views: [{ state: "frozen", xSplit: 2, ySplit: 1 }],
  });
  const dates = datesBetween(response.range.from, response.range.to);
  sheet.addRow([...WORKBENCH_FIXED_HEADERS, ...dates.map(dateHeader)]);
  for (const row of workbenchRows(response)) sheet.addRow(row);

  const widths = [8, 16, 14, 16, 14, 12, 24, ...dates.map(() => 30)];
  sheet.columns.forEach((column, index) => {
    column.width = widths[index] ?? 16;
  });
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = {
    vertical: "middle",
    horizontal: "center",
    wrapText: true,
  };
  for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    row.alignment = { vertical: "top", wrapText: true };
    for (let columnIndex = 8; columnIndex <= row.cellCount; columnIndex += 1) {
      if (row.getCell(columnIndex).value === "休息") {
        row.getCell(columnIndex).font = { color: { argb: "FF888888" } };
      }
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return getPlatformAdapter().saveFile(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    suggestedName,
  );
}
