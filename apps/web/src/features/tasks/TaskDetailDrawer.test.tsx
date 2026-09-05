import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskDetailDrawer, type TaskDetailExtras } from "./TaskDetailDrawer";
import type { TaskLike } from "./taskApi";

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

    // Key fields from the list projection (the title shows in both the
    // drawer header and the 标题 row, so assert on all matches).
    expect(screen.getAllByText("密卷08 阅读理解").length).toBe(2);
    expect(screen.getByText("林同学")).toBeVisible();
    expect(screen.getByText("2026-08-27")).toBeVisible();
    expect(screen.getByText("待完成")).toBeVisible();
    expect(screen.getByText("轨道第 8 项")).toBeVisible();
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
    expect(screen.getAllByText("密卷08 阅读理解").length).toBe(2);
  });
});
