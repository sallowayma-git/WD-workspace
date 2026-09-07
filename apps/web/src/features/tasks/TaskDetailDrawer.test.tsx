import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render as renderComponent,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskDetailDrawer, type TaskDetailExtras } from "./TaskDetailDrawer";
import { updateTask, type TaskLike } from "./taskApi";

vi.mock("./taskApi", () => ({ updateTask: vi.fn() }));

function render(element: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = renderComponent(
    <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  );
  return { ...view, queryClient };
}

const BASE = {
  id: "20000000-0000-4000-8000-000000000001",
  title: "密卷08 阅读理解",
  shortTitle: null,
  status: "PENDING",
  sourceType: "TRACK",
  trackId: "30000000-0000-4000-8000-000000000001",
  itemOrdinal: 8,
  durationMinutes: 30,
  locked: false,
  scheduledDate: "2026-08-27",
  version: 3,
  note: "完成后拍照上传",
} as const;

type DetailTask = TaskLike & TaskDetailExtras;

function makeTask(overrides: Record<string, unknown>): DetailTask {
  return { ...BASE, ...overrides };
}

describe("TaskDetailDrawer", () => {
  afterEach(() => vi.resetAllMocks());
  it("renders the carried task with its lineage block on top", () => {
    render(
      <TaskDetailDrawer
        target={{
          task: makeTask({
            status: "PENDING",
            carriedOver: false,
            carriedFromDate: "2026-08-26",
            carriedToInstanceId: "20000000-0000-4000-8000-000000000002",
            priority: "HIGH",
            star: true,
            overrideReason: "学生请假",
          }),
          studentName: "林同学",
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("密卷08 阅读理解")).toBeVisible();
    expect(screen.getByText("林同学")).toBeVisible();
    expect(screen.getByText("2026-08-27")).toBeVisible();
    expect(screen.getByText("待完成")).toBeVisible();
    expect(screen.getByText("第8项")).toBeVisible();
    expect(screen.getByText("30 分钟")).toBeVisible();
    expect(screen.getByText("高优先级")).toBeVisible();
    expect(screen.getByText("星标")).toBeVisible();
    expect(screen.getByText("完成后拍照上传")).toBeVisible();
    expect(screen.getByText("学生请假")).toBeVisible();

    // DLY-022 lineage: carried-from date and carried-to instance.
    expect(screen.getByText("顺延记录")).toBeVisible();
    expect(screen.getByText("由 2026-08-26 顺延而来")).toBeVisible();
    expect(screen.getByText("已顺延至新实例")).toBeVisible();
    // A live carried task is not flagged as history.
    expect(
      screen.queryByText("这是顺延来源的历史实例"),
    ).not.toBeInTheDocument();
  });

  it("marks a CARRIED_OVER history row with the weakened history notice", () => {
    render(
      <TaskDetailDrawer
        target={{
          task: makeTask({
            status: "CARRIED_OVER",
            carriedOver: true,
            carriedFromDate: "2026-08-25",
          }),
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("已顺延")).toBeVisible();
    expect(screen.getByText("这是顺延来源的历史实例")).toBeVisible();
    expect(screen.getByText("由 2026-08-25 顺延而来")).toBeVisible();
  });

  it("omits the lineage block when the task has no carry trail", () => {
    render(
      <TaskDetailDrawer target={{ task: makeTask({}) }} onClose={vi.fn()} />,
    );

    expect(screen.queryByText("顺延记录")).not.toBeInTheDocument();
    expect(screen.getByText("密卷08 阅读理解")).toBeVisible();
  });

  it("never renders the track UUID, and drops the ordinal row when the title already carries it", () => {
    render(
      <TaskDetailDrawer
        target={{
          task: makeTask({ title: "一天一句长难句 Day 8" }),
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText(BASE.trackId)).not.toBeInTheDocument();
    expect(screen.queryByText("轨道")).not.toBeInTheDocument();
    expect(screen.queryByText("第8项")).not.toBeInTheDocument();
  });

  it("keeps failed edits and saves the title and note on retry", async () => {
    const user = userEvent.setup();
    vi.mocked(updateTask).mockRejectedValueOnce(new Error("写入失败"));
    const { queryClient } = render(
      <TaskDetailDrawer
        target={{ task: makeTask({ sourceType: "AD_HOC" }) }}
        onClose={vi.fn()}
      />,
    );
    for (const key of ["today", "workbench", "schedule"])
      queryClient.setQueryData([key], { cached: true });
    await user.click(screen.getByRole("button", { name: "编辑任务" }));
    await user.clear(screen.getByLabelText("标题"));
    await user.type(screen.getByLabelText("标题"), "阅读复盘");
    expect(screen.getByLabelText("备注")).toHaveValue("完成后拍照上传");
    await user.clear(screen.getByLabelText("备注"));
    await user.click(screen.getByRole("button", { name: /保\s*存/ }));
    expect(await screen.findByText("写入失败")).toBeVisible();
    expect(screen.getByLabelText("标题")).toHaveValue("阅读复盘");
    vi.mocked(updateTask).mockResolvedValueOnce({
      titleSnapshot: "阅读复盘",
      shortTitleSnapshot: null,
      note: "",
      version: 4,
    } as Awaited<ReturnType<typeof updateTask>>);
    await user.click(screen.getByRole("button", { name: /保\s*存/ }));
    await screen.findByRole("button", { name: "编辑任务" });
    expect(screen.getByText("阅读复盘")).toBeVisible();
    expect(updateTask).toHaveBeenLastCalledWith(BASE.id, {
      title: "阅读复盘",
      note: "",
      expectedVersion: 3,
    });
    await waitFor(() => {
      for (const key of ["today", "workbench", "schedule"])
        expect(queryClient.getQueryState([key])?.isInvalidated).toBe(true);
    });
    await user.click(screen.getByRole("button", { name: "编辑任务" }));
    expect(screen.getByLabelText("标题")).toHaveValue("阅读复盘");
    expect(screen.getByLabelText("备注")).toHaveValue("");
  });

  it.each([
    { sourceType: "TRACK" },
    { sourceType: "AD_HOC", locked: true },
    { sourceType: "AD_HOC", status: "CARRIED_OVER" },
  ])("keeps protected tasks read-only: %j", (overrides) => {
    render(
      <TaskDetailDrawer
        target={{ task: makeTask(overrides) }}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "编辑任务" }),
    ).not.toBeInTheDocument();
  });
});
