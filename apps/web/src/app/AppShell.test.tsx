import { App as AntApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { DataAdapter } from "../data/DataAdapter";
import { setDataAdapterForTests } from "../data/runtime";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  afterEach(() => {
    setDataAdapterForTests(null);
  });

  it("keeps the three frozen top-level navigation meanings distinct", () => {
    // 顶栏挂了启动补日结，给它一个什么都没积压的适配器，别去碰真库。
    setDataAdapterForTests({
      reconcileStartup: (businessDate: string) =>
        Promise.resolve({
          ran: false,
          previousDate: businessDate,
          businessDate,
          summary: null,
        }),
    } as unknown as DataAdapter);
    // 顶栏的快速添加组件依赖 react-query，测试挂载时一并提供 Provider。
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AntApp>
          <MemoryRouter initialEntries={["/foundation"]}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/foundation" element={<div>status</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AntApp>
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("navigation", { name: "一级导航" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "今日工作" })).toHaveAttribute(
      "href",
      "/today",
    );
    expect(screen.getByRole("link", { name: "学生工作台" })).toHaveAttribute(
      "href",
      "/workbench",
    );
    expect(screen.getByRole("link", { name: "学生列表" })).toHaveAttribute(
      "href",
      "/students",
    );
    expect(screen.getByRole("link", { name: "长期任务" })).toHaveAttribute(
      "href",
      "/long-tasks",
    );
    expect(
      screen.queryByRole("link", { name: "日结管理" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "打开全局搜索" }),
    ).toBeInTheDocument();
  });
});
