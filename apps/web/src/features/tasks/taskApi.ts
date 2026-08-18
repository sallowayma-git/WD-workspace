import { z } from "zod";
import { deleteVoid, patchJson, postJson, postVoid } from "../../lib/api/http";

/**
 * TaskInstanceView — the backend record returned by /tasks endpoints.
 * Mirrors com.wonderedu.assistant.planning.api.TaskInstanceView.
 */
export const taskSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid().nullable(),
  sourceType: z.string(),
  trackId: z.string().uuid().nullable(),
  templateVersionId: z.string().uuid().nullable(),
  templateItemId: z.string().uuid().nullable(),
  itemOrdinal: z.number().nullable(),
  scheduledDate: z.string().nullable(),
  originalScheduledDate: z.string().nullable(),
  status: z.string(),
  titleSnapshot: z.string().nullable(),
  shortTitleSnapshot: z.string().nullable(),
  durationMinutesSnapshot: z.number().nullable(),
  requiresDeviceSnapshot: z.boolean().nullable(),
  scheduleOrigin: z.string().nullable(),
  manualOverride: z.boolean().nullable(),
  overrideReason: z.string().nullable(),
  locked: z.boolean(),
  note: z.string().nullable(),
  carriedFromInstanceId: z.string().uuid().nullable(),
  carriedToInstanceId: z.string().uuid().nullable(),
  completedAt: z.string().nullable(),
  completedBy: z.string().uuid().nullable(),
  cancelledAt: z.string().nullable(),
  cancelledBy: z.string().uuid().nullable(),
  parentTaskId: z.string().uuid().nullable(),
  linkedParentTaskId: z.string().uuid().nullable(),
  priority: z.string().nullable(),
  sortOrder: z.number().nullable(),
  star: z.boolean().nullable(),
  version: z.number(),
  updatedAt: z.string().nullable(),
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

/** Sortable/usable subset kept by the lighter TodayApi/ScheduleApi views. */
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

export function updateTask(taskId: string, input: UpdateTaskInput): Promise<Task> {
  return patchJson(`/tasks/${taskId}`, taskSchema, {
    taskId,
    title: input.title ?? null,
    note: input.note ?? null,
    priority: input.priority ?? null,
    star: input.star ?? null,
    expectedVersion: input.expectedVersion,
  });
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
  return postVoid(`/tasks/${taskId}/duplicate`, {
    taskId,
    expectedVersion: input.expectedVersion,
    targetDate: input.targetDate ?? null,
  });
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
  return postVoid(`/tasks/${parentTaskId}/subtasks`, {
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
  return postJson(`/tasks/${taskId}/link`, taskSchema, {
    taskId,
    expectedVersion,
    linkedParentTaskId,
  });
}

// ---------------------------------------------------------------------------
// Physical delete — AD_HOC/IMPORT tasks only (backend enforces).
// Backend DeleteTask record carries {taskId, expectedVersion}; backend returns
// 204 No Content on success.
// ---------------------------------------------------------------------------

export function deleteTask(
  taskId: string,
  expectedVersion: number,
): Promise<void> {
  return deleteVoid(`/tasks/${taskId}`, { taskId, expectedVersion });
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
  return postJson(`/tasks/${taskId}/reorder`, taskSchema, {
    taskId,
    expectedVersion,
    newSortOrder,
  });
}

// Re-export the void POST helper so callers building ad-hoc task mutations
// (e.g. reschedule override flows) have a consistent import surface.
export { postVoid };
