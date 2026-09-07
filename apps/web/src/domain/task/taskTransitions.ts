import {
  findNextAvailableStudyDate,
  resolveStudyAvailability,
  type AvailabilityCalendar,
  type EffectiveStudyAvailability,
} from "../scheduling/availability";

export type LocalTaskStatus =
  "PENDING" | "COMPLETED" | "CARRIED_OVER" | "BLOCKED" | "CANCELLED";

export interface TaskInstanceSnapshot {
  id: string;
  studentId: string;
  title: string;
  scheduledDate: string;
  status: LocalTaskStatus;
  version: number;
  locked: boolean;
  requiresDevice?: boolean;
  trackId?: string | null;
  itemOrdinal?: number | null;
  scheduleOrigin?: "TRACK" | "AD_HOC" | "IMPORT" | "MANUAL" | "CARRYOVER";
  manualOverride?: boolean;
  overrideReason?: string | null;
  carriedFromInstanceId?: string | null;
  carriedToInstanceId?: string | null;
}

export interface TrackSnapshot {
  currentOrdinal: number;
  /** 开放型长期任务（SEQUENCE 无结束序号）为 null：指针只前进，永不自动完成。 */
  endOrdinal: number | null;
  completedOrdinals: readonly number[];
}

export class TaskTransitionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function completeTask(
  task: TaskInstanceSnapshot,
  track?: TrackSnapshot,
  idempotencyKey?: string,
): { task: TaskInstanceSnapshot; track?: TrackSnapshot; changed: boolean } {
  if (task.status === "COMPLETED" && idempotencyKey?.trim()) {
    return { task, track, changed: false };
  }
  if (task.status !== "PENDING") {
    throw new TaskTransitionError(
      "TASK_NOT_COMPLETABLE",
      "Only pending tasks can be completed",
    );
  }

  const completedTask = {
    ...task,
    status: "COMPLETED" as const,
    version: task.version + 1,
  };
  if (!track || task.itemOrdinal == null) {
    return { task: completedTask, track, changed: true };
  }
  const completed = new Set(track.completedOrdinals);
  completed.add(task.itemOrdinal);
  let currentOrdinal = track.currentOrdinal;
  // 指针推进到第一个未完成序号。有限型在 endOrdinal 处封顶（越过即视为轨道
  // 完成，由持久层落 COMPLETED）；开放型没有上界，永远推进。
  while (
    (track.endOrdinal == null || currentOrdinal <= track.endOrdinal) &&
    completed.has(currentOrdinal)
  ) {
    currentOrdinal += 1;
  }
  return {
    task: completedTask,
    track: {
      ...track,
      currentOrdinal,
      completedOrdinals: [...completed].sort((left, right) => left - right),
    },
    changed: true,
  };
}

export function reopenTask(
  task: TaskInstanceSnapshot,
  track?: TrackSnapshot,
): { task: TaskInstanceSnapshot; track?: TrackSnapshot } {
  if (task.status !== "COMPLETED") {
    throw new TaskTransitionError(
      "TASK_NOT_COMPLETED",
      "Only completed tasks can be reopened",
    );
  }
  if (
    track &&
    task.itemOrdinal != null &&
    track.currentOrdinal > task.itemOrdinal
  ) {
    throw new TaskTransitionError(
      "TASK_REOPEN_REQUIRES_CORRECTION",
      "Later track items have already advanced",
    );
  }

  const reopened = {
    ...task,
    status: "PENDING" as const,
    version: task.version + 1,
  };
  if (!track || task.itemOrdinal == null) return { task: reopened, track };
  return {
    task: reopened,
    track: {
      ...track,
      currentOrdinal: Math.min(track.currentOrdinal, task.itemOrdinal),
      completedOrdinals: track.completedOrdinals.filter(
        (ordinal) => ordinal !== task.itemOrdinal,
      ),
    },
  };
}

/**
 * 改期是本产品里唯一的"换日期"命令，Calendar 拖拽、矩阵拖拽、右键菜单和
 * RescheduleModal 都走这里。
 *
 * 产品规则（2026-08-20 按用户反馈调整）：改期是一次直接生效的操作，不做二次确认。
 * 目标日不是学习日、或设备策略不匹配时，不再拒绝用户，而是照做并记下 override
 * 原因，让排期历史仍可解释。只有两类情况真正拒绝：显式锁定的任务，以及已经是
 * 历史记录的行（顺延来源、已取消）。改期从不改变完成状态（COMPLETED 保持
 * COMPLETED），也从不推进 Track；唯一的例外是 BLOCKED——改期是 PRD §7.1 里
 * BLOCKED 的唯一出口（人工重新安排），落到目标日期即解除阻塞回到 PENDING。
 *
 * `targetStudentId` 省略即不换学生。跨学生移动时，任务会脱离原 Track，转成独立
 * 临时任务；原 Track 指针不推进也不回退，避免把一个学生的轨道实例挂到另一个学生。
 * 持久层同时清空 parent_task_id / linked_parent_task_id（见 adapter 的
 * rescheduleTask），父子关系同样不跨学生携带。
 */
export function rescheduleTask(input: {
  task: TaskInstanceSnapshot;
  targetDate: string;
  calendar: AvailabilityCalendar;
  overrideReason?: string;
  targetStudentId?: string;
}): TaskInstanceSnapshot {
  const { task, targetDate, calendar } = input;
  if (task.locked) {
    throw new TaskTransitionError("TASK_LOCKED", "Locked tasks cannot move");
  }
  if (task.status === "CARRIED_OVER" || task.status === "CANCELLED") {
    throw new TaskTransitionError(
      "TASK_NOT_RESCHEDULABLE",
      "History rows cannot be rescheduled",
    );
  }

  const targetStudentId = input.targetStudentId ?? task.studentId;
  const crossStudent = targetStudentId !== task.studentId;
  // 轨道属于原学生：换人只能在新学生身上另起长期任务，不能把这条实例搬过去。
  if (crossStudent && task.trackId) {
    throw new TaskTransitionError(
      "TRACK_TASK_CROSS_STUDENT",
      "长期任务不能移动到其他学生",
    );
  }

  const availability = resolveStudyAvailability(calendar, targetDate);
  const reasons: string[] = [];
  if (!availability.available) {
    reasons.push(`非学习日 ${targetDate}`);
  }
  if (task.requiresDevice && availability.devicePolicy !== "ALLOWED") {
    reasons.push("目标日设备不可用");
  }
  const autoReason =
    reasons.length > 0 ? `手动放置：${reasons.join("；")}` : null;

  return {
    ...task,
    status: task.status === "BLOCKED" ? "PENDING" : task.status,
    studentId: targetStudentId,
    trackId: crossStudent ? null : task.trackId,
    itemOrdinal: crossStudent ? null : task.itemOrdinal,
    scheduledDate: targetDate,
    scheduleOrigin: crossStudent ? "AD_HOC" : "MANUAL",
    manualOverride: true,
    overrideReason: input.overrideReason ?? autoReason,
    version: task.version + 1,
  };
}

export interface CarryForwardPreview {
  targetDate: string;
  availabilitySource: "WEEKLY_PATTERN" | "DATE_OVERRIDE" | "DEFAULT";
  availableMinutes: number;
}

/**
 * 顺延选日助手：previewCarryForward 与 carryForwardTask 共用的落点决策。
 * 显式 targetDate 优先于自动扫描（预览侧可通过 horizonDays 自定义扫描窗口，
 * 执行侧固定 90 天）。返回 null 表示"这个顺延不会产生有效目标"——要么窗口
 * 内没有可学日，要么显式日期不满足学习日/设备谓词。调用方自行决定把 null
 * 映射成什么：预览返回 null，执行转 BLOCKED。
 */
function resolveCarryForwardTarget(input: {
  source: TaskInstanceSnapshot;
  calendar: AvailabilityCalendar;
  targetDate?: string | null;
  notBeforeDate?: string | null;
  horizonDays?: number;
}): { targetDate: string; availability: EffectiveStudyAvailability } | null {
  // 补日结时源日期可能已经过去好几天，从业务日往后找才不会又落进过去。
  const afterDate =
    input.notBeforeDate && input.notBeforeDate > input.source.scheduledDate
      ? input.notBeforeDate
      : input.source.scheduledDate;
  const targetDate =
    input.targetDate ??
    findNextAvailableStudyDate({
      calendar: input.calendar,
      afterDate,
      requiresDevice: input.source.requiresDevice,
      horizonDays: input.horizonDays ?? 90,
    });
  if (!targetDate) return null;
  const availability = resolveStudyAvailability(input.calendar, targetDate);
  if (
    !availability.available ||
    (input.source.requiresDevice && availability.devicePolicy !== "ALLOWED")
  ) {
    return null;
  }
  return { targetDate, availability };
}

/**
 * 顺延预览：确认前展示"会落到哪天"。与 carryForwardTask 共用同一套选日与
 * 可用性规则（resolveCarryForwardTarget），但纯计算——不改源状态、不产生
 * BLOCKED 副作用。显式 targetDate 优先于自动扫描；扫描范围内没有可学日、
 * 或显式日期不满足学习日/设备规则时返回 null（表示"这个顺延不会产生有效
 * 目标"，而不是"落到某天"）。
 */
export function previewCarryForward(input: {
  source: TaskInstanceSnapshot;
  calendar: AvailabilityCalendar;
  targetDate?: string | null;
  horizonDays?: number;
}): CarryForwardPreview | null {
  const resolved = resolveCarryForwardTarget(input);
  if (!resolved) return null;
  return {
    targetDate: resolved.targetDate,
    availabilitySource: resolved.availability.source,
    availableMinutes: resolved.availability.availableMinutes,
  };
}

export function carryForwardTask(input: {
  source: TaskInstanceSnapshot;
  newTaskId: string;
  calendar: AvailabilityCalendar;
  targetDate?: string;
  notBeforeDate?: string;
  reason?: string;
  existingTarget?: TaskInstanceSnapshot;
}): {
  source: TaskInstanceSnapshot;
  target: TaskInstanceSnapshot | null;
  changed: boolean;
} {
  const { source } = input;
  if (source.status !== "PENDING" || source.locked) {
    return { source, target: null, changed: false };
  }
  const resolved = resolveCarryForwardTarget(input);
  if (!resolved) {
    return {
      source: { ...source, status: "BLOCKED", version: source.version + 1 },
      target: null,
      changed: true,
    };
  }
  const { targetDate } = resolved;

  // DLY-018：只要同源（同学生/track/ordinal）PENDING 目标存在就原样复用，
  // 不要求日期一致——否则旧目标被改期后再次顺延会生成第二个有效 target。
  const existing = input.existingTarget;
  const target =
    existing &&
    existing.studentId === source.studentId &&
    existing.trackId === source.trackId &&
    existing.itemOrdinal === source.itemOrdinal &&
    existing.status === "PENDING"
      ? existing
      : {
          ...source,
          id: input.newTaskId,
          scheduledDate: targetDate,
          status: "PENDING" as const,
          version: 0,
          scheduleOrigin: "CARRYOVER" as const,
          manualOverride: true,
          overrideReason: input.reason ?? null,
          carriedFromInstanceId: source.id,
          carriedToInstanceId: null,
        };
  return {
    source: {
      ...source,
      status: "CARRIED_OVER",
      version: source.version + 1,
      carriedToInstanceId: target.id,
    },
    target: { ...target, carriedFromInstanceId: source.id },
    changed: existing !== target,
  };
}
