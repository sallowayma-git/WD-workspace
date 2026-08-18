import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudentListPage } from "./StudentListPage";

describe("StudentListPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps profile, vocabulary, and schedule as independent links", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "10000000-0000-4000-8000-000000000001",
              studentCode: "S001",
              name: "林同学",
              alias: null,
              status: "ACTIVE",
              classType: "强化班",
              enrollmentDate: null,
              defaultDevicePolicy: "CONFIRM",
              primaryAssistantId: null,
              note: null,
              tags: [],
              subjectPreferences: [],
              version: 0,
              updatedAt: "2026-08-16T00:00:00Z",
            },
          ],
          page: 0,
          size: 50,
          total: 1,
          hasNext: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <StudentListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // AC-002: each of the three entry links has a distinct, screen-reader-
    // friendly accessible name so they are not conflated by assistive tech.
    expect(
      await screen.findByRole("link", { name: "打开 林同学 资料" }),
    ).toHaveAttribute(
      "href",
      "/students/10000000-0000-4000-8000-000000000001/profile",
    );
    expect(await screen.findByRole("link", { name: "林同学 生词本" })).toHaveAttribute(
      "href",
      "/students/10000000-0000-4000-8000-000000000001/vocabulary",
    );
    expect(await screen.findByRole("link", { name: "林同学 排期" })).toHaveAttribute(
      "href",
      "/students/10000000-0000-4000-8000-000000000001/schedule",
    );
  });
});
