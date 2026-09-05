export type TaskCalendarStatus =
  "PENDING" | "COMPLETED" | "CARRIED_OVER" | "BLOCKED" | "CANCELLED";

export type CalendarView = "day" | "week" | "month";

// 契约示意，无运行时消费方（INT-CAL-002 superseded）；勿据此重建第二层事件适配模型（DoD #6）。
export interface TaskCalendarEvent {
  id: string;
  taskId: string;
  studentId: string;
  title: string;
  shortTitle?: string | null;
  scheduledDate: string;
  status: TaskCalendarStatus;
  locked: boolean;
  trackId?: string | null;
  itemOrdinal?: number | null;
}

export interface MoveCalendarEventInput {
  event: TaskCalendarEvent;
  targetDate: string;
}

/**
 * The single move guard shared by every date-change entry point (calendar drag,
 * matrix drag, context menu, RescheduleModal). Takes a structural subset so a
 * `ScheduleTask` or a `TaskCalendarEvent` can both be checked without building
 * a second event model (task book DoD #6).
 */
export function canMoveCalendarEvent(
  event: { locked: boolean; scheduledDate: string },
  targetDate: string,
): boolean {
  return !event.locked && event.scheduledDate !== targetDate;
}
