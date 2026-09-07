import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataAdapter } from "../../data/DataAdapter";
import { setDataAdapterForTests } from "../../data/runtime";
import { StudentListPage } from "./StudentListPage";

describe("StudentListPage", () => {
  afterEach(() => {
    setDataAdapterForTests(null);
    vi.restoreAllMocks();
  });

  it("keeps profile, vocabulary, and schedule as independent links", async () => {
    setDataAdapterForTests({
      listStudents: () =>
        Promise.resolve({
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
    } as unknown as DataAdapter);
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
    expect(
      await screen.findByRole("link", { name: "林同学 生词本" }),
    ).toHaveAttribute(
      "href",
      "/students/10000000-0000-4000-8000-000000000001/vocabulary",
    );
    expect(
      await screen.findByRole("link", { name: "林同学 排期" }),
    ).toHaveAttribute(
      "href",
      "/students/10000000-0000-4000-8000-000000000001/schedule",
    );
  });

  it("searches the local student list by the typed term", async () => {
    const user = userEvent.setup({ delay: null });
    const listStudents = vi.fn<(query?: string) => Promise<unknown>>((query) =>
      Promise.resolve({
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
            note: null,
            tags: [],
            subjectPreferences: [],
            version: 0,
            updatedAt: "2026-08-16T00:00:00Z",
          },
          {
            id: "10000000-0000-4000-8000-000000000002",
            studentCode: "S002",
            name: "王同学",
            alias: null,
            status: "ACTIVE",
            classType: "强化班",
            enrollmentDate: null,
            defaultDevicePolicy: "CONFIRM",
            note: null,
            tags: [],
            subjectPreferences: [],
            version: 0,
            updatedAt: "2026-08-16T00:00:00Z",
          },
        ].filter(
          (item) =>
            !query ||
            item.name.includes(query) ||
            item.studentCode.includes(query),
        ),
        page: 0,
        size: 50,
        total: 1,
        hasNext: false,
      }),
    );
    setDataAdapterForTests({ listStudents } as unknown as DataAdapter);
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

    expect(await screen.findByText("林同学")).toBeVisible();
    expect(screen.getByText("王同学")).toBeVisible();

    // ACC-010: the term is pushed into the local query, not filtered in the
    // rendered table, so the search works over the whole SQLite table.
    await user.type(screen.getByLabelText("搜索学生"), "王");
    // Ant Design inserts a space between the two Chinese glyphs of a button
    // label, so match loosely rather than on the exact string.
    await user.click(screen.getByRole("button", { name: /搜\s*索/ }));

    await waitFor(() => expect(listStudents).toHaveBeenLastCalledWith("王"));
    await waitFor(() =>
      expect(screen.queryByText("林同学")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("王同学")).toBeVisible();
  });
});
