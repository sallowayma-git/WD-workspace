import { App as AntApp } from "antd";
import type { DragEndEvent } from "@dnd-kit/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataAdapter } from "../../data/DataAdapter";
import { setDataAdapterForTests } from "../../data/runtime";
import { StudentWorkbenchPage } from "./StudentWorkbenchPage";
import { resolveWorkbenchDrop } from "./workbenchDrag";

const LIN = "10000000-0000-4000-8000-000000000001";
const WANG = "10000000-0000-4000-8000-000000000002";

/** Mirrors the page's own Monday-anchored week derivation. */
function weekDates(): string[] {
  const today = new Date(new Date().toLocaleDateString("en-CA"));
  const day = today.getDay();
  today.setDate(today.getDate() + (day === 0 ? -6 : 1 - day));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function cell(date: string, titles: string[]) {
  return {
    date,
    available: true,
    availableMinutes: 90,
    tasks: titles.map((title, index) => ({
      id: `2000000${index}-0000-4000-8000-00000000000${index + 1}`,
      shortTitle: title,
      status: "PENDING",
      version: 0,
      title,
      sourceType: "TRACK",
      itemOrdinal: index + 1,
      durationMinutes: 30,
      locked: false,
      carriedOver: false,
      scheduledDate: date,
    })),
  };
}

function workbenchPayload() {
  const dates = weekDates();
  // 林同学's Monday holds three tasks so the density cap is observable.
  const linDays: Record<string, unknown> = {
    [dates[0]]: cell(dates[0], ["密卷08", "听写A", "错题复盘"]),
  };
  const wangDays: Record<string, unknown> = {
    [dates[1]]: cell(dates[1], ["阅读B"]),
  };
  return {
    range: { from: dates[0], to: dates[6] },
    students: [
      {
        id: LIN,
        name: "林同学",
        code: "S001",
        devicePolicy: "CONFIRM",
        tags: [],
        vocabularyCountThisWeek: 4,
        days: linDays,
      },
      {
        id: WANG,
        name: "王同学",
        code: "S002",
        devicePolicy: "ALLOWED",
        tags: [],
        vocabularyCountThisWeek: 0,
        days: wangDays,
      },
    ],
  };
}

function renderPage(initialEntry = "/workbench") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AntApp>
          <StudentWorkbenchPage />
        </AntApp>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("StudentWorkbenchPage matrix acceptance", () => {
  afterEach(() => {
    setDataAdapterForTests(null);
    vi.restoreAllMocks();
  });

  it("restores its week and student filter from the URL", async () => {
    const getWorkbench = vi.fn().mockResolvedValue(workbenchPayload());
    setDataAdapterForTests({ getWorkbench } as unknown as DataAdapter);
    renderPage("/workbench?week=2026-08-24&search=%E6%9E%97");
    await waitFor(() =>
      expect(getWorkbench).toHaveBeenLastCalledWith("2026-08-24", "2026-08-30"),
    );
    expect(await screen.findByLabelText("搜索学生")).toHaveValue("林");
    expect(
      await screen.findByRole("link", { name: "林同学 排期" }),
    ).toHaveAttribute("href", `/students/${LIN}/schedule?date=2026-08-24`);
    expect(
      screen.queryByRole("link", { name: "王同学 排期" }),
    ).not.toBeInTheDocument();
  });

  it("lays students down the rows and the seven dates across the columns", async () => {
    setDataAdapterForTests({
      getWorkbench: () => Promise.resolve(workbenchPayload()),
    } as unknown as DataAdapter);

    renderPage();

    const matrix = await screen.findByTestId("student-task-matrix");

    // ACC-040: the vertical axis is students, the horizontal axis is dates.
    const headers = within(matrix).getAllByRole("columnheader");
    expect(headers[0]).toHaveTextContent("学生");
    expect(headers).toHaveLength(8); // student column + 7 dates
    const dates = weekDates();
    for (const date of dates) {
      const d = new Date(date);
      expect(matrix).toHaveTextContent(`${d.getMonth() + 1}/${d.getDate()}`);
    }
    expect(within(matrix).getByText("林同学")).toBeVisible();
    expect(within(matrix).getByText("王同学")).toBeVisible();
  });

  it("pins the student column and keeps the date columns horizontally scrollable", async () => {
    setDataAdapterForTests({
      getWorkbench: () => Promise.resolve(workbenchPayload()),
    } as unknown as DataAdapter);

    renderPage();

    const matrix = await screen.findByTestId("student-task-matrix");

    // ACC-041: the rendered first body column is sticky at the left edge.
    const studentCell = within(matrix)
      .getByText("林同学")
      .closest(".ant-table-cell-fix-left");
    expect(studentCell).not.toBeNull();
    expect(studentCell).toHaveStyle({ position: "sticky", left: "0px" });

    // ACC-042: the body is wider than the viewport (180 + 7 * 160 = 1300),
    // so the matrix scrolls sideways rather than compressing the columns.
    const spacer = within(matrix).getByTestId("student-task-matrix-spacer");
    expect(spacer).toHaveStyle({ minWidth: "1300px" });
  });

  it("holds several task cards in one cell and reveals the rest in expanded density", async () => {
    setDataAdapterForTests({
      getWorkbench: () => Promise.resolve(workbenchPayload()),
    } as unknown as DataAdapter);

    renderPage();

    const matrix = await screen.findByTestId("student-task-matrix");

    // ACC-044: a single day cell carries more than one TaskCard.
    expect(await within(matrix).findByText("密卷08")).toBeVisible();
    expect(within(matrix).getByText("听写A")).toBeVisible();

    // ACC-043 (compact): compact density shows 2 cards and counts the rest.
    expect(within(matrix).queryByText("错题复盘")).not.toBeInTheDocument();
    expect(within(matrix).getByText("+1")).toBeVisible();

    await userEvent.click(screen.getByText("扩展"));

    // ACC-043 (expanded): the same cell now shows all three cards and the
    // overflow counter disappears.
    await waitFor(() =>
      expect(screen.getByText("错题复盘")).toBeInTheDocument(),
    );
    expect(screen.queryByText("+1")).not.toBeInTheDocument();
  });

  it("keeps a task checkbox clickable inside the draggable matrix card", async () => {
    const completeTask = vi.fn(() =>
      Promise.resolve({
        taskId: "20000000-0000-4000-8000-000000000001",
        status: "COMPLETED",
        currentOrdinal: null,
        chainWarning: null,
      }),
    );
    setDataAdapterForTests({
      getWorkbench: () => Promise.resolve(workbenchPayload()),
      completeTask,
    } as unknown as DataAdapter);

    renderPage();

    const checkbox = await screen.findByRole("checkbox", {
      name: "任务 密卷08",
    });
    await userEvent.click(checkbox);

    await waitFor(() =>
      expect(completeTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "20000000-0000-4000-8000-000000000001",
          expectedVersion: 0,
        }),
      ),
    );
  });

  it("passes the target student when a task crosses student rows", () => {
    const dragEnd = {
      active: {
        id: "task-cross-student",
        data: {
          current: {
            taskId: "task-cross-student",
            sourceStudentId: LIN,
            sourceDate: "2026-08-24",
            version: 3,
            locked: false,
            carriedOver: false,
          },
        },
      },
      over: {
        id: "cell-target",
        data: {
          current: {
            targetStudentId: WANG,
            targetDate: "2026-08-25",
            available: true,
          },
        },
      },
    } as unknown as DragEndEvent;

    expect(resolveWorkbenchDrop(dragEnd)).toEqual({
      kind: "reschedule",
      input: {
        taskId: "task-cross-student",
        version: 3,
        targetDate: "2026-08-25",
        targetStudentId: WANG,
      },
    });
  });

  it.each([
    [
      "same cell",
      { sourceStudentId: LIN, sourceDate: "2026-08-24" },
      { targetStudentId: LIN, targetDate: "2026-08-24" },
    ],
    [
      "locked",
      { sourceStudentId: LIN, sourceDate: "2026-08-24", locked: true },
      { targetStudentId: WANG, targetDate: "2026-08-25" },
    ],
    [
      "history",
      { sourceStudentId: LIN, sourceDate: "2026-08-24", carriedOver: true },
      { targetStudentId: WANG, targetDate: "2026-08-25" },
    ],
  ])("rejects %s workbench drops", (_label, source, target) => {
    const dragEnd = {
      active: {
        id: "task-rejected",
        data: {
          current: {
            taskId: "task-rejected",
            version: 1,
            locked: false,
            carriedOver: false,
            ...source,
          },
        },
      },
      over: { id: "cell", data: { current: target } },
    } as unknown as DragEndEvent;
    expect(resolveWorkbenchDrop(dragEnd)).toEqual({ kind: "ignore" });
  });

  // 长期任务的轨道属于原学生，跨行拖拽必须被拒掉并说明原因。
  it.each([
    ["trackId", { trackId: "30000000-0000-4000-8000-000000000001" }],
    ["sourceType TRACK", { sourceType: "TRACK" }],
  ])("refuses to drag a track task (%s) onto another student", (_l, bound) => {
    const dragData = {
      taskId: "task-track",
      sourceStudentId: LIN,
      sourceDate: "2026-08-24",
      version: 2,
      locked: false,
      carriedOver: false,
      title: "真题2024 第7项",
      ...bound,
    };
    const build = (targetStudentId: string, targetDate: string) =>
      ({
        active: { id: "task-track", data: { current: dragData } },
        over: {
          id: "cell",
          data: { current: { targetStudentId, targetDate, available: true } },
        },
      }) as unknown as DragEndEvent;

    expect(resolveWorkbenchDrop(build(WANG, "2026-08-25"))).toEqual({
      kind: "refuse",
      reason: "「真题2024 第7项」是长期任务，只能在同一个学生里改期",
    });
    // 同一个学生内改期仍然允许。
    expect(resolveWorkbenchDrop(build(LIN, "2026-08-25"))).toMatchObject({
      kind: "reschedule",
    });
  });
});
