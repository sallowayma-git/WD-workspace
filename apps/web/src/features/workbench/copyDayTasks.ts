import type { WorkbenchTask } from "./workbenchApi";

/** Tasks which are meaningful when copying a day's work. */
export function copyableDayTasks(tasks: WorkbenchTask[]): WorkbenchTask[] {
  return tasks.filter((task) =>
    ["PENDING", "COMPLETED", "BLOCKED"].includes(task.status),
  );
}

/** Numbered list shared by clipboard copy and the Excel export. */
export function formatDayTaskList(tasks: WorkbenchTask[]): string {
  return copyableDayTasks(tasks)
    .map(
      (task, index) =>
        `${index + 1}.${task.title ?? task.shortTitle ?? "未命名"}`,
    )
    .join("\n");
}

/** Format one student's cell for clipboard use. */
export function formatDayTasksForCopy(
  date: string,
  tasks: WorkbenchTask[],
): string;
/** Backwards-compatible one-argument form for the Excel exporter. */
export function formatDayTasksForCopy(tasks: WorkbenchTask[]): string;
export function formatDayTasksForCopy(
  dateOrTasks: string | WorkbenchTask[],
  maybeTasks?: WorkbenchTask[],
): string {
  if (Array.isArray(dateOrTasks)) return formatDayTaskList(dateOrTasks);
  const [, month = "", day = ""] = dateOrTasks.split("-");
  return `${String(Number(month))}月${String(Number(day))}日任务：\n${formatDayTaskList(
    maybeTasks ?? [],
  )}`;
}
