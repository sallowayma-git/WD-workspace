import { App as AntApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataAdapter } from "../../data/DataAdapter";
import { setDataAdapterForTests } from "../../data/runtime";
import { useStartupReconciliation } from "./useStartupReconciliation";

function summary(overrides: Record<string, unknown> = {}) {
  return {
    runId: "20000000-0000-4000-8000-000000000001",
    businessDate: "2026-09-06",
    startedAt: "2026-09-06T08:00:00.000Z",
    finishedAt: "2026-09-06T08:00:01.000Z",
    scanned: 3,
    carried: 3,
    blocked: 0,
    skipped: 0,
    failed: 0,
    status: "SUCCEEDED",
    errorSummary: null,
    items: [],
    ...overrides,
  };
}

function Harness() {
  useStartupReconciliation();
  return <div>shell</div>;
}

function renderHarness() {
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

describe("useStartupReconciliation", () => {
  afterEach(() => {
    setDataAdapterForTests(null);
    vi.restoreAllMocks();
  });

  it("reports what the catch-up day-close did", async () => {
    const reconcileStartup = vi.fn((businessDate: string) =>
      Promise.resolve({
        ran: true,
        previousDate: "2026-09-01",
        businessDate,
        summary: summary({ scanned: 4, carried: 3, blocked: 1 }),
      }),
    );
    setDataAdapterForTests({ reconcileStartup } as unknown as DataAdapter);
    renderHarness();

    expect(await screen.findByText("期间自动处理 4 项")).toBeInTheDocument();
    expect(
      screen.getByText("已顺延 3 项，1 项无可用学习日"),
    ).toBeInTheDocument();
    // 业务日来自本机日历，只断言被调用过一次。
    expect(reconcileStartup).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when nothing was overdue", async () => {
    setDataAdapterForTests({
      reconcileStartup: () =>
        Promise.resolve({
          ran: true,
          previousDate: "2026-09-05",
          businessDate: "2026-09-06",
          summary: summary({ scanned: 0, carried: 0 }),
        }),
    } as unknown as DataAdapter);
    renderHarness();

    await screen.findByText("shell");
    await waitFor(() => {
      expect(screen.queryByText(/期间自动处理/)).toBeNull();
    });
  });

  it("stays quiet when today was already reconciled", async () => {
    setDataAdapterForTests({
      reconcileStartup: (businessDate: string) =>
        Promise.resolve({
          ran: false,
          previousDate: businessDate,
          businessDate,
          summary: null,
        }),
    } as unknown as DataAdapter);
    renderHarness();

    await screen.findByText("shell");
    expect(screen.queryByText(/期间自动处理/)).toBeNull();
  });

  it("keeps the shell usable when the catch-up fails", async () => {
    setDataAdapterForTests({
      reconcileStartup: () => Promise.reject(new Error("数据库被占用")),
    } as unknown as DataAdapter);
    renderHarness();

    expect(await screen.findByText("shell")).toBeVisible();
    expect(screen.queryByText(/期间自动处理/)).toBeNull();
  });
});
