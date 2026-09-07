import { App as AntApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataAdapter } from "../../data/DataAdapter";
import { setDataAdapterForTests } from "../../data/runtime";
import { MountLongTaskModal } from "./MountLongTaskModal";
import type { LongTask } from "./longTaskApi";

const longTask: LongTask = {
  id: "70000000-0000-4000-8000-000000000001",
  name: "一天一句长难句 Day",
  status: "ACTIVE",
  generationMode: "SEQUENCE",
  titlePattern: "一天一句长难句 Day {n}",
  defaultStartOrdinal: 1,
  endOrdinal: null,
  defaultDurationMinutes: null,
  activeTrackCount: 0,
  version: 0,
  updatedAt: "2026-09-05T00:00:00Z",
};

const mountedTrack = {
  id: "40000000-0000-4000-8000-000000000009",
  studentId: "10000000-0000-4000-8000-000000000001",
  templateId: longTask.id,
  templateVersionId: null,
  generationMode: "SEQUENCE",
  definitionName: longTask.name,
  titlePatternSnapshot: longTask.titlePattern,
  status: "ACTIVE",
  startOrdinal: 7,
  currentOrdinal: 7,
  endOrdinal: null,
  defaultUnitsPerSession: 1,
  startDate: "2026-09-07",
  nextCandidateDate: "2026-09-07",
  priority: 50,
  allowParallelItems: false,
  schedulingPolicy: "AUTO",
  durationOverrideMinutes: null,
  devicePolicyOverride: null,
  note: null,
  completedAt: null,
  version: 0,
  updatedAt: "2026-09-05T00:00:00Z",
  progress: {
    currentOrdinal: 7,
    endOrdinal: null,
    completedUnits: 0,
    totalUnits: null,
    percent: null,
  },
  warnings: [],
};

function renderModal(
  adapter: Record<string, unknown>,
  onMounted: (trackId: string) => void = () => {},
) {
  setDataAdapterForTests(adapter as unknown as DataAdapter);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const taskKeys = [["today", "2026-09-07"], ["workbench"], ["schedule"]];
  for (const key of taskKeys) queryClient.setQueryData(key, { cached: true });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AntApp>
        <MountLongTaskModal
          studentId="10000000-0000-4000-8000-000000000001"
          anchorDate="2026-09-07"
          open
          onClose={() => {}}
          onMounted={onMounted}
        />
      </AntApp>
    </QueryClientProvider>,
  );
  return { ...view, queryClient, taskKeys };
}

describe("MountLongTaskModal", () => {
  afterEach(() => {
    setDataAdapterForTests(null);
    vi.restoreAllMocks();
  });

  it("mounts with only the essential fields and previews the first item", async () => {
    const user = userEvent.setup({ delay: null });
    const mountLongTask = vi.fn().mockResolvedValue(mountedTrack);
    const { queryClient, taskKeys } = renderModal({
      // 适配器的列表返回是分页信封，与 listLongTasks 的 zod 契约一致。
      listLongTasks: vi.fn().mockResolvedValue({
        items: [longTask],
        page: 0,
        size: 1,
        total: 1,
        hasNext: false,
      }),
      mountLongTask,
    });

    // 定义默认序号 1 → 预览「一天一句长难句 Day 1」。
    await screen.findByText(/首项：一天一句长难句 Day 1/);

    // 序号输入框已有默认值 1，先清空再输入目标序号。
    const ordinalInput = screen.getByLabelText("从第几项开始");
    await user.clear(ordinalInput);
    await user.type(ordinalInput, "7");
    await user.click(screen.getByRole("button", { name: "挂 载" }));

    await waitFor(() => {
      expect(mountLongTask).toHaveBeenCalledTimes(1);
    });
    expect(mountLongTask).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: "10000000-0000-4000-8000-000000000001",
        longTaskId: longTask.id,
        currentOrdinal: 7,
        anchorDate: "2026-09-07",
      }),
    );
    // 幂等键由 API 层生成：必须是本次调用带来的非空字符串。
    const call = mountLongTask.mock.calls[0]?.[0] as
      Record<string, unknown> | undefined;
    expect(typeof call?.idempotencyKey).toBe("string");
    expect(String(call?.idempotencyKey).length).toBeGreaterThan(0);
    await waitFor(() => {
      for (const key of taskKeys)
        expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    });
  });

  it("explains that there is nothing to mount yet", async () => {
    renderModal({
      listLongTasks: vi.fn().mockResolvedValue({
        items: [],
        page: 0,
        size: 0,
        total: 0,
        hasNext: false,
      }),
    });
    // jsdom 下 antd Modal 的动画让可见性断言不稳定，按存在断言即可。
    expect(await screen.findByText(/还没有长期任务/)).toBeInTheDocument();
  });
});
