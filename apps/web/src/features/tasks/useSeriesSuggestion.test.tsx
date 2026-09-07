import { App as AntApp, Button } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataAdapter } from "../../data/DataAdapter";
import { setDataAdapterForTests } from "../../data/runtime";
import { useSeriesSuggestion } from "./useSeriesSuggestion";

const STUDENT_ID = "10000000-0000-4000-8000-000000000001";
const TRACK_ID = "40000000-0000-4000-8000-000000000009";

const suggestion = {
  normalizedKey: "密卷",
  seriesName: "密卷",
  titlePattern: "密卷{n}",
  assignmentCount: 4,
  latestOrdinal: 4,
  nextOrdinal: 5,
  taskId: "20000000-0000-4000-8000-000000000004",
  taskVersion: 3,
};

const convertedTrack = {
  id: TRACK_ID,
  studentId: STUDENT_ID,
  templateId: "70000000-0000-4000-8000-000000000001",
  templateVersionId: null,
  generationMode: "SEQUENCE",
  definitionName: "密卷",
  titlePatternSnapshot: "密卷{n}",
  status: "ACTIVE",
  startOrdinal: 4,
  currentOrdinal: 4,
  endOrdinal: null,
  defaultUnitsPerSession: 1,
  startDate: "2026-09-05",
  nextCandidateDate: "2026-09-05",
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
    currentOrdinal: 4,
    endOrdinal: null,
    completedUnits: 0,
    totalUnits: null,
    percent: null,
  },
  warnings: [],
};

function Harness() {
  const { offerSeriesSuggestion } = useSeriesSuggestion();
  return (
    <Button onClick={() => void offerSeriesSuggestion(STUDENT_ID)}>
      布置任务
    </Button>
  );
}

function renderHarness(adapter: Record<string, unknown>) {
  setDataAdapterForTests(adapter as unknown as DataAdapter);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AntApp>
        <Harness />
      </AntApp>
    </QueryClientProvider>,
  );
}

const assign = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "布置任务" }));

describe("useSeriesSuggestion", () => {
  afterEach(() => {
    setDataAdapterForTests(null);
    vi.restoreAllMocks();
  });

  it("offers the series without blocking and converts on accept", async () => {
    const user = userEvent.setup({ delay: null });
    const convertTaskToLongTask = vi.fn().mockResolvedValue({
      taskId: suggestion.taskId,
      trackId: TRACK_ID,
      ordinal: 4,
      definitionCreated: true,
      track: convertedTrack,
    });
    renderHarness({
      listSeriesSuggestions: vi.fn().mockResolvedValue({ items: [suggestion] }),
      convertTaskToLongTask,
    });

    await assign(user);
    expect(
      await screen.findByText("已连续布置 4 次「密卷」"),
    ).toBeInTheDocument();
    // 建议不能拦住助教手上的动作：不是 Modal。
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "设为长期任务" }));
    await waitFor(() => {
      expect(convertTaskToLongTask).toHaveBeenCalledTimes(1);
    });
    expect(convertTaskToLongTask).toHaveBeenCalledWith(
      suggestion.taskId,
      expect.objectContaining({ expectedVersion: 3 }),
    );
    expect(
      await screen.findByText(/已设为长期任务，完成后自动接排第 5 项/),
    ).toBeInTheDocument();
  });

  it("records 暂不 instead of converting", async () => {
    const user = userEvent.setup({ delay: null });
    const dismissSeriesSuggestion = vi.fn().mockResolvedValue(undefined);
    const convertTaskToLongTask = vi.fn();
    renderHarness({
      listSeriesSuggestions: vi.fn().mockResolvedValue({ items: [suggestion] }),
      dismissSeriesSuggestion,
      convertTaskToLongTask,
    });

    await assign(user);
    await screen.findByText("已连续布置 4 次「密卷」");
    // antd 会给两字按钮插一个空格。
    await user.click(screen.getByRole("button", { name: /暂\s*不/ }));

    await waitFor(() => {
      expect(dismissSeriesSuggestion).toHaveBeenCalledWith(STUDENT_ID, {
        normalizedKey: "密卷",
      });
    });
    expect(convertTaskToLongTask).not.toHaveBeenCalled();
  });

  it("says nothing when no series qualifies", async () => {
    const user = userEvent.setup({ delay: null });
    const listSeriesSuggestions = vi.fn().mockResolvedValue({ items: [] });
    renderHarness({ listSeriesSuggestions });

    await assign(user);
    await waitFor(() => {
      expect(listSeriesSuggestions).toHaveBeenCalledWith(STUDENT_ID);
    });
    expect(screen.queryByText(/已连续布置/)).toBeNull();
  });

  it("swallows a failed suggestion lookup", async () => {
    const user = userEvent.setup({ delay: null });
    const listSeriesSuggestions = vi
      .fn()
      .mockRejectedValue(new Error("db closed"));
    renderHarness({ listSeriesSuggestions });

    await assign(user);
    await waitFor(() => {
      expect(listSeriesSuggestions).toHaveBeenCalled();
    });
    expect(screen.queryByText(/已连续布置/)).toBeNull();
    expect(screen.queryByText(/db closed/)).toBeNull();
  });
});
