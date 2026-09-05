import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TableColumnsType } from "antd";
import { describe, expect, it } from "vitest";
import { StudentTaskMatrixShell } from "./StudentTaskMatrixShell";

interface FixtureRow {
  id: string;
  studentName: string;
  tasksByDate: Record<string, string[]>;
}

const dates = Array.from(
  { length: 14 },
  (_, index) => `2026-08-${String(index + 3).padStart(2, "0")}`,
);

const rows: FixtureRow[] = Array.from({ length: 60 }, (_, rowIndex) => ({
  id: `student-${rowIndex + 1}`,
  studentName: `学生 ${rowIndex + 1}`,
  tasksByDate: Object.fromEntries(
    dates.map((date, dateIndex) => [
      date,
      Array.from(
        { length: 3 },
        (_, taskIndex) =>
          `任务 ${rowIndex + 1}-${dateIndex + 1}-${taskIndex + 1}`,
      ),
    ]),
  ),
}));

const columns: TableColumnsType<FixtureRow> = [
  {
    key: "student",
    title: "学生",
    fixed: "left",
    width: 180,
    render: (_value, row) => row.studentName,
  },
  ...dates.map((date) => ({
    key: date,
    title: date,
    width: 160,
    render: (_value: unknown, row: FixtureRow) =>
      row.tasksByDate[date].join(" / "),
  })),
];

describe("StudentTaskMatrixShell", () => {
  it("virtualizes a 60 by 14 matrix instead of mounting all rows", async () => {
    render(
      <StudentTaskMatrixShell
        columns={columns}
        data={rows}
        rowHeight={72}
        viewportRows={8}
      />,
    );

    expect(screen.getByTestId("student-task-matrix")).toBeInTheDocument();
    expect(screen.getByTestId("student-task-matrix-spacer")).toHaveStyle({
      height: "4320px",
    });

    await waitFor(() => {
      const renderedRows = document.querySelectorAll("[data-row-key]");
      expect(renderedRows.length).toBeGreaterThan(0);
      expect(renderedRows.length).toBeLessThan(60);
    });

    const firstRow = document.querySelector('[data-row-key="student-1"]');
    expect(firstRow).not.toBeNull();
    expect(firstRow?.children).toHaveLength(15);
    expect(firstRow?.firstElementChild).toHaveClass("ant-table-cell-fix-left");
  });

  it("keeps the fixed header aligned with the virtual body scroll position", async () => {
    render(
      <StudentTaskMatrixShell
        columns={columns}
        data={rows}
        rowHeight={72}
        viewportRows={8}
      />,
    );

    const body = screen
      .getByTestId("student-task-matrix")
      .querySelector<HTMLDivElement>(".flowclass-matrix-viewport");
    const header = screen
      .getByTestId("student-task-matrix")
      .querySelector<HTMLDivElement>(".ant-table-header");

    expect(body).not.toBeNull();
    expect(header).not.toBeNull();

    body!.scrollLeft = 320;
    fireEvent.scroll(body!);

    await waitFor(() => expect(header).toHaveProperty("scrollLeft", 320));
  });

  it("stretches the non-fixed columns to fill a wider container", async () => {
    // 两列日期：声明宽度 180 + 2×160 = 500px，jsdom 的 ResizeObserver 桩
    // 上报容器宽 1024px，多出的 524px 必须按比例分给两个日期列（各 422px），
    // 固定学生列保持 180px，表头与虚拟行总宽一致。
    const narrowColumns: TableColumnsType<FixtureRow> = [
      {
        key: "student",
        title: "学生",
        fixed: "left",
        width: 180,
        render: (_v, row) => row.studentName,
      },
      { key: "d1", title: "d1", width: 160, render: () => null },
      { key: "d2", title: "d2", width: 160, render: () => null },
    ];
    render(
      <StudentTaskMatrixShell
        columns={narrowColumns}
        data={rows.slice(0, 3)}
        rowHeight={72}
        viewportRows={4}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("student-task-matrix-spacer")).toHaveStyle({
        minWidth: "1024px",
      }),
    );
    const firstRow = document.querySelector('[data-row-key="student-1"]');
    expect(firstRow?.children[0]).toHaveStyle({ width: "180px" });
    expect(firstRow?.children[1]).toHaveStyle({ width: "422px" });
    expect(firstRow?.children[2]).toHaveStyle({ width: "422px" });
  });
});
