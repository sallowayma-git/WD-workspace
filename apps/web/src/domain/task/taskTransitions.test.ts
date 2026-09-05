import { describe, expect, it } from "vitest";
import type { AvailabilityCalendar } from "../scheduling/availability";
import { findNextAvailableStudyDate } from "../scheduling/availability";
import {
  TaskTransitionError,
  carryForwardTask,
  completeTask,
  previewCarryForward,
  reopenTask,
  rescheduleTask,
  type TaskInstanceSnapshot,
} from "./taskTransitions";

const calendar: AvailabilityCalendar = {
  defaultDevicePolicy: "CONFIRM",
  weekly: [
    { dayOfWeek: 1, enabled: true, availableMinutes: 120 },
    { dayOfWeek: 2, enabled: false, availableMinutes: 0 },
    { dayOfWeek: 3, enabled: true, availableMinutes: 90 },
    { dayOfWeek: 4, enabled: true, availableMinutes: 90 },
    { dayOfWeek: 5, enabled: true, availableMinutes: 90 },
    { dayOfWeek: 6, enabled: false, availableMinutes: 0 },
    { dayOfWeek: 7, enabled: false, availableMinutes: 0 },
  ],
  overrides: [
    { date: "2026-08-19", available: false },
    {
      date: "2026-08-20",
      available: true,
      availableMinutes: 60,
      devicePolicy: "ALLOWED",
    },
  ],
};

const task: TaskInstanceSnapshot = {
  id: "task-1",
  studentId: "student-1",
  title: "密卷 08",
  scheduledDate: "2026-08-17",
  status: "PENDING",
  version: 2,
  locked: false,
  trackId: "track-1",
  itemOrdinal: 8,
};

describe("TypeScript execution parity", () => {
  it("gives date overrides precedence and scans within a bounded horizon", () => {
    expect(
      findNextAvailableStudyDate({
        calendar,
        afterDate: "2026-08-17",
        horizonDays: 3,
      }),
    ).toBe("2026-08-20");
    expect(
      findNextAvailableStudyDate({
        calendar,
        afterDate: "2026-08-17",
        horizonDays: 2,
      }),
    ).toBeNull();
  });

  it("skips a closed Thursday and lands on an open Friday", () => {
    expect(
      findNextAvailableStudyDate({
        calendar: {
          defaultDevicePolicy: "ALLOWED",
          weekly: [
            { dayOfWeek: 4, enabled: false, availableMinutes: 0 },
            { dayOfWeek: 5, enabled: true, availableMinutes: 90 },
          ],
        },
        afterDate: "2026-08-19",
      }),
    ).toBe("2026-08-21");
  });

  it("lets a closed-date override skip an otherwise open Friday", () => {
    expect(
      findNextAvailableStudyDate({
        calendar: {
          defaultDevicePolicy: "ALLOWED",
          weekly: calendar.weekly,
          overrides: [{ date: "2026-08-21", available: false }],
        },
        afterDate: "2026-08-20",
      }),
    ).toBe("2026-08-24");
  });

  it("lets an open-date override enable an otherwise closed Sunday", () => {
    expect(
      findNextAvailableStudyDate({
        calendar: {
          defaultDevicePolicy: "ALLOWED",
          weekly: calendar.weekly,
          overrides: [
            {
              date: "2026-08-23",
              available: true,
              availableMinutes: 120,
            },
          ],
        },
        afterDate: "2026-08-21",
      }),
    ).toBe("2026-08-23");
  });

  it("advances only a continuous completed track prefix", () => {
    const result = completeTask(task, {
      currentOrdinal: 8,
      endOrdinal: 10,
      completedOrdinals: [9],
    });
    expect(result.task.status).toBe("COMPLETED");
    expect(result.track?.currentOrdinal).toBe(10);
  });

  it("treats repeated keyed completion as an idempotent no-op", () => {
    const completed = { ...task, status: "COMPLETED" as const };
    expect(completeTask(completed, undefined, "complete:task-1").changed).toBe(
      false,
    );
  });

  it("rejects reopening after the track has advanced beyond the item", () => {
    expect(() =>
      reopenTask(
        { ...task, status: "COMPLETED" },
        { currentOrdinal: 9, endOrdinal: 10, completedOrdinals: [8] },
      ),
    ).toThrowError(TaskTransitionError);
  });

  it("carries the current snapshot and preserves bidirectional lineage", () => {
    const result = carryForwardTask({
      source: task,
      newTaskId: "task-2",
      calendar,
      reason: "未完成",
    });
    expect(result.source).toMatchObject({
      status: "CARRIED_OVER",
      carriedToInstanceId: "task-2",
      itemOrdinal: 8,
    });
    expect(result.target).toMatchObject({
      id: "task-2",
      title: "密卷 08",
      status: "PENDING",
      scheduledDate: "2026-08-20",
      carriedFromInstanceId: "task-1",
      itemOrdinal: 8,
    });
  });

  it("reuses an existing target instead of duplicating it", () => {
    const existing = {
      ...task,
      id: "task-existing",
      scheduledDate: "2026-08-20",
      carriedFromInstanceId: task.id,
    };
    const result = carryForwardTask({
      source: task,
      newTaskId: "task-new",
      calendar,
      targetDate: "2026-08-20",
      existingTarget: existing,
    });
    expect(result.target?.id).toBe("task-existing");
  });

  it("reuses an existing PENDING target even when its date no longer matches (DLY-018)", () => {
    const existing = {
      ...task,
      id: "task-existing",
      scheduledDate: "2026-08-25",
      carriedFromInstanceId: task.id,
    };
    const result = carryForwardTask({
      source: task,
      newTaskId: "task-new",
      calendar,
      existingTarget: existing,
    });
    expect(result.target?.id).toBe("task-existing");
    expect(result.target?.scheduledDate).toBe("2026-08-25");
    expect(result.source.carriedToInstanceId).toBe("task-existing");
    expect(result.changed).toBe(false);
  });

  it("does not reuse a COMPLETED existing target and creates a new one instead", () => {
    // 负向断言：existing 匹配谓词要求 status === "PENDING"，完成态目标不算
    // 有效顺延落点，必须走新建分支。
    const completedTarget = {
      ...task,
      id: "task-completed-target",
      scheduledDate: "2026-08-20",
      status: "COMPLETED" as const,
      carriedFromInstanceId: task.id,
    };
    const result = carryForwardTask({
      source: task,
      newTaskId: "task-new",
      calendar,
      targetDate: "2026-08-20",
      existingTarget: completedTarget,
    });
    expect(result.changed).toBe(true);
    expect(result.target?.id).toBe("task-new");
    expect(result.target?.status).toBe("PENDING");
    expect(result.target?.scheduledDate).toBe("2026-08-20");
    expect(result.source.carriedToInstanceId).toBe("task-new");
  });

  it("carries a Friday task over the closed weekend to Monday (T02)", () => {
    const result = carryForwardTask({
      source: { ...task, scheduledDate: "2026-08-21" },
      newTaskId: "task-2",
      calendar,
    });
    expect(result.source).toMatchObject({
      status: "CARRIED_OVER",
      carriedToInstanceId: "task-2",
    });
    expect(result.target).toMatchObject({
      id: "task-2",
      status: "PENDING",
      scheduledDate: "2026-08-24",
      scheduleOrigin: "CARRYOVER",
      itemOrdinal: 8,
    });
    expect(result.changed).toBe(true);
  });

  it("leaves a locked source untouched (T05)", () => {
    const source = { ...task, locked: true };
    const result = carryForwardTask({ source, newTaskId: "task-2", calendar });
    expect(result.changed).toBe(false);
    expect(result.target).toBeNull();
    expect(result.source.status).toBe("PENDING");
    expect(result.source.version).toBe(task.version);
  });

  it("leaves a completed source untouched (T06)", () => {
    const source = { ...task, status: "COMPLETED" as const };
    const result = carryForwardTask({ source, newTaskId: "task-2", calendar });
    expect(result.changed).toBe(false);
    expect(result.target).toBeNull();
    expect(result.source.status).toBe("COMPLETED");
    expect(result.source.version).toBe(task.version);
  });

  it("previews the next available landing date without side effects", () => {
    const preview = previewCarryForward({ source: task, calendar });
    expect(preview).toEqual({
      targetDate: "2026-08-20",
      availabilitySource: "DATE_OVERRIDE",
      availableMinutes: 60,
    });
  });

  it("returns null when no study day fits within the horizon", () => {
    const unavailable: AvailabilityCalendar = {
      defaultDevicePolicy: "NOT_ALLOWED",
      weekly: calendar.weekly.map((day) => ({ ...day, enabled: false })),
    };
    expect(
      previewCarryForward({
        source: task,
        calendar: unavailable,
        horizonDays: 7,
      }),
    ).toBeNull();
  });

  it("gives an explicit target date and date overrides precedence in the preview", () => {
    expect(
      previewCarryForward({ source: task, calendar, targetDate: "2026-08-20" }),
    ).toEqual({
      targetDate: "2026-08-20",
      availabilitySource: "DATE_OVERRIDE",
      availableMinutes: 60,
    });
    // 周五本可学但被 override 关闭，周日本不可学但被 override 打开——落点必须越过周五。
    expect(
      previewCarryForward({
        source: { ...task, scheduledDate: "2026-08-20" },
        calendar: {
          ...calendar,
          overrides: [
            { date: "2026-08-21", available: false },
            { date: "2026-08-23", available: true, availableMinutes: 120 },
          ],
        },
      }),
    ).toEqual({
      targetDate: "2026-08-23",
      availabilitySource: "DATE_OVERRIDE",
      availableMinutes: 120,
    });
  });

  it("returns null from the preview for an explicit non-study day (override closed)", () => {
    // 2026-08-19（周三）周模式本可学，但被 date override 显式关闭。
    expect(
      previewCarryForward({
        source: task,
        calendar,
        targetDate: "2026-08-19",
      }),
    ).toBeNull();
  });

  it("returns null from the preview when the explicit day's device policy blocks the task", () => {
    // 2026-08-24（周一）可学但设备策略回落 default CONFIRM ≠ ALLOWED，
    // requiresDevice 任务显式指向该日时预览必须拒绝，而不是给出落点。
    expect(
      previewCarryForward({
        source: { ...task, requiresDevice: true },
        calendar,
        targetDate: "2026-08-24",
      }),
    ).toBeNull();
  });

  it("blocks carry-forward when no valid date exists", () => {
    const unavailable: AvailabilityCalendar = {
      defaultDevicePolicy: "NOT_ALLOWED",
      weekly: calendar.weekly.map((day) => ({ ...day, enabled: false })),
    };
    const result = carryForwardTask({
      source: task,
      newTaskId: "task-2",
      calendar: unavailable,
    });
    expect(result.source.status).toBe("BLOCKED");
    expect(result.target).toBeNull();
  });

  it("reschedules without changing the track ordinal", () => {
    const result = rescheduleTask({
      task,
      targetDate: "2026-08-20",
      calendar,
      overrideReason: "家长确认",
    });
    expect(result).toMatchObject({
      scheduledDate: "2026-08-20",
      itemOrdinal: 8,
      scheduleOrigin: "MANUAL",
      manualOverride: true,
      version: 3,
    });
  });

  it("rejects moving a locked task", () => {
    expect(() =>
      rescheduleTask({
        task: { ...task, locked: true },
        targetDate: "2026-08-20",
        calendar,
      }),
    ).toThrowError("Locked tasks cannot move");
  });

  it("records why a move landed on a day that does not fit, instead of refusing", () => {
    // 产品规则：改期一次生效，不做二次确认。设备不可用或目标日不是学习日时照做，
    // 但把原因写进 override_reason，让排期历史仍然解释得通。
    const moved = rescheduleTask({
      task: { ...task, requiresDevice: true },
      targetDate: "2026-08-21",
      calendar,
    });
    expect(moved.scheduledDate).toBe("2026-08-21");
    expect(moved.manualOverride).toBe(true);
    expect(moved.overrideReason).toContain("设备");
  });

  it("keeps the completion status when a finished task is moved", () => {
    const moved = rescheduleTask({
      task: { ...task, status: "COMPLETED" },
      targetDate: "2026-08-20",
      calendar,
    });
    expect(moved.status).toBe("COMPLETED");
    expect(moved.scheduledDate).toBe("2026-08-20");
  });

  it("refuses to move a carried-over source row", () => {
    expect(() =>
      rescheduleTask({
        task: { ...task, status: "CARRIED_OVER" },
        targetDate: "2026-08-20",
        calendar,
      }),
    ).toThrowError("History rows cannot be rescheduled");
  });

  it("unblocks a BLOCKED task by rescheduling it back to PENDING", () => {
    // PRD §7.1: BLOCKED → PENDING（人工重新安排）是阻塞任务唯一的出口。
    // 改期本身就是"重新安排"，落点即解除阻塞；否则 BLOCKED 是单向终止
    // 状态，任务永远无法完成。
    const moved = rescheduleTask({
      task: { ...task, status: "BLOCKED" },
      targetDate: "2026-08-20",
      calendar,
    });
    expect(moved.status).toBe("PENDING");
    expect(moved.scheduledDate).toBe("2026-08-20");
  });

  it("still refuses to move a BLOCKED task that is locked", () => {
    expect(() =>
      rescheduleTask({
        task: { ...task, status: "BLOCKED", locked: true },
        targetDate: "2026-08-20",
        calendar,
      }),
    ).toThrowError("Locked tasks cannot move");
  });

  it("rejects calendar-impossible target dates instead of rolling them over", () => {
    // 2026 非闰年：JS Date 会把 2026-02-29 静默进位成 2026-03-01，把
    // 02-31 进位成 03-03。round-trip 校验必须在 domain 层就把它们拒掉。
    for (const badDate of ["2026-02-31", "2026-02-29", "2026-13-01"]) {
      expect(() =>
        rescheduleTask({
          task,
          targetDate: badDate,
          calendar,
        }),
      ).toThrowError(`Invalid business date: ${badDate}`);
    }
  });

  it("moves any live task to another student and detaches it from its track", () => {
    const trackTask = rescheduleTask({
      task: { ...task, trackId: "track-1", scheduleOrigin: "TRACK" },
      targetDate: "2026-08-20",
      targetStudentId: "student-2",
      calendar,
    });
    expect(trackTask).toMatchObject({
      studentId: "student-2",
      scheduledDate: "2026-08-20",
      trackId: null,
      itemOrdinal: null,
      scheduleOrigin: "AD_HOC",
    });

    const moved = rescheduleTask({
      task: {
        ...task,
        trackId: null,
        itemOrdinal: null,
        scheduleOrigin: "AD_HOC",
      },
      targetDate: "2026-08-20",
      targetStudentId: "student-2",
      calendar,
    });
    expect(moved.studentId).toBe("student-2");
    expect(moved.scheduledDate).toBe("2026-08-20");
  });
});
