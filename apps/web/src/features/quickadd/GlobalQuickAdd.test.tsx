import { App as AntApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataAdapter } from "../../data/DataAdapter";
import { setDataAdapterForTests } from "../../data/runtime";
import { GlobalQuickAdd } from "./GlobalQuickAdd";

const LIN = "10000000-0000-4000-8000-000000000001";
const WANG = "10000000-0000-4000-8000-000000000002";

function studentView(id: string, name: string, studentCode: string) {
  return {
    id,
    studentCode,
    name,
    alias: null,
    status: "ACTIVE",
    classType: null,
    enrollmentDate: null,
    defaultDevicePolicy: "CONFIRM",
    primaryAssistantId: null,
    note: null,
    tags: [],
    subjectPreferences: [],
    version: 0,
    updatedAt: "2026-08-30T00:00:00Z",
  };
}

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

function tomorrowKey(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function renderQuickAdd() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AntApp>
        <GlobalQuickAdd />
      </AntApp>
    </QueryClientProvider>,
  );
}

describe("GlobalQuickAdd", () => {
  afterEach(() => {
    setDataAdapterForTests(null);
    vi.restoreAllMocks();
  });

  it("turns the typed student and date into inline capsules and creates the task on Enter", async () => {
    const user = userEvent.setup({ delay: null });
    const createAdHocTask = vi.fn(
      (input: { scheduledDate: string; title: string }) =>
        Promise.resolve(adHocTaskView(input.scheduledDate, input.title)),
    );
    setDataAdapterForTests({
      listStudents: () =>
        Promise.resolve({
          items: [
            studentView(LIN, "林同学", "S001"),
            studentView(WANG, "王小明", "S002"),
          ],
          page: 0,
          size: 2,
          total: 2,
          hasNext: false,
        }),
      createAdHocTask,
    } as unknown as DataAdapter);
    renderQuickAdd();

    // 收起态是一个入口按钮，点击后展开令牌输入框。
    await user.click(screen.getByRole("button", { name: "快速添加" }));
    const input = screen.getByLabelText("快速添加任务输入");
    await user.type(input, "林同学 明天 口算练习");

    // 学生与日期直接"吸"进输入框变成胶囊，输入框里只剩任务内容。
    expect(await screen.findByText("林同学")).toBeVisible();
    expect(screen.getByText("明天")).toBeVisible();
    expect(input).toHaveValue("口算练习");

    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(createAdHocTask).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId: LIN,
          scheduledDate: tomorrowKey(),
          title: "口算练习",
        }),
      ),
    );
  });

  it("supports the compact 0831 date form as an inline capsule", async () => {
    const user = userEvent.setup({ delay: null });
    setDataAdapterForTests({
      listStudents: () =>
        Promise.resolve({
          items: [studentView(LIN, "林同学", "S001")],
          page: 0,
          size: 1,
          total: 1,
          hasNext: false,
        }),
    } as unknown as DataAdapter);
    renderQuickAdd();

    await user.click(screen.getByRole("button", { name: "快速添加" }));
    await user.type(
      screen.getByLabelText("快速添加任务输入"),
      "林同学0831口算",
    );

    expect(await screen.findByText("林同学")).toBeVisible();
    // 0831 被解析成 8月31日 胶囊，剩余文本为任务内容。
    expect(screen.getByText("8月31日")).toBeVisible();
    expect(screen.getByLabelText("快速添加任务输入")).toHaveValue("口算");
  });

  it("warns when no student matched instead of creating a broken task", async () => {
    const user = userEvent.setup({ delay: null });
    const createAdHocTask = vi.fn();
    setDataAdapterForTests({
      listStudents: () =>
        Promise.resolve({
          items: [studentView(LIN, "林同学", "S001")],
          page: 0,
          size: 1,
          total: 1,
          hasNext: false,
        }),
      createAdHocTask,
    } as unknown as DataAdapter);
    renderQuickAdd();

    await user.click(screen.getByRole("button", { name: "快速添加" }));
    await user.type(
      screen.getByLabelText("快速添加任务输入"),
      "不存在的同学 复习",
    );
    await user.keyboard("{Enter}");

    await waitFor(() => expect(createAdHocTask).not.toHaveBeenCalled());
    // toast 提示（行内不再有胶囊/提示行）；antd message 有进场动画，
    // 这里只断言出现即可。
    expect(
      await screen.findByText("未匹配到学生：请先输入学生姓名（或编号）"),
    ).toBeInTheDocument();
  });

  it("deletes the last capsule on Enter when no task content was typed", async () => {
    const user = userEvent.setup({ delay: null });
    const createAdHocTask = vi.fn();
    setDataAdapterForTests({
      listStudents: () =>
        Promise.resolve({
          items: [studentView(LIN, "林同学", "S001")],
          page: 0,
          size: 1,
          total: 1,
          hasNext: false,
        }),
      createAdHocTask,
    } as unknown as DataAdapter);
    renderQuickAdd();

    await user.click(screen.getByRole("button", { name: "快速添加" }));
    await user.type(screen.getByLabelText("快速添加任务输入"), "林同学");
    expect(await screen.findByText("林同学")).toBeVisible();

    // 约定：没有任务内容时回车 = 删除最后一个胶囊。
    await user.keyboard("{Enter}");
    expect(screen.queryByText("林同学")).not.toBeInTheDocument();
    expect(createAdHocTask).not.toHaveBeenCalled();
  });

  it("removes a token match by double-clicking its capsule", async () => {
    const user = userEvent.setup({ delay: null });
    setDataAdapterForTests({
      listStudents: () =>
        Promise.resolve({
          items: [studentView(LIN, "林同学", "S001")],
          page: 0,
          size: 1,
          total: 1,
          hasNext: false,
        }),
    } as unknown as DataAdapter);
    renderQuickAdd();

    await user.click(screen.getByRole("button", { name: "快速添加" }));
    await user.type(screen.getByLabelText("快速添加任务输入"), "林同学 明天");
    expect(await screen.findByText("林同学")).toBeVisible();
    expect(screen.getByText("明天")).toBeVisible();

    await user.dblClick(screen.getByText("林同学"));
    expect(screen.queryByText("林同学")).not.toBeInTheDocument();
    // 日期胶囊不受影响。
    expect(screen.getByText("明天")).toBeVisible();
  });
});
