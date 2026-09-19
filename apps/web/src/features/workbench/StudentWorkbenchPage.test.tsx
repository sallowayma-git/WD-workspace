import { App as AntApp } from "antd";
import type { DragEndEvent } from "@dnd-kit/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataAdapter } from "../../data/DataAdapter";
import { setDataAdapterForTests } from "../../data/runtime";
import {
  StudentWorkbenchPage,
  WorkbenchStudentCard,
} from "./StudentWorkbenchPage";
import { resolveWorkbenchDrop } from "./workbenchDrag";
import { createAdHocTask } from "../today/taskApi";

vi.mock("../today/taskApi", () => ({ createAdHocTask: vi.fn() }));

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
        classType: "",
        version: 0,
        devicePolicy: "CONFIRM",
        tags: [],
        vocabularyCountThisWeek: 4,
        days: linDays,
      },
      {
        id: WANG,
        name: "王同学",
        code: "S002",
        classType: "",
        version: 0,
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
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AntApp>
          <StudentWorkbenchPage />
        </AntApp>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

describe("StudentWorkbenchPage matrix acceptance", () => {
  afterEach(() => {
    setDataAdapterForTests(null);
    vi.mocked(createAdHocTask).mockReset();
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
    expect(await screen.findByRole("link", { name: "林同学" })).toHaveAttribute(
      "href",
      `/students/${LIN}/profile`,
    );
    expect(
      screen.queryByRole("link", { name: "王同学" }),
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
    expect(headers[0]).toHaveTextContent("序号");
    expect(headers[1]).toHaveTextContent("学生");
    expect(headers).toHaveLength(9); // sequence + student + 7 dates
    const dates = weekDates();
    for (const date of dates) {
      const d = new Date(date);
      expect(matrix).toHaveTextContent(`${d.getMonth() + 1}/${d.getDate()}`);
    }
    expect(await within(matrix).findByText("林同学")).toBeVisible();
    expect(await within(matrix).findByText("王同学")).toBeVisible();
  });

  it("pins the student column and keeps the date columns horizontally scrollable", async () => {
    setDataAdapterForTests({
      getWorkbench: () => Promise.resolve(workbenchPayload()),
    } as unknown as DataAdapter);

    renderPage();

    const matrix = await screen.findByTestId("student-task-matrix");

    // ACC-041: the rendered first body column is sticky at the left edge.
    const studentCell = (await within(matrix).findByText("林同学")).closest(
      ".ant-table-cell-fix-left",
    );
    expect(studentCell).not.toBeNull();
    expect(studentCell).toHaveStyle({ position: "sticky", left: "48px" });

    // ACC-042: the body is wider than the viewport (48 + 180 + 7 * 160 = 1348),
    // so the matrix scrolls sideways rather than compressing the columns.
    const spacer = within(matrix).getByTestId("student-task-matrix-spacer");
    expect(spacer).toHaveStyle({ minWidth: "1348px" });
  });

  it("renders every task in a cell in both density modes", async () => {
    setDataAdapterForTests({
      getWorkbench: () => Promise.resolve(workbenchPayload()),
    } as unknown as DataAdapter);

    renderPage();

    const matrix = await screen.findByTestId("student-task-matrix");

    // ACC-044: a single day cell carries more than one TaskCard.
    expect(await within(matrix).findByText("密卷08")).toBeVisible();
    expect(within(matrix).getByText("听写A")).toBeVisible();

    // ACC-043: compact mode no longer truncates the list or renders "+N".
    expect(within(matrix).getByText("错题复盘")).toBeVisible();
    expect(within(matrix).queryByText("+1")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("扩展"));

    // Expanded mode continues to show all task cards.
    await waitFor(() => expect(screen.getByText("错题复盘")).toBeVisible());
    expect(screen.queryByText("+1")).not.toBeInTheDocument();
  });

  it("keeps the add entry on occupied cells and shows cell actions on context menu", async () => {
    setDataAdapterForTests({
      getWorkbench: () => Promise.resolve(workbenchPayload()),
    } as unknown as DataAdapter);
    renderPage();
    const matrix = await screen.findByTestId("student-task-matrix");
    const date = weekDates()[0];
    expect(
      await within(matrix).findByLabelText(`为 林同学 在 ${date} 添加任务`),
    ).toBeVisible();
    const cell = matrix.querySelector(
      `[data-droppable-student-id="${LIN}"][data-droppable-date="${date}"]`,
    );
    expect(cell).not.toBeNull();
    fireEvent.contextMenu(cell as HTMLElement);
    expect(await screen.findByText("复制当天作业")).toBeInTheDocument();
    expect(screen.getByText("标记为休息日")).toBeInTheDocument();
  });

  it("does not offer an add entry on a rest day", async () => {
    const payload = workbenchPayload();
    const date = weekDates()[0];
    payload.students[0].days[date] = {
      date,
      available: false,
      availableMinutes: 0,
      tasks: [],
    };
    setDataAdapterForTests({
      getWorkbench: () => Promise.resolve(payload),
    } as unknown as DataAdapter);

    renderPage();

    const matrix = await screen.findByTestId("student-task-matrix");
    await within(matrix).findByText("林同学");
    expect(
      within(matrix).queryByLabelText(`为 林同学 在 ${date} 添加任务`),
    ).not.toBeInTheDocument();
    expect(await within(matrix).findByText("休息")).toBeInTheDocument();
  });

  it("keeps locked or otherwise stranded tasks visible on a rest day", async () => {
    const payload = workbenchPayload();
    const date = weekDates()[0];
    payload.students[0].days[date] = {
      date,
      available: false,
      availableMinutes: 0,
      tasks: cell(date, ["锁定留存"]).tasks,
    };
    setDataAdapterForTests({
      getWorkbench: () => Promise.resolve(payload),
    } as unknown as DataAdapter);

    renderPage();

    const matrix = await screen.findByTestId("student-task-matrix");
    expect(await within(matrix).findByText("锁定留存")).toBeVisible();
    expect(
      within(matrix).queryByLabelText(`为 林同学 在 ${date} 添加任务`),
    ).not.toBeInTheDocument();
  });

  it("keeps an active composer when another cell's composer finishes later", async () => {
    let resolveCreate: (() => void) | undefined;
    vi.mocked(createAdHocTask).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = () =>
            resolve({} as Awaited<ReturnType<typeof createAdHocTask>>);
        }),
    );
    const payload = workbenchPayload();
    // Keep both cells empty so each has an add entry.
    const dates = weekDates();
    payload.students[0].days = {};
    payload.students[1].days = {};
    for (const row of payload.students) {
      for (const date of dates) {
        row.days[date] = {
          date,
          available: true,
          availableMinutes: 90,
          tasks: [],
        };
      }
    }
    setDataAdapterForTests({
      getWorkbench: () => Promise.resolve(payload),
    } as unknown as DataAdapter);

    const user = userEvent.setup();
    renderPage();
    const matrix = await screen.findByTestId("student-task-matrix");
    await within(matrix).findByText("林同学");
    const date = dates[0];
    await user.click(
      within(matrix).getByLabelText(`为 林同学 在 ${date} 添加任务`),
    );
    const firstInput = await within(matrix).findByRole("combobox", {
      name: "为 林同学 新增任务",
    });
    await user.type(firstInput, "先创建");
    fireEvent.blur(firstInput);
    await user.click(
      within(matrix).getByLabelText(`为 王同学 在 ${date} 添加任务`),
    );
    await waitFor(() =>
      expect(vi.mocked(createAdHocTask)).toHaveBeenCalledTimes(1),
    );

    resolveCreate?.();
    await waitFor(() =>
      expect(
        within(matrix).getByRole("combobox", {
          name: "为 王同学 新增任务",
        }),
      ).toBeVisible(),
    );
  });

  it("saves an open student-card draft against the edit-session version", async () => {
    const initial = {
      ...workbenchPayload().students[0],
      classType: "旧班",
      version: 3,
    };
    const refreshed = { ...initial, classType: "服务端新班", version: 4 };
    const updateStudentCard = vi.fn(() =>
      Promise.resolve({
        id: LIN,
        studentCode: "S001",
        name: "林同学",
        alias: null,
        status: "ACTIVE",
        classType: "我的草稿",
        enrollmentDate: null,
        defaultDevicePolicy: "CONFIRM",
        note: null,
        tags: [],
        subjectPreferences: [],
        version: 4,
        updatedAt: "2026-09-19T00:00:00Z",
      }),
    );
    setDataAdapterForTests({ updateStudentCard } as unknown as DataAdapter);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AntApp>
            <WorkbenchStudentCard
              row={initial as never}
              weekStart="2026-09-14"
            />
          </AntApp>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "编辑 林同学" }));
    const classInput = await screen.findByRole("textbox", {
      name: "班级/班型",
    });
    await user.clear(classInput);
    await user.type(classInput, "我的草稿");

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AntApp>
            <WorkbenchStudentCard
              row={refreshed as never}
              weekStart="2026-09-14"
            />
          </AntApp>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(classInput).toHaveValue("我的草稿");

    await user.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() =>
      expect(updateStudentCard).toHaveBeenCalledWith(
        LIN,
        expect.objectContaining({
          classType: "我的草稿",
          expectedVersion: 3,
        }),
      ),
    );
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
