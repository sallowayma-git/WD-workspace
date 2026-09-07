import { render, screen } from "@testing-library/react";
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
    expect(onViewDetail).toHaveBeenCalledWith(task);
    expect(onComplete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "更多操作 阅读练习" }));
    await user.click(await screen.findByRole("menuitem", { name: /查看详情/ }));
    expect(onViewDetail).toHaveBeenCalledTimes(2);
    expect(onComplete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox", { name: "任务 阅读练习" }));
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(task);
  });
});
