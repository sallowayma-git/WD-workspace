import * as XLSX from "xlsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataAdapter } from "../../data/DataAdapter";
import { setDataAdapterForTests } from "../../data/runtime";
import { ImportPage } from "./ImportPage";

function scheduleFile(): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["姓名", "编号", "2026-09-21 周一"],
      ["林同学", "S001", "任务一"],
    ]),
    "学生工作台",
  );
  const bytes = XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx",
  }) as ArrayBuffer;
  return new File([bytes], "schedule.xlsx");
}

describe("ImportPage schedule import", () => {
  afterEach(() => {
    setDataAdapterForTests(null);
    vi.restoreAllMocks();
  });

  it("shows execute failures and lets the user retry", async () => {
    const executeScheduleImport = vi
      .fn()
      .mockRejectedValueOnce(new Error("执行失败"))
      .mockResolvedValue({ created: 1 });
    setDataAdapterForTests({
      previewScheduleImport: vi.fn().mockResolvedValue({
        toCreate: [
          {
            studentId: "10000000-0000-4000-8000-000000000001",
            studentName: "林同学",
            studentCode: "S001",
            date: "2026-09-21",
            titles: ["任务一"],
          },
        ],
        skippedDuplicates: 0,
        unmatchedStudents: [],
        invalidRows: [],
      }),
      executeScheduleImport,
    } as unknown as DataAdapter);
    const user = userEvent.setup({ delay: null });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ImportPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const upload =
      container.querySelectorAll<HTMLInputElement>('input[type="file"]')[0];
    if (!upload) throw new Error("schedule upload input was not rendered");
    await user.upload(upload, scheduleFile());
    expect(
      await screen.findByRole("button", { name: /确认导入 1 条/ }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: /确认导入 1 条/ }));
    expect(await screen.findByText("排期导入失败")).toBeVisible();
    expect(screen.getByText("执行失败")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(executeScheduleImport).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText("排期导入失败")).not.toBeInTheDocument(),
    );
  });
});
