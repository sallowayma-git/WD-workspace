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

export function getWorkbenchRescheduleInput({
  active,
  over,
}: DragEndEvent): WorkbenchRescheduleInput | null {
  if (!over) return null;
  const dragData = active.data.current as WorkbenchDragData | undefined;
  const dropData = over.data.current as WorkbenchDropData | undefined;
  if (!dragData || !dropData) return null;
  if (
    dragData.locked ||
    dragData.carriedOver ||
    (dragData.sourceStudentId === dropData.targetStudentId &&
      dragData.sourceDate === dropData.targetDate)
  ) {
    return null;
  }
  return {
    taskId: dragData.taskId,
    version: dragData.version,
    targetDate: dropData.targetDate,
    targetStudentId: dropData.targetStudentId,
  };
}
