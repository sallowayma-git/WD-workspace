import {
  ArrowLeftOutlined,
  LockOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Popover,
  Skeleton,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { ApiError } from "../../lib/api/ApiError";
import { useBusinessDate } from "../foundation/useBusinessDate";
import { TaskCard } from "../tasks/TaskCard";
import {
  TaskDetailDrawer,
  type TaskDetailTarget,
} from "../tasks/TaskDetailDrawer";
import { invalidateTaskViews, taskActions } from "../tasks/taskActions";
import { useSeriesSuggestion } from "../tasks/useSeriesSuggestion";
import {
  createNextSeriesTask,
  deleteTask,
  duplicateTask,
  updateTask,
  type Priority,
  type TaskLike,
} from "../tasks/taskApi";
import { parseSeriesTitleCandidates } from "../../domain/task/seriesTitle";
import { InlineTaskComposer } from "../today/InlineTaskComposer";
import { convertTaskToLongTask } from "../longtasks/longTaskApi";
import {
  getSchedule,
  type ScheduleDay,
  type ScheduleResponse,
  type ScheduleTask,
} from "./scheduleApi";
import { MonthView } from "../../vendor/flowclass/calendar/MonthView";
import { canMoveCalendarEvent } from "../../vendor/flowclass/calendar/types";
import { parseDate, shiftDate } from "../../data/local/dates";

const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
// Monday-first header order for the week/month calendar grids. The backend
// returns days in date order; the grid renders them in columns labelled with
// these short names.
const weekHeaderNames = ["一", "二", "三", "四", "五", "六", "日"];
// Maximum number of TaskCards rendered inside a single calendar cell before
// collapsing the rest behind a "+N more" indicator.
const MAX_TASKS_PER_CELL = 10;

/** Returns the 0-based column index (Mon=0 .. Sun=6) for a YYYY-MM-DD date. */
function gridColumnIndex(date: string): number {
  const d = parseDate(date);
  // JS getDay(): Sun=0..Sat=6. Convert to Monday-first (Sun -> 6).
  return (d.getDay() + 6) % 7;
}

/**
 * Adapts a ScheduleTask into the shared TaskCard TaskLike contract. D2 fields
 * (parentTaskId / linkedParentTaskId / priority / sortOrder / star) are now
 * surfaced on the schedule schema, so they pass through instead of being
 * hardcoded to defaults. carriedFromDate (DLY-022) feeds the 顺延 tooltip.
 * When the adapter omits an optional field it stays undefined/null and the
 * card degrades gracefully.
 */
function toTaskLike(task: ScheduleTask): TaskLike {
  return {
    id: task.id,
    title: task.title,
    shortTitle: task.shortTitle,
    status: task.status,
    sourceType: task.sourceType,
    itemOrdinal: task.itemOrdinal,
    durationMinutes: task.durationMinutes,
    locked: task.locked,
    carriedOver: task.carriedOver ?? false,
    carriedFromDate: task.carriedFromDate ?? null,
    version: task.version,
    parentTaskId: task.parentTaskId ?? null,
    linkedParentTaskId: task.linkedParentTaskId ?? null,
    priority: task.priority ?? null,
    sortOrder: task.sortOrder ?? null,
    star: task.star ?? false,
  };
}

interface DragData {
  taskId: string;
  studentId: string;
  version: number;
  locked: boolean;
  sourceDate: string;
  title: string;
}

interface DropData {
  date: string;
  available: boolean;
}

// AC-008: capture enough context after a drag/move to offer a one-click
// "undo" that reschedules the task back to its original date.
interface UndoContext {
  taskId: string;
  originalDate: string;
  targetDate: string;
  title: string;
}

// AC-008: read the latest version of a task from the schedule query cache
// so the undo reschedule can pass an up-to-date expectedVersion. The
// backend reschedule endpoint does not return the new version, so we rely
// on the invalidated query snapshot. Returns null if the task is not
// present in any cached day (e.g. it scrolled out of the visible range).
function readTaskVersion(
  queryClient: QueryClient,
  studentId: string,
  taskId: string,
): number | null {
  const queries = queryClient.getQueriesData<ScheduleResponse>({
    queryKey: ["schedule", studentId],
  });
  for (const [, data] of queries) {
    if (!data) continue;
    for (const day of data.days) {
      const found = day.tasks.find((t) => t.id === taskId);
      if (found) return found.version;
    }
  }
  return null;
}

export function StudentSchedulePage() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { offerSeriesSuggestion } = useSeriesSuggestion();
  // All schedule views use the same local machine calendar date.
  const today = useBusinessDate();
  const [searchParams, setSearchParams] = useSearchParams();
  const view =
    z.enum(["day", "week", "month"]).safeParse(searchParams.get("view")).data ??
    "week";
  const selectedDate =
    z.iso.date().safeParse(searchParams.get("date")).data ?? today;
  const setView = (nextView: "day" | "week" | "month") => {
    const next = new URLSearchParams(searchParams);
    next.set("date", selectedDate);
    next.set("view", nextView);
    setSearchParams(next, { replace: true });
  };
  const setSelectedDate = (date: string) => {
    if (!z.iso.date().safeParse(date).success) return;
    const next = new URLSearchParams(searchParams);
    next.set("date", date);
    next.set("view", view);
    setSearchParams(next, { replace: true });
  };
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);
  // AC-008: keep the last undo context around so the "撤销本次拖拽" toast
  // button can reschedule the task back to its original date.
  const undoRef = useRef<UndoContext | null>(null);
  // MAJOR-5: read-only detail drawer. ScheduleTask rows are day-scoped (no
  // scheduledDate column of their own), so DraggableTaskItem injects the
  // cell's date before the target reaches this state.
  const [detailTarget, setDetailTarget] = useState<TaskDetailTarget | null>(
    null,
  );

  const scheduleQuery = useQuery({
    queryKey: ["schedule", studentId, view, selectedDate],
    queryFn: () =>
      getSchedule(studentId as string, { from: selectedDate, view }),
    enabled: Boolean(studentId),
    retry: false,
  });

  const completeMutation = useMutation({
    mutationFn: (params: { taskId: string; version: number }) =>
      taskActions.complete(params.taskId, params.version, crypto.randomUUID()),
    onMutate: async (params) => {
      // Optimistic update: flip the task to COMPLETED in every cached
      // schedule window immediately so the checkbox reflects the click
      // before the server responds (mirrors TodayPage's pattern).
      await queryClient.cancelQueries({
        queryKey: ["schedule", studentId],
      });
      const snapshots = queryClient.getQueriesData<ScheduleResponse>({
        queryKey: ["schedule", studentId],
      });
      queryClient.setQueriesData<ScheduleResponse | undefined>(
        { queryKey: ["schedule", studentId] },
        (prev) =>
          prev
            ? {
                ...prev,
                days: prev.days.map((day) => ({
                  ...day,
                  tasks: day.tasks.map((task) =>
                    task.id === params.taskId
                      ? {
                          ...task,
                          status: "COMPLETED",
                          version: task.version + 1,
                        }
                      : task,
                  ),
                })),
              }
            : prev,
      );
      return { snapshots };
    },
    onError: (_error, _params, context) => {
      // Roll back to the pre-mutation snapshots if the server rejects.
      if (context?.snapshots) {
        for (const [key, data] of context.snapshots) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSuccess: (result) => {
      // 任务已完成，只是轨道没接上下一项：警告而不是报错。
      if (result.chainWarning) void message.warning(result.chainWarning);
    },
    onSettled: () => {
      void invalidateTaskViews(queryClient);
    },
  });

  const reopenMutation = useMutation({
    mutationFn: (params: { taskId: string; version: number }) =>
      taskActions.reopen(params.taskId, params.version, crypto.randomUUID()),
    onMutate: async (params) => {
      // Optimistic update: flip the task back to PENDING immediately so
      // the checkbox unchecks without waiting for the server.
      await queryClient.cancelQueries({
        queryKey: ["schedule", studentId],
      });
      const snapshots = queryClient.getQueriesData<ScheduleResponse>({
        queryKey: ["schedule", studentId],
      });
      queryClient.setQueriesData<ScheduleResponse | undefined>(
        { queryKey: ["schedule", studentId] },
        (prev) =>
          prev
            ? {
                ...prev,
                days: prev.days.map((day) => ({
                  ...day,
                  tasks: day.tasks.map((task) =>
                    task.id === params.taskId
                      ? {
                          ...task,
                          status: "PENDING",
                          version: task.version + 1,
                        }
                      : task,
                  ),
                })),
              }
            : prev,
      );
      return { snapshots };
    },
    onError: (_error, _params, context) => {
      if (context?.snapshots) {
        for (const [key, data] of context.snapshots) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      void invalidateTaskViews(queryClient);
    },
  });

  const carryForwardMutation = useMutation({
    mutationFn: (task: TaskLike) =>
      taskActions.carryForward(task.id, undefined, "MANUAL_CARRYOVER"),
    onSuccess: (result) => {
      if (result.status === "BLOCKED") {
        void message.warning(result.reason ?? "90 天内没有可用学习日");
        return;
      }
      void message.success(
        result.targetDate
          ? `已顺延至 ${result.targetDate}`
          : "任务无需重复顺延",
      );
    },
    onError: (error) => {
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "顺延任务失败，请稍后重试",
      );
    },
    onSettled: () => {
      void invalidateTaskViews(queryClient);
    },
  });

  // D2: shared TaskCard callbacks. These mutations invalidate the schedule
  // windows on settle so the list reflects the latest local database state.
  const deleteTaskMutation = useMutation({
    mutationFn: (task: TaskLike) => deleteTask(task.id, task.version),
    onSuccess: () => {
      void message.success("已删除任务");
    },
    onError: (error) => {
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "删除任务失败，请稍后重试",
      );
    },
    onSettled: () => {
      void invalidateTaskViews(queryClient);
    },
  });

  const duplicateTaskMutation = useMutation({
    mutationFn: (task: TaskLike) =>
      duplicateTask(task.id, { expectedVersion: task.version }),
    onSuccess: () => {
      void message.success("已复制任务");
    },
    onError: (error) => {
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "复制任务失败，请稍后重试",
      );
    },
    onSettled: () => {
      void invalidateTaskViews(queryClient);
    },
  });

  // 系列推进（用户反馈）：day1 打勾后点 → 箭头，下一个可学习日出现 day2；
  // 序号按同前缀最大值 +1 接续，当天已有 day1~day3 时逐行点箭头得到 day4~day6。
  const createNextSeriesMutation = useMutation({
    mutationFn: (params: { task: TaskLike; numberIndex?: number }) => {
      const input: { expectedVersion: number; numberIndex?: number } = {
        expectedVersion: params.task.version,
      };
      if (params.numberIndex != null) input.numberIndex = params.numberIndex;
      return createNextSeriesTask(params.task.id, input);
    },
    onSuccess: async (created) => {
      void message.success(
        `已生成「${created.titleSnapshot}」，排在 ${created.scheduledDate ?? "下一个可学习日"}`,
      );
      await offerSeriesSuggestion(created.studentId);
    },
    onError: (error) => {
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "接排下一项失败，请稍后重试",
      );
    },
    onSettled: () => {
      void invalidateTaskViews(queryClient);
    },
  });

  // 右键“设为长期任务”：普通任务原地升级为长期任务轨道的当前项，完成后续项
  // 由轨道按标题模板自动接排；历史任务不回填。
  const convertToLongTaskMutation = useMutation({
    mutationFn: (params: { task: TaskLike; numberIndex?: number }) => {
      const input: { expectedVersion: number; numberIndex?: number } = {
        expectedVersion: params.task.version,
      };
      if (params.numberIndex != null) input.numberIndex = params.numberIndex;
      return convertTaskToLongTask(params.task.id, input);
    },
    onSuccess: (result) => {
      void message.success(
        `已设为长期任务，当前第 ${result.ordinal} 项，完成后续项将自动接排`,
      );
    },
    onError: (error) => {
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "设为长期任务失败，请稍后重试",
      );
    },
    onSettled: () => {
      void invalidateTaskViews(queryClient);
    },
  });

  // Priority toggle. ScheduleTask now carries priority (D2 wiring); the
  // optimistic update only patches the cache for invalidation here — the
  // refresh brings authoritative values back from SQLite.
  const updateTaskMutation = useMutation({
    mutationFn: (params: {
      task: TaskLike;
      priority?: Priority;
      title?: string;
    }) =>
      updateTask(params.task.id, {
        expectedVersion: params.task.version,
        priority: params.priority,
        title: params.title,
      }),
    onError: (error) => {
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "更新任务失败，请稍后重试",
      );
    },
    onSettled: () => {
      void invalidateTaskViews(queryClient);
    },
  });

  // D2: reschedule is driven by RescheduleModal inside TaskCard; the card
  // calls onReschedule(task, targetDate) only after a successful PATCH, so
  // the page just needs to refresh the schedule windows to reflect the new
  // date.
  const handleRescheduleSuccess = () => {
    void invalidateTaskViews(queryClient);
  };

  // 日/周/月视图里每个日期格子的"添加任务"入口；创建成功后刷新所有共享
  // 任务投影（today/workbench/schedule），让新任务立刻出现在对应格子里。
  const refreshTaskViews = () => invalidateTaskViews(queryClient);

  const rescheduleMutation = useMutation({
    mutationFn: (params: {
      taskId: string;
      version: number;
      targetDate: string;
      overrideReason?: string;
    }) =>
      taskActions.reschedule(
        params.taskId,
        params.version,
        params.targetDate,
        params.overrideReason,
      ),
    onMutate: async (params) => {
      // Optimistic update: move the task from its source day to the target
      // day immediately so the drag feels instantaneous. The target day may
      // not exist in the current window (e.g. dragging into a day outside
      // the visible range); in that case we drop the task from the source
      // and let the invalidation repopulate it.
      await queryClient.cancelQueries({
        queryKey: ["schedule", studentId],
      });
      const snapshots = queryClient.getQueriesData<ScheduleResponse>({
        queryKey: ["schedule", studentId],
      });
      queryClient.setQueriesData<ScheduleResponse | undefined>(
        { queryKey: ["schedule", studentId] },
        (prev) => {
          if (!prev) return prev;
          let movedTask: ScheduleTask | null = null;
          const days = prev.days.map((day) => {
            const idx = day.tasks.findIndex((t) => t.id === params.taskId);
            if (idx === -1) return day;
            movedTask = day.tasks[idx];
            return {
              ...day,
              tasks: day.tasks.filter((t) => t.id !== params.taskId),
            };
          });
          if (!movedTask) return { ...prev, days };
          const targetIdx = days.findIndex((d) => d.date === params.targetDate);
          if (targetIdx === -1) {
            // Target day is outside the cached window; the task is
            // removed from the source and will reappear after refetch.
            return { ...prev, days };
          }
          const updatedDays = days.slice();
          updatedDays[targetIdx] = {
            ...updatedDays[targetIdx],
            tasks: [...updatedDays[targetIdx].tasks, movedTask],
          };
          return { ...prev, days: updatedDays };
        },
      );
      return { snapshots };
    },
    onError: (error, _params, context) => {
      // Roll back the optimistic move on failure.
      if (context?.snapshots) {
        for (const [key, data] of context.snapshots) {
          queryClient.setQueryData(key, data);
        }
      }
      void message.error(
        error instanceof ApiError ? error.message : "排期更新失败，请稍后重试",
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["schedule", studentId],
      });
    },
    onSettled: () => {
      // Refresh the schedule snapshot so a subsequent "overwrite" retry
      // uses the latest version (AC-013).
      void invalidateTaskViews(queryClient);
    },
  });

  // AC-008: after a successful drag/move reschedule, surface a toast with
  // a one-click "undo" action that reschedules the task back to its
  // original date. The backend reschedule response carries no version, so
  // the undo reads the latest version from the freshly invalidated
  // schedule query.
  const showUndoToast = (undo: UndoContext) => {
    undoRef.current = undo;
    message.open({
      type: "success",
      content: `已将「${undo.title}」移至 ${undo.targetDate}（点击撤销）`,
      duration: 6,
      onClick: () => {
        void handleUndo();
      },
    });
  };

  const handleUndo = async () => {
    const undo = undoRef.current;
    if (!undo) return;
    // Look up the latest version from the refreshed schedule cache; if the
    // entry is missing (e.g. the task scrolled out of view), fall back to
    // an optimistic reschedule and let a 409 surface the current version.
    const latestVersion = readTaskVersion(
      queryClient,
      studentId ?? "",
      undo.taskId,
    );
    try {
      await rescheduleMutation.mutateAsync({
        taskId: undo.taskId,
        version: latestVersion ?? 0,
        targetDate: undo.originalDate,
      });
      void message.success(`已撤销：回到 ${undo.originalDate}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const serverVersion =
          typeof error.current.version === "number"
            ? error.current.version
            : null;
        if (serverVersion != null) {
          // Retry once against the server's authoritative version.
          try {
            await rescheduleMutation.mutateAsync({
              taskId: undo.taskId,
              version: serverVersion,
              targetDate: undo.originalDate,
            });
            void message.success(`已撤销：回到 ${undo.originalDate}`);
          } catch {
            void message.error("撤销失败，请手动改回原日期");
          }
        } else {
          void message.error("撤销失败，请手动改回原日期");
        }
      } else {
        void message.error("撤销失败，请手动改回原日期");
      }
    } finally {
      undoRef.current = null;
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const sortedDays = useMemo(() => {
    const data = scheduleQuery.data;
    if (!data) return [];
    return [...data.days].sort((a, b) => a.date.localeCompare(b.date));
  }, [scheduleQuery.data]);

  // Date-keyed lookup so the month grid shell can resolve each cell in O(1).
  const dayByDate = useMemo(
    () => new Map(sortedDays.map((day) => [day.date, day])),
    [sortedDays],
  );

  const handleDragStart = (event: DragStartEvent): void => {
    const data = event.active.data.current as DragData | undefined;
    if (data) {
      setActiveDrag(data);
    }
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;
    const dragData = active.data.current as DragData | undefined;
    const dropData = over.data.current as DropData | undefined;
    if (!dragData || !dropData) return;
    // RSC-001/INT-CAL-007: one move guard for every date-change entry point.
    if (
      !canMoveCalendarEvent(
        { locked: dragData.locked, scheduledDate: dragData.sourceDate },
        dropData.date,
      )
    ) {
      return;
    }
    const undo: UndoContext = {
      taskId: dragData.taskId,
      originalDate: dragData.sourceDate,
      targetDate: dropData.date,
      title: dragData.title,
    };
    rescheduleMutation.mutate(
      {
        taskId: dragData.taskId,
        version: dragData.version,
        targetDate: dropData.date,
      },
      {
        onSuccess: () => {
          // AC-008: offer a one-click undo that drags the task back to its
          // original date.
          showUndoToast(undo);
        },
      },
    );
  };

  if (scheduleQuery.isPending) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 8 }} />
      </Card>
    );
  }

  if (scheduleQuery.isError) {
    const error = scheduleQuery.error;
    return (
      <Card>
        <Alert
          type="error"
          title="排期暂不可用"
          showIcon
          description={
            error instanceof ApiError
              ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
              : "请检查本地数据文件后重试。"
          }
          action={
            <Button type="link" onClick={() => void scheduleQuery.refetch()}>
              重试
            </Button>
          }
        />
      </Card>
    );
  }

  const data = scheduleQuery.data;

  // "改期到下一天" is the next calendar day, not the next day that happens to
  // be loaded in the current window. Deriving it from `sortedDays` made the
  // action dead on the last cell of every window (and on the single day of the
  // day view), even though the target date is always well defined.
  const findNextDay = (currentDate: string): string | null =>
    nextCalendarDay(currentDate);

  return (
    <Spin
      spinning={
        completeMutation.isPending ||
        reopenMutation.isPending ||
        rescheduleMutation.isPending ||
        deleteTaskMutation.isPending ||
        duplicateTaskMutation.isPending ||
        createNextSeriesMutation.isPending ||
        updateTaskMutation.isPending
      }
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Space>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => void navigate(-1)}
          >
            返回
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {data.studentName} 的排期
          </Typography.Title>
          <Typography.Text type="secondary">{data.studentCode}</Typography.Text>
          <Tag>{data.devicePolicy}</Tag>
          {/* AVL-013: the study-day rules editor lives on the profile page;
              reach it without leaving the calendar workflow. */}
          <Button
            style={{ marginLeft: "auto" }}
            onClick={() => void navigate(`/students/${studentId}/profile`)}
          >
            学习日设置
          </Button>
        </Space>

        <Space>
          {(["day", "week", "month"] as const).map((v) => (
            <Button
              key={v}
              type={view === v ? "primary" : "default"}
              onClick={() => setView(v)}
            >
              {v === "day" ? "日" : v === "week" ? "周" : "月"}视图
            </Button>
          ))}
          <input
            type="date"
            aria-label="排期日期"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </Space>

        {data.days.length === 0 ? (
          <Empty description="所选范围内无排期数据" />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {view === "day" ? (
              // Day view: one full-width card per returned day. The local
              // adapter narrows the window to exactly the selected day, so
              // this renders a single card.
              <Space
                direction="vertical"
                size="middle"
                style={{ width: "100%" }}
              >
                {data.days.map((day) => (
                  <DayCard
                    key={day.date}
                    day={day}
                    studentId={studentId as string}
                    studentName={data.studentName}
                    activeDragLocked={activeDrag?.locked ?? false}
                    onComplete={(task) =>
                      completeMutation.mutate({
                        taskId: task.id,
                        version: task.version,
                      })
                    }
                    onReopen={(task) =>
                      reopenMutation.mutate({
                        taskId: task.id,
                        version: task.version,
                      })
                    }
                    onCarryForward={(task) => carryForwardMutation.mutate(task)}
                    onMoveNext={(task) => {
                      const nextDate = findNextDay(day.date);
                      if (nextDate) {
                        const undo: UndoContext = {
                          taskId: task.id,
                          originalDate: day.date,
                          targetDate: nextDate,
                          title: task.shortTitle ?? task.title,
                        };
                        rescheduleMutation.mutate(
                          {
                            taskId: task.id,
                            version: task.version,
                            targetDate: nextDate,
                          },
                          {
                            onSuccess: () => {
                              // AC-008: offer undo for the manual move.
                              showUndoToast(undo);
                            },
                          },
                        );
                      }
                    }}
                    onDelete={(task) => deleteTaskMutation.mutate(task)}
                    onDuplicate={(task) => duplicateTaskMutation.mutate(task)}
                    onCreateNext={(task, numberIndex) =>
                      createNextSeriesMutation.mutate({ task, numberIndex })
                    }
                    onConvertToLongTask={(task, numberIndex) =>
                      convertToLongTaskMutation.mutate({ task, numberIndex })
                    }
                    onViewDetail={(task) => setDetailTarget(task)}
                    onSetPriority={(task, next) =>
                      updateTaskMutation.mutate({ task, priority: next })
                    }
                    onRename={(task, title) =>
                      updateTaskMutation.mutate({ task, title })
                    }
                    onRescheduleSuccess={handleRescheduleSuccess}
                    onAddTask={refreshTaskViews}
                  />
                ))}
              </Space>
            ) : view === "week" ? (
              // Week view: 7 columns x 1 row. Each column is one day of the
              // selected week; tasks stack vertically inside the cell and
              // the row grows with content (no fixed height).
              <div style={{ overflowX: "auto" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(7, minmax(220px, 1fr))",
                    gap: 8,
                  }}
                >
                  {weekHeaderNames.map((name) => (
                    <div
                      key={name}
                      style={{
                        textAlign: "center",
                        fontWeight: 600,
                        padding: "4px 0",
                        color: "#888",
                      }}
                    >
                      周{name}
                    </div>
                  ))}
                  {buildWeekGrid(sortedDays).map((day, idx) =>
                    day ? (
                      <DayCell
                        key={day.date}
                        day={day}
                        studentId={studentId as string}
                        studentName={data.studentName}
                        activeDragLocked={activeDrag?.locked ?? false}
                        onComplete={(task) =>
                          completeMutation.mutate({
                            taskId: task.id,
                            version: task.version,
                          })
                        }
                        onReopen={(task) =>
                          reopenMutation.mutate({
                            taskId: task.id,
                            version: task.version,
                          })
                        }
                        onCarryForward={(task) =>
                          carryForwardMutation.mutate(task)
                        }
                        onMoveNext={(task, dayDate) => {
                          const nextDate = findNextDay(dayDate);
                          if (nextDate) {
                            const undo: UndoContext = {
                              taskId: task.id,
                              originalDate: dayDate,
                              targetDate: nextDate,
                              title: task.shortTitle ?? task.title,
                            };
                            rescheduleMutation.mutate(
                              {
                                taskId: task.id,
                                version: task.version,
                                targetDate: nextDate,
                              },
                              {
                                onSuccess: () => {
                                  showUndoToast(undo);
                                },
                              },
                            );
                          }
                        }}
                        onDelete={(task) => deleteTaskMutation.mutate(task)}
                        onDuplicate={(task) =>
                          duplicateTaskMutation.mutate(task)
                        }
                        onCreateNext={(task, numberIndex) =>
                          createNextSeriesMutation.mutate({ task, numberIndex })
                        }
                        onConvertToLongTask={(task, numberIndex) =>
                          convertToLongTaskMutation.mutate({
                            task,
                            numberIndex,
                          })
                        }
                        onViewDetail={(task) => setDetailTarget(task)}
                        onSetPriority={(task, next) =>
                          updateTaskMutation.mutate({ task, priority: next })
                        }
                        onRename={(task, title) =>
                          updateTaskMutation.mutate({ task, title })
                        }
                        onRescheduleSuccess={handleRescheduleSuccess}
                        onAddTask={refreshTaskViews}
                      />
                    ) : (
                      <div
                        key={`empty-${idx}`}
                        style={{
                          minHeight: 96,
                          border: "1px dashed #d9d9d9",
                          borderRadius: 8,
                          background: "#fafafa",
                        }}
                      />
                    ),
                  )}
                </div>
              </div>
            ) : (
              // Month view: the Monday-first six-week grid comes from the
              // ported Flowclass MonthView shell (INT-CAL-001/002); each cell
              // is still WD's DayCell, so the checkbox, context menu, +N
              // overflow and study-day marking are unchanged.
              <div className="flowclass-scope">
                <MonthView
                  anchorDate={selectedDate}
                  renderDay={(calendarDay) => {
                    const day = dayByDate.get(calendarDay.businessDate);
                    if (!day) {
                      return (
                        <div
                          className="flowcal-day flowcal-day-muted"
                          aria-hidden="true"
                        />
                      );
                    }
                    return (
                      <DayCell
                        day={day}
                        muted={!calendarDay.isCurrentMonth}
                        studentId={studentId as string}
                        studentName={data.studentName}
                        activeDragLocked={activeDrag?.locked ?? false}
                        onComplete={(task) =>
                          completeMutation.mutate({
                            taskId: task.id,
                            version: task.version,
                          })
                        }
                        onReopen={(task) =>
                          reopenMutation.mutate({
                            taskId: task.id,
                            version: task.version,
                          })
                        }
                        onCarryForward={(task) =>
                          carryForwardMutation.mutate(task)
                        }
                        onMoveNext={(task, dayDate) => {
                          const nextDate = findNextDay(dayDate);
                          if (nextDate) {
                            const undo: UndoContext = {
                              taskId: task.id,
                              originalDate: dayDate,
                              targetDate: nextDate,
                              title: task.shortTitle ?? task.title,
                            };
                            rescheduleMutation.mutate(
                              {
                                taskId: task.id,
                                version: task.version,
                                targetDate: nextDate,
                              },
                              {
                                onSuccess: () => {
                                  showUndoToast(undo);
                                },
                              },
                            );
                          }
                        }}
                        onDelete={(task) => deleteTaskMutation.mutate(task)}
                        onDuplicate={(task) =>
                          duplicateTaskMutation.mutate(task)
                        }
                        onCreateNext={(task, numberIndex) =>
                          createNextSeriesMutation.mutate({ task, numberIndex })
                        }
                        onConvertToLongTask={(task, numberIndex) =>
                          convertToLongTaskMutation.mutate({
                            task,
                            numberIndex,
                          })
                        }
                        onViewDetail={(task) => setDetailTarget(task)}
                        onSetPriority={(task, next) =>
                          updateTaskMutation.mutate({ task, priority: next })
                        }
                        onRename={(task, title) =>
                          updateTaskMutation.mutate({ task, title })
                        }
                        onRescheduleSuccess={handleRescheduleSuccess}
                        onAddTask={refreshTaskViews}
                      />
                    );
                  }}
                />
              </div>
            )}
            <DragOverlay dropAnimation={null}>
              {activeDrag ? (
                <Card size="small" style={{ opacity: 0.85 }}>
                  <Space size="small">
                    <LockOutlined />
                    <Typography.Text strong>{activeDrag.title}</Typography.Text>
                  </Space>
                </Card>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {completeMutation.isError || reopenMutation.isError ? (
          <Alert
            type="error"
            title="操作失败"
            showIcon
            description={
              (completeMutation.error ?? reopenMutation.error)?.message ??
              "未知错误"
            }
          />
        ) : null}
      </Space>
      <TaskDetailDrawer
        target={detailTarget}
        onClose={() => setDetailTarget(null)}
      />
    </Spin>
  );
}

// Build a 7-cell row for the week view, ordered Monday..Sunday. The backend
// returns the days of the selected week (already filtered to that week);
// we place each day into its Monday-first column and return them in order.
// Missing columns (shouldn't normally happen for a full week) are filled with
// placeholder cells via the returned length-7 array using `undefined`.
function buildWeekGrid(days: ScheduleDay[]): (ScheduleDay | null)[] {
  const cells: (ScheduleDay | null)[] = Array.from({ length: 7 }, () => null);
  for (const day of days) {
    const col = gridColumnIndex(day.date);
    if (col >= 0 && col < 7) cells[col] = day;
  }
  return cells;
}

/** The calendar day after `date`, in local time, as YYYY-MM-DD. */
function nextCalendarDay(date: string): string {
  return shiftDate(date, 1);
}

function DayCard({
  day,
  studentId,
  studentName,
  activeDragLocked,
  onComplete,
  onReopen,
  onCarryForward,
  onMoveNext,
  onDelete,
  onDuplicate,
  onCreateNext,
  onConvertToLongTask,
  onViewDetail,
  onSetPriority,
  onRename,
  onRescheduleSuccess,
  onAddTask,
}: {
  day: ScheduleDay;
  studentId: string;
  studentName: string;
  activeDragLocked: boolean;
  onComplete: (task: ScheduleTask) => void;
  onReopen: (task: ScheduleTask) => void;
  onCarryForward: (task: TaskLike) => void;
  onMoveNext: (task: ScheduleTask) => void;
  onDelete: (task: TaskLike) => void;
  onDuplicate: (task: TaskLike) => void;
  onCreateNext: (task: TaskLike, numberIndex?: number) => void;
  onConvertToLongTask?: (task: TaskLike, numberIndex?: number) => void;
  onViewDetail: (target: TaskDetailTarget) => void;
  onSetPriority: (task: TaskLike, next: Priority) => void;
  onRename: (task: TaskLike, title: string) => void;
  onRescheduleSuccess: () => void;
  onAddTask: () => void | Promise<void>;
}) {
  const dateObj = parseDate(day.date);
  const dayName = dayNames[dateObj.getDay()];
  // "今天"高亮基于本机日历日期。
  const isToday = day.date === useBusinessDate();

  const { isOver, setNodeRef } = useDroppable({
    id: day.date,
    data: { date: day.date, available: day.available } satisfies DropData,
  });

  const borderState: "default" | "unavailable" | "locked" =
    isOver && activeDragLocked
      ? "locked"
      : isOver && !day.available
        ? "unavailable"
        : "default";

  const borderColor =
    borderState === "locked"
      ? "#ff4d4f"
      : borderState === "unavailable"
        ? "#fa8c16"
        : undefined;
  const borderWidth =
    borderState === "locked" || borderState === "unavailable" ? 2 : undefined;

  return (
    <Card
      ref={setNodeRef}
      size="small"
      title={
        <Space>
          <Typography.Text strong>
            {day.date} 星期{dayName}
          </Typography.Text>
          {isToday ? <Tag color="blue">今天</Tag> : null}
          {!day.available ? <Tag color="red">不可学习</Tag> : null}
          {day.available ? (
            <Typography.Text type="secondary">
              {day.availableMinutes}分钟
            </Typography.Text>
          ) : null}
          {borderState === "unavailable" ? (
            <Tag color="orange" icon={<LockOutlined />}>
              不可学习
            </Tag>
          ) : null}
          {borderState === "locked" ? (
            <Tag color="red" icon={<LockOutlined />}>
              已锁定
            </Tag>
          ) : null}
          <DayAddTask
            studentId={studentId}
            date={day.date}
            onCreated={onAddTask}
          />
        </Space>
      }
      style={{
        borderColor,
        borderWidth,
      }}
    >
      {day.tasks.length === 0 ? (
        <Typography.Text type="secondary">无任务</Typography.Text>
      ) : (
        <Space direction="vertical" style={{ width: "100%" }}>
          {day.tasks.map((task) => {
            return (
              <DraggableTaskItem
                key={task.id}
                task={task}
                studentId={studentId}
                studentName={studentName}
                sourceDate={day.date}
                onComplete={onComplete}
                onReopen={onReopen}
                onCarryForward={onCarryForward}
                onMoveNext={onMoveNext}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                onCreateNext={onCreateNext}
                onConvertToLongTask={onConvertToLongTask}
                onViewDetail={onViewDetail}
                onSetPriority={onSetPriority}
                onRename={onRename}
                onRescheduleSuccess={onRescheduleSuccess}
              />
            );
          })}
        </Space>
      )}
    </Card>
  );
}

// Calendar grid cell used by the week and month views. Unlike DayCard (which
// is a full AntD Card with a header), DayCell is a lightweight bordered column
// cell: it stacks its tasks vertically, grows to fit its content (no fixed
// height), collapses after MAX_TASKS_PER_CELL into a "+N more" indicator, and
// remains a useDroppable target so drag-and-drop reschedule still works.
function DayCell({
  day,
  muted = false,
  studentId,
  studentName,
  activeDragLocked,
  onComplete,
  onReopen,
  onCarryForward,
  onMoveNext,
  onDelete,
  onDuplicate,
  onCreateNext,
  onConvertToLongTask,
  onViewDetail,
  onSetPriority,
  onRename,
  onRescheduleSuccess,
  onAddTask,
}: {
  day: ScheduleDay;
  /** Dims cells that belong to the previous/next month in the month grid. */
  muted?: boolean;
  studentId: string;
  studentName: string;
  activeDragLocked: boolean;
  onComplete: (task: ScheduleTask) => void;
  onReopen: (task: ScheduleTask) => void;
  onCarryForward: (task: TaskLike) => void;
  onMoveNext: (task: ScheduleTask, dayDate: string) => void;
  onDelete: (task: TaskLike) => void;
  onDuplicate: (task: TaskLike) => void;
  onCreateNext: (task: TaskLike, numberIndex?: number) => void;
  onConvertToLongTask?: (task: TaskLike, numberIndex?: number) => void;
  onViewDetail: (target: TaskDetailTarget) => void;
  onSetPriority: (task: TaskLike, next: Priority) => void;
  onRename: (task: TaskLike, title: string) => void;
  onRescheduleSuccess: () => void;
  onAddTask: () => void | Promise<void>;
}) {
  const dateObj = parseDate(day.date);
  const dayName = dayNames[dateObj.getDay()];
  // "今天"高亮基于本机日历日期。
  const isToday = day.date === useBusinessDate();

  const { isOver, setNodeRef } = useDroppable({
    id: day.date,
    data: { date: day.date, available: day.available } satisfies DropData,
  });

  const borderState: "default" | "unavailable" | "locked" =
    isOver && activeDragLocked
      ? "locked"
      : isOver && !day.available
        ? "unavailable"
        : "default";

  const borderColor =
    borderState === "locked"
      ? "#ff4d4f"
      : borderState === "unavailable"
        ? "#fa8c16"
        : isToday
          ? "#1677ff"
          : "#e8e8e8";
  const borderWidth = isToday || borderState !== "default" ? 2 : 1;

  const visibleTasks = day.tasks.slice(0, MAX_TASKS_PER_CELL);
  const hiddenCount = day.tasks.length - visibleTasks.length;

  return (
    <div
      ref={setNodeRef}
      style={{
        border: `${borderWidth}px solid ${borderColor}`,
        borderRadius: 8,
        padding: 8,
        minHeight: 96,
        background: day.available ? "#fff" : "#fafafa",
        opacity: muted ? 0.55 : undefined,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 4,
          flexWrap: "wrap",
        }}
      >
        <Space size={4}>
          <Typography.Text strong style={{ fontSize: 13 }}>
            {dateObj.getDate()}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            周{dayName}
          </Typography.Text>
          {isToday ? (
            <Tag color="blue" style={{ margin: 0 }}>
              今天
            </Tag>
          ) : null}
          {!day.available ? (
            <Tag color="red" style={{ margin: 0 }}>
              不可学习
            </Tag>
          ) : null}
        </Space>
        <Space size={4}>
          {day.available ? (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {day.availableMinutes}分
            </Typography.Text>
          ) : null}
          <DayAddTask
            studentId={studentId}
            date={day.date}
            onCreated={onAddTask}
          />
        </Space>
      </div>
      {borderState === "unavailable" ? (
        <Tag
          color="orange"
          icon={<LockOutlined />}
          style={{ alignSelf: "flex-start" }}
        >
          不可学习
        </Tag>
      ) : null}
      {borderState === "locked" ? (
        <Tag
          color="red"
          icon={<LockOutlined />}
          style={{ alignSelf: "flex-start" }}
        >
          已锁定
        </Tag>
      ) : null}
      {day.tasks.length === 0 ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          无任务
        </Typography.Text>
      ) : (
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          {visibleTasks.map((task) => (
            <DraggableTaskItem
              key={task.id}
              task={task}
              studentId={studentId}
              studentName={studentName}
              sourceDate={day.date}
              onComplete={onComplete}
              onReopen={onReopen}
              onCarryForward={onCarryForward}
              onMoveNext={(t) => onMoveNext(t, day.date)}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onCreateNext={onCreateNext}
              onConvertToLongTask={onConvertToLongTask}
              onViewDetail={onViewDetail}
              onSetPriority={onSetPriority}
              onRename={onRename}
              onRescheduleSuccess={onRescheduleSuccess}
            />
          ))}
          {hiddenCount > 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              +{hiddenCount} more
            </Typography.Text>
          ) : null}
        </Space>
      )}
    </div>
  );
}

// 每个日期格子共用的"添加任务"入口：小加号按钮点开气泡输入框，回车即
// 创建当天临时任务（复用 Today 的 InlineTaskComposer，含模板挂载通道），
// 创建成功后通过 onCreated 刷新共享任务投影并收起气泡。
function DayAddTask({
  studentId,
  date,
  onCreated,
}: {
  studentId: string;
  date: string;
  onCreated: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      destroyOnHidden
      content={
        <div style={{ width: 280 }}>
          <InlineTaskComposer
            studentId={studentId}
            scheduledDate={date}
            onCreated={async () => {
              await onCreated();
              setOpen(false);
            }}
          />
        </div>
      }
    >
      <Button
        size="small"
        type="text"
        icon={<PlusOutlined />}
        aria-label={`在 ${date} 添加任务`}
      />
    </Popover>
  );
}

function DraggableTaskItem({
  task,
  studentId,
  studentName,
  sourceDate,
  onComplete,
  onReopen,
  onCarryForward,
  onMoveNext,
  onDelete,
  onDuplicate,
  onCreateNext,
  onConvertToLongTask,
  onViewDetail,
  onSetPriority,
  onRename,
  onRescheduleSuccess,
}: {
  task: ScheduleTask;
  studentId: string;
  studentName: string;
  sourceDate: string;
  onComplete: (task: ScheduleTask) => void;
  onReopen: (task: ScheduleTask) => void;
  onCarryForward: (task: TaskLike) => void;
  onMoveNext: (task: ScheduleTask) => void;
  onDelete: (task: TaskLike) => void;
  onDuplicate: (task: TaskLike) => void;
  onCreateNext: (task: TaskLike, numberIndex?: number) => void;
  onConvertToLongTask?: (task: TaskLike, numberIndex?: number) => void;
  onViewDetail: (target: TaskDetailTarget) => void;
  onSetPriority: (task: TaskLike, next: Priority) => void;
  onRename: (task: TaskLike, title: string) => void;
  onRescheduleSuccess: () => void;
}) {
  // ACC-055 / INT-CAL-007: a locked task must not be draggable at all, and a
  // carried-over source is history — neither can accept a new date. Relying on
  // the SQL guard alone let the gesture succeed and then surfaced a generic
  // failure instead of refusing the drag.
  const immovable = task.locked || task.carriedOver === true;
  // 系列推进只作用于手工/导入的编号任务；TRACK 任务的“下一项”由轨道在完成
  // 时自动生成（completeTask 推进 current_ordinal），箭头再做一份会重复。
  const seriesCandidates =
    task.sourceType === "TRACK" ? [] : parseSeriesTitleCandidates(task.title);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    disabled: immovable,
    data: {
      taskId: task.id,
      studentId,
      version: task.version,
      locked: task.locked,
      sourceDate,
      title: task.shortTitle ?? task.title,
    } satisfies DragData,
  });

  const taskLike = toTaskLike(task);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-task-drag-id={task.id}
      data-task-draggable={immovable ? "false" : "true"}
      style={{
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <TaskCard
        task={taskLike}
        density="compact"
        draggable
        onComplete={() => {
          // TaskCard passes TaskLike; map back to the ScheduleTask the
          // schedule mutations expect (the underlying record is the same
          // task, identified by id).
          onComplete(task);
        }}
        onReopen={() => {
          onReopen(task);
        }}
        onCarryForward={onCarryForward}
        onReschedule={() => onRescheduleSuccess()}
        onDelete={(t) => onDelete(t)}
        onDuplicate={(t) => onDuplicate(t)}
        // TRACK 任务完成时轨道会自动接排下一项，这里不再提供“继续这个系列”，
        // 避免同一序号出现两条平行任务。
        onCreateNext={
          seriesCandidates.length > 0
            ? (t, numberIndex) => onCreateNext(t, numberIndex)
            : undefined
        }
        onConvertToLongTask={
          onConvertToLongTask &&
          taskLike.sourceType === "AD_HOC" &&
          taskLike.status === "PENDING" &&
          !taskLike.locked
            ? (t, numberIndex) => onConvertToLongTask(t, numberIndex)
            : undefined
        }
        onViewDetail={() =>
          // ScheduleTask rows are day-scoped; inject the cell's date so the
          // drawer can show 计划日期 without a schema change.
          onViewDetail({
            task: { ...taskLike, scheduledDate: sourceDate, note: task.note },
            studentName,
          })
        }
        onSetPriority={(t, next) => onSetPriority(t, next)}
        onRename={onRename}
        extra={
          seriesCandidates.length > 0 ? (
            // 系列任务（标题带尾号）的箭头不再“改期自己”，而是生成“序号+1、
            // 排到下一个可学习日”的新任务：day1 打勾后点 → 即得下一个学习日的
            // day2。这和长期任务轨道是同一条排期规则（手动版的自动接排），改期
            // 仍可用拖拽或右键菜单。无尾号的任务保持原来的改期到下一天。
            <Button
              size="small"
              type="link"
              aria-label="继续这个系列"
              title="接排下一项：序号 +1，排到下一个可学习日"
              disabled={task.locked}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCreateNext(taskLike);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onCreateNext(taskLike);
                }
              }}
            >
              →
            </Button>
          ) : (
            <Button
              size="small"
              type="link"
              aria-label="改期到下一天"
              disabled={task.locked}
              onClick={(e) => {
                e.stopPropagation();
                onMoveNext(task);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onMoveNext(task);
                }
              }}
            >
              →
            </Button>
          )
        }
      />
    </div>
  );
}
