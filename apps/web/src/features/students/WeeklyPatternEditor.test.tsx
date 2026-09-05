import { App as AntApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataAdapter } from "../../data/DataAdapter";
import { setDataAdapterForTests } from "../../data/runtime";
import { ApiError } from "../../lib/api/ApiError";
import { WeeklyPatternEditor } from "./WeeklyPatternEditor";

const STUDENT = "10000000-0000-4000-8000-000000000001";

function savedPattern(studentId: string) {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    studentId,
    effectiveFrom: new Date().toLocaleDateString("en-CA"),
    effectiveTo: null,
    status: "ACTIVE",
    days: Array.from({ length: 7 }, (_, index) => ({
      dayOfWeek: index + 1,
      available: true,
      availableMinutes: 90,
      devicePolicyOverride: null,
    })),
    version: 0,
    updatedAt: "2026-08-30T00:00:00Z",
  };
}

function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AntApp>
        <WeeklyPatternEditor studentId={STUDENT} />
      </AntApp>
    </QueryClientProvider>,
  );
}

describe("WeeklyPatternEditor", () => {
  afterEach(() => {
    setDataAdapterForTests(null);
    vi.restoreAllMocks();
  });

  it("shows the editing rows only after clicking create, then saves the filled draft", async () => {
    const user = userEvent.setup({ delay: null });
    const getWeeklyPattern = vi.fn(() =>
      Promise.reject(
        new ApiError(404, "学生常规周不存在", "WEEKLY_PATTERN_NOT_FOUND"),
      ),
    );
    const saveWeeklyPattern = vi.fn(() =>
      Promise.resolve(savedPattern(STUDENT)),
    );
    setDataAdapterForTests({
      getWeeklyPattern,
      saveWeeklyPattern,
    } as unknown as DataAdapter);
    renderEditor();

    // 第一阶段：只有创建入口，没有铺开的 7 行编辑界面。
    expect(await screen.findByText(/尚未创建常规周/)).toBeVisible();
    expect(screen.queryByLabelText("周一可用分钟")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "创建常规周" }));

    // 第二阶段：出现逐日开关与分钟编辑，默认草稿 7 天全部可学习但分钟为 0
    //（WBS FR-PROFILE-003 / AVL-005），未补齐时长前不允许保存。
    const saveButton = await screen.findByRole("button", {
      name: "保存常规周",
    });
    expect(saveButton).toBeDisabled();
    for (const day of [
      "周一",
      "周二",
      "周三",
      "周四",
      "周五",
      "周六",
      "周日",
    ]) {
      await user.type(screen.getByLabelText(`${day}可用分钟`), "90");
    }
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);
    await waitFor(() => expect(saveWeeklyPattern).toHaveBeenCalledTimes(1));
    const [studentId, payload] = saveWeeklyPattern.mock.calls[0] as unknown as [
      string,
      { days: Array<{ availableMinutes: number }> },
    ];
    expect(studentId).toBe(STUDENT);
    expect(payload.days).toHaveLength(7);
    expect(payload.days.every((day) => day.availableMinutes === 90)).toBe(true);
  });

  it("fills the draft from a preset template before saving", async () => {
    const user = userEvent.setup({ delay: null });
    const getWeeklyPattern = vi.fn(() =>
      Promise.reject(
        new ApiError(404, "学生常规周不存在", "WEEKLY_PATTERN_NOT_FOUND"),
      ),
    );
    const saveWeeklyPattern = vi.fn(() =>
      Promise.resolve(savedPattern(STUDENT)),
    );
    setDataAdapterForTests({
      getWeeklyPattern,
      saveWeeklyPattern,
    } as unknown as DataAdapter);
    renderEditor();

    await screen.findByText(/尚未创建常规周/);
    await user.click(screen.getByRole("button", { name: "创建常规周" }));

    // 预设"每天90分钟"直接把 7 天都填好，保存不再被禁用。
    await user.click(await screen.findByRole("button", { name: "每天90分钟" }));
    expect(screen.getByLabelText("周一可用分钟")).toHaveValue("90");
    expect(screen.getByLabelText("周日可用分钟")).toHaveValue("90");

    const saveButton = screen.getByRole("button", { name: "保存常规周" });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);
    await waitFor(() => expect(saveWeeklyPattern).toHaveBeenCalledTimes(1));
    const [, payload] = saveWeeklyPattern.mock.calls[0] as unknown as [
      string,
      { days: Array<{ available: boolean; availableMinutes: number }> },
    ];
    expect(payload.days.every((day) => day.availableMinutes === 90)).toBe(true);
  });

  it("keeps the existing edit form when a weekly pattern is already ACTIVE", async () => {
    const getWeeklyPattern = vi.fn(() =>
      Promise.resolve(savedPattern(STUDENT)),
    );
    setDataAdapterForTests({
      getWeeklyPattern,
    } as unknown as DataAdapter);
    renderEditor();

    // 已有常规周时仍是"保存常规周"的编辑表单，不出现创建入口。
    expect(
      await screen.findByRole("button", { name: "保存常规周" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "创建常规周" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("周一可用分钟")).toHaveValue("90");
  });
});
