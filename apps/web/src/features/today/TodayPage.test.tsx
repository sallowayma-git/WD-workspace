import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataAdapter } from "../../data/DataAdapter";
import { setDataAdapterForTests } from "../../data/runtime";
import { TodayPage } from "./TodayPage";

const LIN = "10000000-0000-4000-8000-000000000001";
const WANG = "10000000-0000-4000-8000-000000000002";
const LIN_TASK = "20000000-0000-4000-8000-000000000001";
const WANG_TASK = "20000000-0000-4000-8000-000000000002";

/** The page derives its default date from the local machine calendar. */
function localToday(): string {
  return new Date().toLocaleDateString("en-CA");
}

function task(overrides: Record<string, unknown>) {
  return {
    id: LIN_TASK,
    title: "密卷08 阅读",
    shortTitle: null,
    status: "PENDING",
    sourceType: "TRACK",
    itemOrdinal: 8,
    durationMinutes: 30,
    locked: false,
    carriedOver: false,
    scheduledDate: localToday(),
    version: 0,
    ...overrides,
  };
}

function todayPayload(overrides: { linStatus?: string } = {}) {
  return {
    businessDate: localToday(),
    metrics: {
      totalStudents: 2,
      totalPendingTasks: 2,
      totalCompletedTasks: 0,
      carriedOverTasks: 0,
      blockedTasks: 0,
      conflictCount: 0,
    },
    students: [
      {
        studentId: LIN,
        studentName: "林同学",
        studentCode: "S001",
        devicePolicy: "CONFIRM",
        tasks: [task({ status: overrides.linStatus ?? "PENDING" })],
      },
      {
        studentId: WANG,
        studentName: "王同学",
        studentCode: "S002",
        devicePolicy: "ALLOWED",
        tasks: [task({ id: WANG_TASK, title: "听写练习", itemOrdinal: 3 })],
      },
    ],
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TodayPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TodayPage acceptance", () => {
  afterEach(() => {
    setDataAdapterForTests(null);
    vi.restoreAllMocks();
  });

  it("opens on the local business date and groups tasks by student", async () => {
    const getToday = vi.fn(() => Promise.resolve(todayPayload()));
    setDataAdapterForTests({
      getToday,
      getTodayCarryovers: () => Promise.resolve([]),
    } as unknown as DataAdapter);

    renderPage();

    // ACC-030: no date is chosen by the user, so the page must ask for the
    // local machine's own calendar day.
    await waitFor(() => expect(getToday).toHaveBeenCalledWith(localToday()));

    // ACC-031: each student is a separate group owning only their own tasks.
    const lin = (await screen.findByText("林同学")).closest(".ant-card");
    const wang = (await screen.findByText("王同学")).closest(".ant-card");
    expect(lin).not.toBeNull();
    expect(wang).not.toBeNull();
    expect(within(lin as HTMLElement).getByText("密卷08 阅读")).toBeVisible();
    expect(
      within(lin as HTMLElement).queryByText("听写练习"),
    ).not.toBeInTheDocument();
    expect(within(wang as HTMLElement).getByText("听写练习")).toBeVisible();
  });

  it("completes a task from its checkbox and immediately reflects the new state", async () => {
    let completed = false;
    const completeTask = vi.fn<
      (input: Record<string, unknown>) => Promise<unknown>
    >(() => {
      completed = true;
      return Promise.resolve({});
    });
    const getToday = vi.fn(() =>
      Promise.resolve(
        todayPayload(completed ? { linStatus: "COMPLETED" } : {}),
      ),
    );
    setDataAdapterForTests({
      getToday,
      getTodayCarryovers: () => Promise.resolve([]),
      completeTask,
    } as unknown as DataAdapter);

    renderPage();

    const checkbox = await screen.findByRole("checkbox", {
      name: "任务 密卷08 阅读",
    });
    expect(checkbox).not.toBeChecked();

    await userEvent.click(checkbox);

    // ACC-032: the checkbox issues the complete command with the optimistic
    // lock version, then the view refreshes to the completed state without a
    // manual reload.
    await waitFor(() => expect(completeTask).toHaveBeenCalledTimes(1));
    expect(completeTask.mock.calls[0][0]).toMatchObject({
      taskId: LIN_TASK,
      expectedVersion: 0,
    });
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "任务 密卷08 阅读" }),
      ).toBeChecked(),
    );
  });

  it("creates an ad-hoc task inline for one student", async () => {
    const createAdHocTask = vi.fn<
      (input: Record<string, unknown>) => Promise<unknown>
    >(() =>
      Promise.resolve({
        id: "20000000-0000-4000-8000-000000000009",
        studentId: LIN,
        sourceType: "AD_HOC",
        trackId: null,
        templateVersionId: null,
        templateItemId: null,
        itemOrdinal: null,
        scheduledDate: localToday(),
        originalScheduledDate: localToday(),
        status: "PENDING",
        titleSnapshot: "临时补默写",
        shortTitleSnapshot: null,
        durationMinutesSnapshot: null,
        requiresDeviceSnapshot: null,
        scheduleOrigin: "MANUAL",
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
        updatedAt: "2026-08-20T00:00:00Z",
      }),
    );
    setDataAdapterForTests({
      getToday: () => Promise.resolve(todayPayload()),
      getTodayCarryovers: () => Promise.resolve([]),
      createAdHocTask,
    } as unknown as DataAdapter);

    renderPage();

    // Each student group owns its own composer, addressed by student name.
    const composer = await screen.findByRole("combobox", {
      name: "为 林同学 新增任务",
    });
    await userEvent.type(composer, "临时补默写{Enter}");

    // ACC-033: an ad-hoc task is written straight from Today for that student
    // on the displayed business date, with no template or track involved.
    await waitFor(() => expect(createAdHocTask).toHaveBeenCalledTimes(1));
    expect(createAdHocTask.mock.calls[0][0]).toMatchObject({
      studentId: LIN,
      scheduledDate: localToday(),
      title: "临时补默写",
    });
  });
});
