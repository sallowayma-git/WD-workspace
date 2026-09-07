import type { DragEndEvent } from "@dnd-kit/core";

export type WorkbenchDragData = {
  taskId: string;
  sourceStudentId: string;
  sourceDate: string;
  version: number;
  locked: boolean;
  carriedOver: boolean;
  trackId: string | null;
  sourceType: string;
  title: string;
};

export type WorkbenchDropData = {
  targetStudentId: string;
  targetDate: string;
  available: boolean;
};

export type WorkbenchRescheduleInput = {
  taskId: string;
  version: number;
  targetDate: string;
  targetStudentId: string;
};

/** refuse 要给出理由：拒绝换人的拖拽必须让助教看到原因，否则像卡住了。 */
export type WorkbenchDropOutcome =
  | { kind: "reschedule"; input: WorkbenchRescheduleInput }
  | { kind: "ignore" }
  | { kind: "refuse"; reason: string };

export function resolveWorkbenchDrop({
  active,
  over,
}: DragEndEvent): WorkbenchDropOutcome {
  if (!over) return { kind: "ignore" };
  const dragData = active.data.current as WorkbenchDragData | undefined;
  const dropData = over.data.current as WorkbenchDropData | undefined;
  if (!dragData || !dropData) return { kind: "ignore" };
  if (dragData.locked || dragData.carriedOver) return { kind: "ignore" };
  const crossStudent = dragData.sourceStudentId !== dropData.targetStudentId;
  if (!crossStudent && dragData.sourceDate === dropData.targetDate) {
    return { kind: "ignore" };
  }
  // 轨道跟着原学生：跨学生只能换临时任务，长期任务这一条实例不能搬走。
  if (crossStudent && (dragData.trackId || dragData.sourceType === "TRACK")) {
    return {
      kind: "refuse",
      reason: `「${dragData.title}」是长期任务，只能在同一个学生里改期`,
    };
  }
  return {
    kind: "reschedule",
    input: {
      taskId: dragData.taskId,
      version: dragData.version,
      targetDate: dropData.targetDate,
      targetStudentId: dropData.targetStudentId,
    },
  };
}
