import type { QueryClient } from "@tanstack/react-query";
import { rescheduleTask } from "../schedule/scheduleApi";
import {
  carryForwardTask,
  completeTask,
  reopenTask,
  undoCarryover,
} from "../today/todayApi";

/** Shared remote command facade used by Today, Matrix and Calendar surfaces. */
export const taskActions = {
  complete: completeTask,
  carryForward: carryForwardTask,
  reopen: reopenTask,
  reschedule: rescheduleTask,
  undoCarryover,
} as const;

const taskViewQueryKeys = [
  ["today"],
  ["today-carryovers"],
  ["workbench"],
  ["schedule"],
] as const;

/** Refresh every projection backed by the shared task-instance truth. */
export async function invalidateTaskViews(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all(
    taskViewQueryKeys.map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
}
