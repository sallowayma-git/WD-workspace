import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { invalidateTaskViews } from "./taskActions";

describe("shared task-view invalidation", () => {
  it("refreshes every projection of the shared task truth", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const observed: string[] = [];
    // Seed one cached entry per projection, matching the real query keys.
    const keys = [
      ["today", "2026-08-20"],
      ["today-carryovers", "2026-08-20"],
      ["workbench", "2026-08-17"],
      ["schedule", "student-1", "week", "2026-08-20"],
      // A key that is not a task projection must be left alone.
      ["templates", ""],
    ];
    for (const key of keys) {
      queryClient.setQueryData(key, "cached");
    }

    await invalidateTaskViews(queryClient);

    for (const key of keys) {
      const state = queryClient.getQueryState(key);
      if (state?.isInvalidated) observed.push(key[0]);
    }

    // ACC-070/071/072: completing or moving a task in any one view must mark
    // all three views stale. Relying on refetchOnMount/staleTime let a task
    // read COMPLETED in one view and PENDING in another.
    expect(observed.sort()).toEqual([
      "schedule",
      "today",
      "today-carryovers",
      "workbench",
    ]);
    expect(queryClient.getQueryState(["templates", ""])?.isInvalidated).toBe(
      false,
    );
  });
});
