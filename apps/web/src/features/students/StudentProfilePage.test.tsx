import { App as AntApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataAdapter } from "../../data/DataAdapter";
import { setDataAdapterForTests } from "../../data/runtime";
import { ApiError } from "../../lib/api/ApiError";
import { StudentProfilePage } from "./StudentProfilePage";

const STUDENT = "10000000-0000-4000-8000-000000000001";

const studentView = {
  id: STUDENT,
  studentCode: "S001",
  name: "林同学",
  alias: null,
  status: "ACTIVE",
  classType: null,
  enrollmentDate: null,
  defaultDevicePolicy: "CONFIRM",
  note: null,
  tags: [],
  subjectPreferences: [],
  version: 3,
  updatedAt: "2026-08-30T00:00:00Z",
};

function renderProfilePage(adapter: Record<string, unknown>) {
  setDataAdapterForTests(adapter as unknown as DataAdapter);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/students/${STUDENT}/profile`]}>
        <AntApp>
          <Routes>
            <Route
              path="/students/:studentId/profile"
              element={<StudentProfilePage />}
            />
            <Route path="/students" element={<div>学生列表占位</div>} />
          </Routes>
        </AntApp>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("StudentProfilePage", () => {
  afterEach(() => {
    setDataAdapterForTests(null);
    vi.restoreAllMocks();
  });

  it("deletes the student after confirmation and returns to the list", async () => {
    const user = userEvent.setup({ delay: null });
    const deleteStudent = vi.fn(() => Promise.resolve());
    renderProfilePage({
      getStudent: () => Promise.resolve(studentView),
      getWeeklyPattern: () =>
        Promise.reject(
          new ApiError(404, "学生常规周不存在", "WEEKLY_PATTERN_NOT_FOUND"),
        ),
      getWeekPlan: () =>
        Promise.reject(
          new ApiError(404, "周计划不存在", "WEEK_PLAN_NOT_FOUND"),
        ),
      listStudentTracks: () => Promise.resolve([]),
      deleteStudent,
    });

    expect(await screen.findByText("学生资料")).toBeVisible();

    // 删除必须经过确认；确认框说明会连带删除的数据范围。
    await user.click(screen.getByRole("button", { name: /删\s*除\s*学\s*生/ }));
    const confirmText = await screen.findByText(
      /将同时删除其常规周、排期、任务、轨道与生词记录/,
    );
    // Ant Design 会在两个汉字的按钮文案之间插入空格，宽松匹配确认按钮；
    // 触发按钮本身也含"删除"两字，把查找范围收窄到确认气泡内。
    const popover = confirmText.closest(".ant-popover") as HTMLElement;
    await user.click(within(popover).getByRole("button", { name: /删\s*除/ }));

    await waitFor(() => expect(deleteStudent).toHaveBeenCalledWith(STUDENT));
    expect(await screen.findByText("学生列表占位")).toBeVisible();
  });

  it("stays on the page and reports when deletion fails", async () => {
    const user = userEvent.setup({ delay: null });
    const deleteStudent = vi.fn(() =>
      Promise.reject(
        new ApiError(409, "本地数据操作失败", "LOCAL_DATABASE_ERROR"),
      ),
    );
    renderProfilePage({
      getStudent: () => Promise.resolve(studentView),
      getWeeklyPattern: () =>
        Promise.reject(
          new ApiError(404, "学生常规周不存在", "WEEKLY_PATTERN_NOT_FOUND"),
        ),
      getWeekPlan: () =>
        Promise.reject(
          new ApiError(404, "周计划不存在", "WEEK_PLAN_NOT_FOUND"),
        ),
      listStudentTracks: () => Promise.resolve([]),
      deleteStudent,
    });

    expect(await screen.findByText("学生资料")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /删\s*除\s*学\s*生/ }));
    const failedText = await screen.findByText(
      /将同时删除其常规周、排期、任务、轨道与生词记录/,
    );
    const failedPopover = failedText.closest(".ant-popover") as HTMLElement;
    await user.click(
      within(failedPopover).getByRole("button", { name: /删\s*除/ }),
    );

    await waitFor(() => expect(deleteStudent).toHaveBeenCalledTimes(1));
    // 失败后仍停留在资料页，可以重试。
    expect(screen.getByText("学生资料")).toBeVisible();
  });
});
