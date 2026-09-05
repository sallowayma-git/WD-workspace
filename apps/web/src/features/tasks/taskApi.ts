import { z } from "zod";
import { getDataAdapter } from "../../data/runtime";
import { taskViewSchema } from "./taskViewSchema";

/** Shared local TaskInstance view used by all desktop projections. */
export const taskSchema = taskViewSchema.omit({
  // Drop the flattened summary aliases — row views read the *Snapshot columns.
  title: true,
  shortTitle: true,
  durationMinutes: true,
  carriedOver: true,
});

export type Task = z.infer<typeof taskSchema>;

export type Priority = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export function isPriority(value: unknown): value is Priority {
  return (
    value === "HIGH" ||
    value === "MEDIUM" ||
    value === "LOW" ||
    value === "NONE"
  );
}

/** Sortable subset shared by the Today and Schedule views. */
export type TaskLike = {
  id: string;
  title: string;
  shortTitle?: string | null;
  status: string;
  sourceType: string;
  itemOrdinal?: number | null;
  durationMinutes?: number | null;
  locked: boolean;
  carriedOver?: boolean;
  /** DLY-022: original date the task was carried from; drives the 顺延 tooltip. */
  carriedFromDate?: string | null;
  scheduledDate?: string | null;
  version: number;
  parentTaskId?: string | null;
  linkedParentTaskId?: string | null;
  priority?: string | null;
  sortOrder?: number | null;
  star?: boolean;
};

// ---------------------------------------------------------------------------
// TickTick-style PATCH — title/note/priority/star under optimistic-lock guard
// ---------------------------------------------------------------------------

export interface UpdateTaskInput {
  title?: string;
  note?: string | null;
  priority?: Priority;
  star?: boolean;
  expectedVersion: number;
}

export function updateTask(
  taskId: string,
  input: UpdateTaskInput,
): Promise<Task> {
  return getDataAdapter()
    .updateTask(taskId, {
      taskId,
      title: input.title ?? null,
      note: input.note ?? null,
      priority: input.priority ?? null,
      star: input.star ?? null,
      expectedVersion: input.expectedVersion,
    })
    .then((value) => taskSchema.parse(value));
}

// ---------------------------------------------------------------------------
// Duplicate — copies a task to an optional target date.
// Backend DeleteTask/DuplicateTask/LinkMainTask/ReorderTask all require an
// optimistic-lock `expectedVersion`; omitting it makes every call 409.
// Returns DuplicateTaskResult (not a TaskInstanceView), so callers invalidate
// and refetch rather than parsing the response against taskSchema.
// ---------------------------------------------------------------------------

export interface DuplicateTaskInput {
  expectedVersion: number;
  targetDate?: string;
}

export function duplicateTask(
  taskId: string,
  input: DuplicateTaskInput,
): Promise<void> {
  return getDataAdapter().duplicateTask(taskId, {
    taskId,
    expectedVersion: input.expectedVersion,
    targetDate: input.targetDate ?? null,
  });
}

// ---------------------------------------------------------------------------
// 系列下一项 — “一天一句长难句day1”打勾后点箭头，生成 day2 并排到下一天。
// 序号取同一学生同前缀标题的最大值 +1（当天已有 day1~day3 时得到 day4）；
// 标题没有尾部数字时退化为复制到下一天。返回新任务的完整视图供 toast 展示。
// ---------------------------------------------------------------------------

export function createNextSeriesTask(
  taskId: string,
  input: { expectedVersion?: number },
): Promise<Task> {
  return getDataAdapter()
    .createNextSeriesTask(taskId, {
      taskId,
      expectedVersion: input.expectedVersion ?? null,
    })
    .then((value) => taskSchema.parse(value));
}

// ---------------------------------------------------------------------------
// Subtask — create a child under a parent task.
// Returns CreateSubTaskResult (not a TaskInstanceView), so callers invalidate
// and refetch rather than parsing the response against taskSchema.
// ---------------------------------------------------------------------------

export interface CreateSubTaskInput {
  title: string;
  scheduledDate?: string;
  priority?: Priority;
}

export function createSubTask(
  parentTaskId: string,
  input: CreateSubTaskInput,
): Promise<void> {
  return getDataAdapter().createSubTask(parentTaskId, {
    taskId: parentTaskId,
    title: input.title,
    scheduledDate: input.scheduledDate ?? null,
    priority: input.priority ?? null,
  });
}

// ---------------------------------------------------------------------------
// Link — associate this task with a main/parent task. Returns the updated
// TaskInstanceView, so it is parsed against taskSchema.
// ---------------------------------------------------------------------------

export function linkMainTask(
  taskId: string,
  expectedVersion: number,
  linkedParentTaskId: string,
): Promise<Task> {
  return getDataAdapter()
    .linkMainTask(taskId, { taskId, expectedVersion, linkedParentTaskId })
    .then((value) => taskSchema.parse(value));
}

// ---------------------------------------------------------------------------
// Physical delete — active tasks only. Local SQLite permits a PENDING carry
// target to be removed, while history rows (CARRIED_OVER/CANCELLED) are kept.
// The caller must provide the current {taskId, expectedVersion}.
// ---------------------------------------------------------------------------

export function deleteTask(
  taskId: string,
  expectedVersion: number,
): Promise<void> {
  return getDataAdapter().deleteTask(taskId, { taskId, expectedVersion });
}

// ---------------------------------------------------------------------------
// Reorder — set the new sort position of a task. Returns the updated
// TaskInstanceView, parsed against taskSchema.
// ---------------------------------------------------------------------------

export function reorderTask(
  taskId: string,
  expectedVersion: number,
  newSortOrder: number,
): Promise<Task> {
  return getDataAdapter()
    .reorderTask(taskId, { taskId, expectedVersion, newSortOrder })
    .then((value) => taskSchema.parse(value));
}
