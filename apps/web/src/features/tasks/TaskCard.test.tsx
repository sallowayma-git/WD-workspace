import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskCard } from "./TaskCard";

describe("TaskCard controls", () => {
  it("opens details and actions without completing the task", async () => {
    const user = userEvent.setup();
    const task = {
      id: "task-1",
      title: "阅读练习",
      sourceType: "AD_HOC",
      status: "PENDING",
      locked: false,
      version: 0,
    };
    const onComplete = vi.fn();
    const onViewDetail = vi.fn();
    render(
      <TaskCard
        task={task}
        onComplete={onComplete}
        onReopen={vi.fn()}
        onViewDetail={onViewDetail}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "查看任务 阅读练习" }));
    await waitFor(() => expect(onViewDetail).toHaveBeenCalledWith(task));
    expect(onComplete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "更多操作 阅读练习" }));
    await user.click(await screen.findByRole("menuitem", { name: /查看详情/ }));
    expect(onViewDetail).toHaveBeenCalledTimes(2);
    expect(onComplete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox", { name: "任务 阅读练习" }));
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(task);
  });

  it("enters rename mode on double click, saves on blur, and cancels on Escape", async () => {
    const user = userEvent.setup();
    const task = {
      id: "task-rename",
      title: "阅读练习",
      sourceType: "AD_HOC",
      status: "PENDING",
      locked: false,
      version: 0,
    };
    const onRename = vi.fn();
    render(
      <TaskCard
        task={task}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
        onViewDetail={vi.fn()}
        onRename={onRename}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    const title = screen.getByRole("button", { name: "查看任务 阅读练习" });
    await user.dblClick(title);
    const input = screen.getByRole("textbox", { name: "编辑任务标题" });
    await user.clear(input);
    await user.type(input, "阅读精练");
    await user.tab();
    expect(onRename).toHaveBeenCalledWith(task, "阅读精练");

    await user.dblClick(
      screen.getByRole("button", { name: "查看任务 阅读练习" }),
    );
    const cancelled = screen.getByRole("textbox", { name: "编辑任务标题" });
    await user.clear(cancelled);
    await user.type(cancelled, "不应保存");
    await user.keyboard("{Escape}");
    expect(onRename).toHaveBeenCalledTimes(1);
  });
});
