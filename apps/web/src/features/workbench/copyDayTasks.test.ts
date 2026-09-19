import { describe, expect, it } from "vitest";
import type { WorkbenchTask } from "./workbenchApi";
import { formatDayTasksForCopy } from "./copyDayTasks";

function task(
  id: string,
  title: string,
  shortTitle: string,
  status: WorkbenchTask["status"],
): WorkbenchTask {
  return { id, title, shortTitle, status, version: 0 };
}

describe("formatDayTasksForCopy", () => {
  it("uses full titles, preserves order, and excludes cancelled or carried records", () => {
    const tasks = [
      task(
        "10000000-0000-4000-8000-000000000001",
        "阅读密卷2做题+精读",
        "密卷2",
        "PENDING",
      ),
      task(
        "10000000-0000-4000-8000-000000000002",
        "一天一句长难句day5",
        "长难句5",
        "COMPLETED",
      ),
      task(
        "10000000-0000-4000-8000-000000000003",
        "已取消",
        "已取消",
        "CANCELLED",
      ),
      task(
        "10000000-0000-4000-8000-000000000004",
        "已顺延",
        "已顺延",
        "CARRIED_OVER",
      ),
    ];

    expect(formatDayTasksForCopy("2026-09-19", tasks)).toBe(
      "9月19日任务：\n1.阅读密卷2做题+精读\n2.一天一句长难句day5",
    );
  });
});
