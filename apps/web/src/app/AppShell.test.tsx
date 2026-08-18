import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "../features/auth/AuthProvider";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("keeps the three frozen top-level navigation meanings distinct", () => {
    render(
      <MemoryRouter initialEntries={["/foundation"]}>
        <Routes>
          <Route
            element={
              <AuthProvider>
                <AppShell />
              </AuthProvider>
            }
          >
            <Route path="/foundation" element={<div>status</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
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
    expect(screen.getByRole("link", { name: "任务模板" })).toHaveAttribute(
      "href",
      "/templates",
    );
    expect(
      screen.getByRole("button", { name: "打开全局搜索" }),
    ).toBeInTheDocument();
  });
});
