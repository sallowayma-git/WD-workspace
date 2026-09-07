import { App as AntApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataAdapter } from "../../data/DataAdapter";
import { setDataAdapterForTests } from "../../data/runtime";
import { StudentSchedulePage } from "./StudentSchedulePage";

const LIN = "10000000-0000-4000-8000-000000000001";
const TASK = "20000000-0000-4000-8000-000000000001";

function localToday(): string {
  return new Date().toLocaleDateString("en-CA");
}

function shiftDays(base: string, amount: number): string {
  const date = new Date(base);
  date.setDate(date.getDate() + amount);
  return date.toISOString().slice(0, 10);
}

function day(date: string, tasks: unknown[] = [], available = true) {
  return {
    date,
    available,
    availableMinutes: available ? 90 : 0,
    devicePolicy: "CONFIRM",
    tasks,
  };
}

const pendingTask = {
  id: TASK,
  title: "密卷08 阅读",
  shortTitle: "密卷08",
  status: "PENDING" as const,
  sourceType: "TRACK",
  itemOrdinal: 8,
  durationMinutes: 30,
  locked: false,
  version: 0,
};

/**
 * The page requests a window per view; the adapter answers with the number of
 * days that view is expected to show so the assertions describe real ranges.
 */
function schedulePayload(view: string) {
  const anchor = localToday();
  const dayCount = view === "day" ? 1 : view === "week" ? 7 : 28;
  const days = Array.from({ length: dayCount }, (_, i) =>
    day(shiftDays(anchor, i), i === 0 ? [pendingTask] : []),
  );
  return {
    studentId: LIN,
    studentName: "林同学",
    studentCode: "S001",
    devicePolicy: "CONFIRM",
    fromDate: days[0].date,
    toDate: days[days.length - 1].date,
    view,
    days,
  };
}

/** Full ad-hoc row shape the today/taskApi zod schema parses after creation. */
function adHocTaskView(scheduledDate: string, title: string) {
  return {
    id: "20000000-0000-4000-8000-0000000000e1",
    studentId: LIN,
    sourceType: "AD_HOC",
    trackId: null,
    templateVersionId: null,
    templateItemId: null,
    itemOrdinal: null,
    scheduledDate,
    originalScheduledDate: scheduledDate,
    status: "PENDING",
    titleSnapshot: title,
    shortTitleSnapshot: null,
    durationMinutesSnapshot: null,
    requiresDeviceSnapshot: null,
    scheduleOrigin: "AD_HOC",
    manualOverride: false,
    overrideReason: null,
    locked: false,
    note: null,
    carriedFromInstanceId: null,
    carriedToInstanceId: null,
    completedAt: null,
    completedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    version: 0,
    updatedAt: "2026-08-30T00:00:00Z",
  };
}

function renderPage(
  getSchedule: DataAdapter["getSchedule"],
  extra: Record<string, unknown> = {},
) {
  setDataAdapterForTests({ getSchedule, ...extra } as unknown as DataAdapter);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/students/${LIN}/schedule`]}>
        <AntApp>
          <Routes>
            <Route
              path="/students/:studentId/schedule"
              element={<StudentSchedulePage />}
            />
          </Routes>
        </AntApp>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("StudentSchedulePage calendar acceptance", () => {
  afterEach(() => {
    setDataAdapterForTests(null);
    vi.restoreAllMocks();
  });

  it(
    "serves one student's Day, Week and Month views from the same task truth",
    { timeout: 30000 },
    async () => {
      const user = userEvent.setup({ delay: null });
      const getSchedule = vi.fn(
        (_studentId: string, params?: { view?: string }) =>
          Promise.resolve(schedulePayload(params?.view ?? "week")),
      );
      renderPage(getSchedule);

      // ACC-051: week is the default single-student view.
      expect(await screen.findByText("林同学 的排期")).toBeVisible();
      await waitFor(() =>
        expect(getSchedule).toHaveBeenCalledWith(LIN, {
          from: localToday(),
          view: "week",
        }),
      );
      expect(await screen.findByText("密卷08")).toBeVisible();

      // ACC-050: the day view asks for and renders a single day.
      await user.click(screen.getByRole("button", { name: "日视图" }));
      await waitFor(() =>
        expect(getSchedule).toHaveBeenCalledWith(LIN, {
          from: localToday(),
          view: "day",
        }),
      );
      expect(await screen.findByText("密卷08")).toBeVisible();

      // ACC-052: the month view asks for and renders the month window.
      await user.click(screen.getByRole("button", { name: "月视图" }));
      await waitFor(() =>
        expect(getSchedule).toHaveBeenCalledWith(LIN, {
          from: localToday(),
          view: "month",
        }),
      );
      expect(await screen.findByText("密卷08")).toBeVisible();
    },
  );

  it(
    "shows no course, class, teacher or location wording anywhere in a view",
    { timeout: 30000 },
    async () => {
      const user = userEvent.setup({ delay: null });
      const getSchedule = vi.fn(
        (_studentId: string, params?: { view?: string }) =>
          Promise.resolve(schedulePayload(params?.view ?? "week")),
      );
      renderPage(getSchedule);

      await screen.findByText("密卷08");

      // ACC-056: the calendar is a task calendar. None of the Flowclass
      // course/class/teacher/room vocabulary may survive the port.
      for (const view of ["日视图", "周视图", "月视图"]) {
        await user.click(screen.getByRole("button", { name: view }));
        await screen.findByText("密卷08");
        const body = document.body.textContent ?? "";
        for (const banned of [
          "课程",
          "班级",
          "教师",
          "老师",
          "教室",
          "地点",
          "考勤",
          "出勤",
          "Course",
          "Class",
          "Teacher",
          "Location",
        ]) {
          expect(body).not.toContain(banned);
        }
      }
    },
  );

  it("marks a day the student cannot study and still lists the task truth", async () => {
    const anchor = localToday();
    const getSchedule = vi.fn(() =>
      Promise.resolve({
        studentId: LIN,
        studentName: "林同学",
        studentCode: "S001",
        devicePolicy: "CONFIRM",
        fromDate: anchor,
        toDate: shiftDays(anchor, 6),
        view: "week",
        days: [
          day(anchor, [pendingTask]),
          day(shiftDays(anchor, 1), [], false),
          ...Array.from({ length: 5 }, (_, i) => day(shiftDays(anchor, i + 2))),
        ],
      }),
    );
    renderPage(getSchedule);

    // A non-study day is visibly marked, which is what carry-forward and drag
    // rejection are anchored to (ACC-061 surface).
    expect(await screen.findByText("不可学习")).toBeVisible();
    expect(screen.getByText("密卷08")).toBeVisible();
  });

  it(
    "draws the month view with the ported Flowclass grid shell",
    { timeout: 30000 },
    async () => {
      const user = userEvent.setup({ delay: null });
      // The local adapter backs the month view with the whole 42-day grid, so the
      // page receives every cell it draws.
      const anchor = localToday();
      const first = new Date(anchor);
      first.setDate(1);
      const gridStart = new Date(first);
      const weekday = gridStart.getDay();
      gridStart.setDate(
        gridStart.getDate() + (weekday === 0 ? -6 : 1 - weekday),
      );
      const gridDays = Array.from({ length: 42 }, (_, i) => {
        const d = new Date(gridStart);
        d.setDate(d.getDate() + i);
        return d.toISOString().slice(0, 10);
      });

      const getSchedule = vi.fn(
        (_studentId: string, params?: { view?: string }) =>
          Promise.resolve(
            params?.view === "month"
              ? {
                  studentId: LIN,
                  studentName: "林同学",
                  studentCode: "S001",
                  devicePolicy: "CONFIRM",
                  fromDate: gridDays[0],
                  toDate: gridDays[41],
                  view: "month",
                  days: gridDays.map((date) =>
                    date === anchor ? day(date, [pendingTask]) : day(date),
                  ),
                }
              : schedulePayload(params?.view ?? "week"),
          ),
      );
      renderPage(getSchedule);

      await screen.findByText("林同学 的排期");
      await user.click(screen.getByRole("button", { name: "月视图" }));

      // ACC-052 / INT-CAL-001: the grid itself is the ported Flowclass shell,
      // not a second hand-rolled month layout.
      const grid = await screen.findByTestId("flowclass-month-view");
      expect(
        within(grid)
          .getAllByRole("columnheader")
          .map((h) => h.textContent),
      ).toEqual(["周一", "周二", "周三", "周四", "周五", "周六", "周日"]);
      expect(within(grid).getByText("密卷08")).toBeVisible();
    },
  );

  it("keeps a carried-over source visible but not tickable", async () => {
    const anchor = localToday();
    const carriedSource = {
      ...pendingTask,
      id: "20000000-0000-4000-8000-0000000000cc",
      title: "上周未完成",
      shortTitle: "上周未完成",
      status: "CARRIED_OVER" as const,
      carriedOver: true,
    };
    const getSchedule = vi.fn(() =>
      Promise.resolve({
        studentId: LIN,
        studentName: "林同学",
        studentCode: "S001",
        devicePolicy: "CONFIRM",
        fromDate: anchor,
        toDate: shiftDays(anchor, 6),
        view: "week",
        days: [
          day(anchor, [carriedSource, pendingTask]),
          ...Array.from({ length: 6 }, (_, i) => day(shiftDays(anchor, i + 1))),
        ],
      }),
    );
    renderPage(getSchedule);

    // ACC-074 / INT-CAL-008: the source stays as history — badged, dimmed and
    // not re-checkable — while the live task next to it is still actionable.
    const source = await screen.findByRole("checkbox", {
      name: "任务 上周未完成",
    });
    expect(source).toBeDisabled();
    expect(screen.getByRole("img", { name: "顺延记录" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "任务 密卷08" })).toBeEnabled();
  });

  it("refuses to arm a drag on a locked task", async () => {
    const anchor = localToday();
    const lockedTask = {
      ...pendingTask,
      id: "20000000-0000-4000-8000-0000000000ab",
      title: "锁定任务",
      shortTitle: "锁定任务",
      locked: true,
    };
    const getSchedule = vi.fn(() =>
      Promise.resolve({
        studentId: LIN,
        studentName: "林同学",
        studentCode: "S001",
        devicePolicy: "CONFIRM",
        fromDate: anchor,
        toDate: shiftDays(anchor, 6),
        view: "week",
        days: [
          day(anchor, [lockedTask, pendingTask]),
          ...Array.from({ length: 6 }, (_, i) => day(shiftDays(anchor, i + 1))),
        ],
      }),
    );
    renderPage(getSchedule);

    await screen.findByText("锁定任务");
    // ACC-055 / INT-CAL-007: dnd-kit marks a disabled draggable by dropping the
    // drag role/attributes, so the locked card cannot start a drag at all. The
    // movable card next to it still can.
    const lockedHandle = screen
      .getByText("锁定任务")
      .closest("[data-task-drag-id]");
    const movableHandle = screen
      .getByText("密卷08")
      .closest("[data-task-drag-id]");
    expect(lockedHandle).toHaveAttribute("data-task-draggable", "false");
    expect(movableHandle).toHaveAttribute("data-task-draggable", "true");
  });

  it(
    "creates ad-hoc tasks from the calendar in day, week and month views",
    { timeout: 30000 },
    async () => {
      const user = userEvent.setup({ delay: null });
      const getSchedule = vi.fn(
        (_studentId: string, params?: { view?: string }) =>
          Promise.resolve(schedulePayload(params?.view ?? "week")),
      );
      const createAdHocTask = vi.fn(
        (input: { scheduledDate: string; title: string }) =>
          Promise.resolve(adHocTaskView(input.scheduledDate, input.title)),
      );
      const listTemplates = vi.fn(() =>
        Promise.resolve({
          items: [],
          page: 0,
          size: 0,
          total: 0,
          hasNext: false,
        }),
      );
      renderPage(getSchedule, { createAdHocTask, listTemplates });

      // AutoComplete 是 Select 实现，占位符渲染在独立 span 上，用 combobox
      // 角色定位输入框。
      const composer = async () =>
        await screen.findByRole("combobox", {
          name: "新增任务",
        });

      // 周视图（默认）：每个日期格子的加号打开输入框，回车即创建当天任务。
      await screen.findByText("密卷08");
      await user.click(screen.getByLabelText(`在 ${localToday()} 添加任务`));
      await user.type(await composer(), "口算练习");
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(createAdHocTask).toHaveBeenCalledWith(
          expect.objectContaining({
            studentId: LIN,
            scheduledDate: localToday(),
            title: "口算练习",
          }),
        ),
      );

      // 日视图：同一入口挂在日卡片上。
      createAdHocTask.mockClear();
      await user.click(screen.getByRole("button", { name: "日视图" }));
      await waitFor(() =>
        expect(getSchedule).toHaveBeenCalledWith(LIN, {
          from: localToday(),
          view: "day",
        }),
      );
      await screen.findByText("密卷08");
      await user.click(screen.getByLabelText(`在 ${localToday()} 添加任务`));
      await user.type(await composer(), "日视图任务");
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(createAdHocTask).toHaveBeenCalledWith(
          expect.objectContaining({
            studentId: LIN,
            scheduledDate: localToday(),
            title: "日视图任务",
          }),
        ),
      );

      // 月视图：格子里的入口同样可用。
      createAdHocTask.mockClear();
      await user.click(screen.getByRole("button", { name: "月视图" }));
      await waitFor(() =>
        expect(getSchedule).toHaveBeenCalledWith(LIN, {
          from: localToday(),
          view: "month",
        }),
      );
      await screen.findByText("密卷08");
      await user.click(screen.getByLabelText(`在 ${localToday()} 添加任务`));
      await user.type(await composer(), "月视图任务");
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(createAdHocTask).toHaveBeenCalledWith(
          expect.objectContaining({
            studentId: LIN,
            scheduledDate: localToday(),
            title: "月视图任务",
          }),
        ),
      );
    },
  );

  // 用户反馈：完成“一天一句长难句day1”后点 → 箭头，下一个可学习日要出现 day2。
  // 带尾号的任务在排期页把箭头从“改期到下一天”切换为“继续这个系列”（和右键
  // 菜单同名同语义：序号 +1、落到下一个可学习日）。
  it(
    "swaps the arrow to 继续这个系列 for numbered series tasks and calls the adapter",
    { timeout: 30000 },
    async () => {
      const user = userEvent.setup({ delay: null });
      const seriesTask = {
        ...pendingTask,
        sourceType: "AD_HOC" as const,
        title: "一天一句长难句day1",
        shortTitle: "长难句day1",
        itemOrdinal: null,
      };
      const getSchedule = vi.fn(
        (_studentId: string, params?: { view?: string }) => {
          const payload = schedulePayload(params?.view ?? "week");
          return Promise.resolve({
            ...payload,
            days: payload.days.map((d, i) =>
              i === 0 ? { ...d, tasks: [seriesTask] } : d,
            ),
          });
        },
      );
      const createNextSeriesTask = vi.fn(() =>
        Promise.resolve(
          adHocTaskView(shiftDays(localToday(), 1), "一天一句长难句day2"),
        ),
      );
      renderPage(getSchedule, { createNextSeriesTask });

      expect(await screen.findByText("长难句day1")).toBeVisible();
      // 尾号任务不再显示“改期到下一天”，而是“继续这个系列”。
      expect(screen.queryByRole("button", { name: "改期到下一天" })).toBeNull();
      await user.click(screen.getByRole("button", { name: "继续这个系列" }));
      await waitFor(() =>
        expect(createNextSeriesTask).toHaveBeenCalledWith(
          TASK,
          expect.objectContaining({ expectedVersion: 0 }),
        ),
      );
    },
  );

  it(
    "keeps the move-to-next-day arrow for titles without a trailing number",
    { timeout: 30000 },
    async () => {
      const getSchedule = vi.fn(
        (_studentId: string, params?: { view?: string }) =>
          Promise.resolve(schedulePayload(params?.view ?? "week")),
      );
      renderPage(getSchedule);
      expect(await screen.findByText("密卷08")).toBeVisible();
      expect(
        screen.getByRole("button", { name: "改期到下一天" }),
      ).toBeVisible();
      expect(screen.queryByRole("button", { name: "继续这个系列" })).toBeNull();
    },
  );

  // TRACK 任务的“下一项”由轨道在完成时自动推进，箭头保持“改期到下一天”，
  // 不提供“继续这个系列”，避免同一系列出现两条平行任务。
  it(
    "keeps the move arrow for numbered TRACK tasks whose next item the track owns",
    { timeout: 30000 },
    async () => {
      const trackNumbered = {
        ...pendingTask,
        title: "真题 第2套",
        shortTitle: "真题2",
      };
      const getSchedule = vi.fn(
        (_studentId: string, params?: { view?: string }) => {
          const payload = schedulePayload(params?.view ?? "week");
          return Promise.resolve({
            ...payload,
            days: payload.days.map((d, i) =>
              i === 0 ? { ...d, tasks: [trackNumbered] } : d,
            ),
          });
        },
      );
      renderPage(getSchedule);
      expect(await screen.findByText("真题2")).toBeVisible();
      expect(
        screen.getByRole("button", { name: "改期到下一天" }),
      ).toBeVisible();
      expect(screen.queryByRole("button", { name: "继续这个系列" })).toBeNull();
    },
  );
});
