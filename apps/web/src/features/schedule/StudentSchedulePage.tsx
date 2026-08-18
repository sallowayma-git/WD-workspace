import { ArrowLeftOutlined, LockOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  Modal,
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
import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../lib/api/http";
import { useBusinessDate } from "../foundation/useBusinessDate";
import { TaskCard } from "../tasks/TaskCard";
import {
  createSubTask,
  deleteTask,
  duplicateTask,
  linkMainTask,
  updateTask,
  type Priority,
  type TaskLike,
} from "../tasks/taskApi";
import { completeTask, reopenTask } from "../today/todayApi";
import {
  getSchedule,
  rescheduleTask,
  type ScheduleDay,
  type ScheduleResponse,
  type ScheduleTask,
} from "./scheduleApi";

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
  const d = new Date(date);
  // JS getDay(): Sun=0..Sat=6. Convert to Monday-first (Sun -> 6).
  return (d.getDay() + 6) % 7;
}

/**
 * Adapts a ScheduleTask into the shared TaskCard TaskLike contract. D2 fields
 * (parentTaskId / linkedParentTaskId / priority / sortOrder / star) are now
 * surfaced on the schedule schema, so they pass through instead of being
 * hardcoded to defaults. When the backend omits them they stay undefined and
 * the card degrades gracefully.
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

interface ConflictInfo {
  message: string;
  currentVersion: number | null;
  // AC-013: preserve the user's pending reschedule request so they can
  // retry ("overwrite") against the server's latest version or cancel.
  pendingReschedule: {
    taskId: string;
    version: number;
    targetDate: string;
    overrideReason?: string;
  } | null;
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
  // AC-001: 业务日期由服务端按组织时区 (Asia/Shanghai) 计算,
  // 优先使用后端 /context 返回的 businessDate 作为初始日期;
  // 仅在 /context 尚未就绪时回退到浏览器本地日期。
  const today = useBusinessDate();
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const [selectedDate, setSelectedDate] = useState(today);
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  // AC-008: keep the last undo context around so the "撤销本次拖拽" toast
  // button can reschedule the task back to its original date.
  const undoRef = useRef<UndoContext | null>(null);

  const scheduleQuery = useQuery({
    queryKey: ["schedule", studentId, view, selectedDate],
    queryFn: () =>
      getSchedule(studentId as string, { from: selectedDate, view }),
    enabled: Boolean(studentId),
    retry: false,
  });

  const completeMutation = useMutation({
    mutationFn: (params: { taskId: string; version: number }) =>
      completeTask(params.taskId, params.version, crypto.randomUUID()),
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
                      ? { ...task, status: "COMPLETED" }
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
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ["schedule", studentId],
      });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: (params: { taskId: string; version: number }) =>
      reopenTask(params.taskId, params.version, crypto.randomUUID()),
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
                      ? { ...task, status: "PENDING" }
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
      void queryClient.invalidateQueries({
        queryKey: ["schedule", studentId],
      });
    },
  });

  // D2: shared TaskCard callbacks. These mutations invalidate the schedule
  // windows on settle so the list reflects the latest server state. 409
  // conflicts surface through the same conflict banner as reschedule.
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
      void queryClient.invalidateQueries({ queryKey: ["schedule", studentId] });
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
      void queryClient.invalidateQueries({ queryKey: ["schedule", studentId] });
    },
  });

  const createSubTaskMutation = useMutation({
    mutationFn: (params: { task: TaskLike; title: string }) =>
      createSubTask(params.task.id, { title: params.title }),
    onSuccess: () => {
      void message.success("已添加子任务");
    },
    onError: (error) => {
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "添加子任务失败，请稍后重试",
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["schedule", studentId] });
    },
  });

  const linkMainTaskMutation = useMutation({
    mutationFn: (params: { task: TaskLike; linkedParentTaskId: string }) =>
      linkMainTask(params.task.id, params.task.version, params.linkedParentTaskId),
    onSuccess: () => {
      void message.success("已关联主任务");
    },
    onError: (error) => {
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "关联主任务失败，请稍后重试",
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["schedule", studentId] });
    },
  });

  // Priority toggle. ScheduleTask now carries priority (D2 wiring); the
  // optimistic update only patches the cache for invalidation here — the
  // refresh brings authoritative values back. 409 conflicts surface through
  // the same conflict banner as reschedule.
  const updateTaskMutation = useMutation({
    mutationFn: (params: {
      task: TaskLike;
      priority?: Priority;
    }) =>
      updateTask(params.task.id, {
        expectedVersion: params.task.version,
        priority: params.priority,
      }),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        const currentVersion =
          typeof error.current.version === "number"
            ? error.current.version
            : null;
        setConflict({
          message: error.message,
          currentVersion,
          pendingReschedule: null,
        });
      } else {
        void message.error(
          error instanceof ApiError
            ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
            : "更新任务失败，请稍后重试",
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["schedule", studentId] });
    },
  });

  // D2: reschedule is driven by RescheduleModal inside TaskCard; the card
  // calls onReschedule(task, targetDate) only after a successful PATCH, so
  // the page just needs to refresh the schedule windows to reflect the new
  // date.
  const handleRescheduleSuccess = () => {
    void queryClient.invalidateQueries({ queryKey: ["schedule", studentId] });
  };

  const rescheduleMutation = useMutation({
    mutationFn: (params: {
      taskId: string;
      version: number;
      targetDate: string;
      overrideReason?: string;
    }) =>
      rescheduleTask(
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
    onError: (error, params, context) => {
      // Roll back the optimistic move on failure.
      if (context?.snapshots) {
        for (const [key, data] of context.snapshots) {
          queryClient.setQueryData(key, data);
        }
      }
      if (error instanceof ApiError && error.status === 409) {
        const currentVersion =
          typeof error.current.version === "number"
            ? error.current.version
            : null;
        // AC-013: keep the user's pending reschedule request so they can
        // retry ("overwrite") against the server's latest version or
        // cancel ("discard").
        setConflict({
          message: error.message,
          currentVersion,
          pendingReschedule: params,
        });
      } else {
        setConflict(null);
      }
    },
    onSuccess: async () => {
      setConflict(null);
      await queryClient.invalidateQueries({
        queryKey: ["schedule", studentId],
      });
    },
    onSettled: () => {
      // Refresh the schedule snapshot so a subsequent "overwrite" retry
      // uses the latest version (AC-013).
      void queryClient.invalidateQueries({
        queryKey: ["schedule", studentId],
      });
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

  // AC-013: "overwrite with my version" — retry the pending reschedule
  // using the server's latest version (already reloaded via the 409
  // invalidation above).
  const handleOverwrite = () => {
    if (!conflict?.pendingReschedule) return;
    const pending = conflict.pendingReschedule;
    const latestVersion =
      conflict.currentVersion ?? pending.version;
    rescheduleMutation.mutate({
      taskId: pending.taskId,
      version: latestVersion,
      targetDate: pending.targetDate,
      overrideReason: pending.overrideReason,
    });
  };

  // AC-013: "discard changes" — drop the pending reschedule and clear the
  // conflict; the schedule view stays aligned with the server state.
  const handleDiscard = () => {
    setConflict(null);
  };

  const [override, setOverride] = useState<{
    taskId: string;
    version: number;
    targetDate: string;
    reason: string;
  } | null>(null);

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
    if (dragData.sourceDate === dropData.date) return;
    if (!dropData.available) {
      // Target day is unavailable — prompt for an override reason before
      // committing the reschedule (PRD AC-007 / BR-009).
      setOverride({
        taskId: dragData.taskId,
        version: dragData.version,
        targetDate: dropData.date,
        reason: "",
      });
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
              : "请确认 API 已启动并登录。"
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

  const findNextDay = (currentDate: string): string | null => {
    const idx = sortedDays.findIndex((d) => d.date === currentDate);
    if (idx === -1 || idx >= sortedDays.length - 1) return null;
    return sortedDays[idx + 1].date;
  };

  return (
    <Spin
      spinning={
        completeMutation.isPending ||
        reopenMutation.isPending ||
        rescheduleMutation.isPending ||
        deleteTaskMutation.isPending ||
        duplicateTaskMutation.isPending ||
        createSubTaskMutation.isPending ||
        linkMainTaskMutation.isPending ||
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
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </Space>

        {conflict ? (
          <Alert
            type="warning"
            showIcon
            message="任务已被其他用户修改"
            description={
              <>
                <Typography.Paragraph style={{ marginBottom: 8 }}>
                  {conflict.currentVersion != null
                    ? `${conflict.message}（服务器当前版本 v${conflict.currentVersion}）。已为您重新加载最新排期，您的顺延请求仍保留。`
                    : conflict.message}
                </Typography.Paragraph>
                <Space>
                  <Button
                    type="primary"
                    loading={rescheduleMutation.isPending}
                    onClick={handleOverwrite}
                  >
                    用我的版本覆盖
                  </Button>
                  <Button onClick={handleDiscard}>放弃修改</Button>
                </Space>
              </>
            }
          />
        ) : null}

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
              // Day view: keep the single full-width vertical stack of day
              // cards (one card per returned day; the day view returns one
              // day but we render whatever the backend gives).
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                {data.days.map((day) => (
                  <DayCard
                    key={day.date}
                    day={day}
                    studentId={studentId as string}
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
                              // AC-008: offer undo for the "顺延到下一天" move.
                              showUndoToast(undo);
                            },
                          },
                        );
                      }
                    }}
                    onDelete={(task) => deleteTaskMutation.mutate(task)}
                    onDuplicate={(task) => duplicateTaskMutation.mutate(task)}
                    onAddSubTask={(task, title) =>
                      createSubTaskMutation.mutate({ task, title })
                    }
                    onLinkParent={(task, linkedParentTaskId) =>
                      linkMainTaskMutation.mutate({ task, linkedParentTaskId })
                    }
                    onViewDetail={(task) =>
                      void message.info(`任务 ${task.id} 详情待实现`)
                    }
                    onSetPriority={(task, next) =>
                      updateTaskMutation.mutate({ task, priority: next })
                    }
                    onRescheduleSuccess={handleRescheduleSuccess}
                  />
                ))}
              </Space>
            ) : view === "week" ? (
              // Week view: 7 columns x 1 row. Each column is one day of the
              // selected week; tasks stack vertically inside the cell and
              // the row grows with content (no fixed height).
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
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
                      onDuplicate={(task) => duplicateTaskMutation.mutate(task)}
                      onAddSubTask={(task, title) =>
                        createSubTaskMutation.mutate({ task, title })
                      }
                      onLinkParent={(task, linkedParentTaskId) =>
                        linkMainTaskMutation.mutate({ task, linkedParentTaskId })
                      }
                      onViewDetail={(task) =>
                        void message.info(`任务 ${task.id} 详情待实现`)
                      }
                      onSetPriority={(task, next) =>
                        updateTaskMutation.mutate({ task, priority: next })
                      }
                      onRescheduleSuccess={handleRescheduleSuccess}
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
            ) : (
              // Month view: 7-column grid, one row per week (standard month
              // calendar layout). Each cell is one day; tasks stack
              // vertically and the cell grows with content. Days outside the
              // month that belong to the first/last week are rendered as
              // empty placeholder cells so the grid stays rectangular.
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
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
                {buildMonthGrid(sortedDays, selectedDate).map((day, idx) =>
                  day ? (
                    <DayCell
                      key={day.date}
                      day={day}
                      studentId={studentId as string}
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
                      onDuplicate={(task) => duplicateTaskMutation.mutate(task)}
                      onAddSubTask={(task, title) =>
                        createSubTaskMutation.mutate({ task, title })
                      }
                      onLinkParent={(task, linkedParentTaskId) =>
                        linkMainTaskMutation.mutate({
                          task,
                          linkedParentTaskId,
                        })
                      }
                      onViewDetail={(task) =>
                        void message.info(`任务 ${task.id} 详情待实现`)
                      }
                      onSetPriority={(task, next) =>
                        updateTaskMutation.mutate({ task, priority: next })
                      }
                      onRescheduleSuccess={handleRescheduleSuccess}
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

        <Modal
          title="目标日不可学习"
          open={override !== null}
          okText="override 仍然安排"
          cancelText="取消"
          okButtonProps={{ disabled: !override?.reason.trim() }}
          confirmLoading={rescheduleMutation.isPending}
          onCancel={() => setOverride(null)}
          onOk={() => {
            if (!override || !override.reason.trim()) return;
            // Capture the task's current (pre-move) day + title as the undo
            // target so the override reschedule can also be undone (AC-008).
            const currentTask = data.days
              .flatMap((d) => d.tasks)
              .find((t) => t.id === override.taskId);
            const undo: UndoContext = {
              taskId: override.taskId,
              originalDate:
                data.days.find((d) =>
                  d.tasks.some((t) => t.id === override.taskId),
                )?.date ?? "",
              targetDate: override.targetDate,
              title: currentTask?.shortTitle ?? currentTask?.title ?? "",
            };
            rescheduleMutation.mutate(
              {
                taskId: override.taskId,
                version: override.version,
                targetDate: override.targetDate,
                overrideReason: override.reason.trim(),
              },
              {
                onSuccess: () => {
                  if (undo.originalDate) {
                    // AC-008: even override reschedules can be undone.
                    showUndoToast(undo);
                  }
                },
                onSettled: () => setOverride(null),
              },
            );
          }}
        >
          <Alert
            type="warning"
            showIcon
            message={`目标日期 ${override?.targetDate ?? ""} 不可学习或与设备条件冲突。`}
            description="继续安排将记录为 manual override（BR-009）。请填写 override 原因后再提交。"
            style={{ marginBottom: 12 }}
          />
          <Input.TextArea
            rows={3}
            autoFocus
            maxLength={500}
            placeholder="请输入 override 原因（必填）"
            value={override?.reason ?? ""}
            onChange={(e) =>
              setOverride((prev) =>
                prev ? { ...prev, reason: e.target.value } : prev,
              )
            }
          />
        </Modal>
      </Space>
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

// Build a month grid: full weeks (Mon..Sun) covering the month that contains
// `selectedDate`. Each returned entry is either a `ScheduleDay` (a day within
// the month's returned range) or `null` (a day outside the month, e.g. the
// leading days of the first week or trailing days of the last week, which
// the backend does not return for the month view). The backend returns the
// weeks of the month; we map each returned day into its column, then pad the
// leading/trailing slots of the first/last week so the grid is rectangular.
function buildMonthGrid(
  days: ScheduleDay[],
  selectedDate: string,
): (ScheduleDay | null)[] {
  // Index returned days by date for O(1) lookup.
  const byDate = new Map<string, ScheduleDay>();
  for (const day of days) byDate.set(day.date, day);

  // Compute the month boundaries from the selected date.
  const base = new Date(selectedDate);
  const year = base.getFullYear();
  const month = base.getMonth();

  // First day of the month, and the Monday that starts the first grid week.
  const firstOfMonth = new Date(year, month, 1);
  const firstWeekday = firstOfMonth.getDay(); // Sun=0..Sat=6
  const leadingBlanks = (firstWeekday + 6) % 7; // Monday-first offset

  // Last day of the month.
  const lastDate = new Date(year, month + 1, 0).getDate();

  const cells: (ScheduleDay | null)[] = [];
  // Leading empty cells (days before the 1st that belong to the prior month).
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  // Days of the month.
  for (let d = 1; d <= lastDate; d++) {
    const iso = formatDateKey(year, month, d);
    cells.push(byDate.get(iso) ?? null);
  }
  // Trailing empty cells so the grid is a whole number of weeks (multiple of 7).
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Format a Y/M/D into a YYYY-MM-DD string (local, no timezone shift). */
function formatDateKey(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function DayCard({
  day,
  studentId,
  activeDragLocked,
  onComplete,
  onReopen,
  onMoveNext,
  onDelete,
  onDuplicate,
  onAddSubTask,
  onLinkParent,
  onViewDetail,
  onSetPriority,
  onRescheduleSuccess,
}: {
  day: ScheduleDay;
  studentId: string;
  activeDragLocked: boolean;
  onComplete: (task: ScheduleTask) => void;
  onReopen: (task: ScheduleTask) => void;
  onMoveNext: (task: ScheduleTask) => void;
  onDelete: (task: TaskLike) => void;
  onDuplicate: (task: TaskLike) => void;
  onAddSubTask: (task: TaskLike, title: string) => void;
  onLinkParent: (task: TaskLike, linkedParentTaskId: string) => void;
  onViewDetail: (task: TaskLike) => void;
  onSetPriority: (task: TaskLike, next: Priority) => void;
  onRescheduleSuccess: () => void;
}) {
  const dateObj = new Date(day.date);
  const dayName = dayNames[dateObj.getDay()];
  // AC-001: "今天"高亮基于服务端业务日期,而非浏览器本地日期。
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
                sourceDate={day.date}
                onComplete={onComplete}
                onReopen={onReopen}
                onMoveNext={onMoveNext}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                onAddSubTask={onAddSubTask}
                onLinkParent={onLinkParent}
                onViewDetail={onViewDetail}
                onSetPriority={onSetPriority}
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
  studentId,
  activeDragLocked,
  onComplete,
  onReopen,
  onMoveNext,
  onDelete,
  onDuplicate,
  onAddSubTask,
  onLinkParent,
  onViewDetail,
  onSetPriority,
  onRescheduleSuccess,
}: {
  day: ScheduleDay;
  studentId: string;
  activeDragLocked: boolean;
  onComplete: (task: ScheduleTask) => void;
  onReopen: (task: ScheduleTask) => void;
  onMoveNext: (task: ScheduleTask, dayDate: string) => void;
  onDelete: (task: TaskLike) => void;
  onDuplicate: (task: TaskLike) => void;
  onAddSubTask: (task: TaskLike, title: string) => void;
  onLinkParent: (task: TaskLike, linkedParentTaskId: string) => void;
  onViewDetail: (task: TaskLike) => void;
  onSetPriority: (task: TaskLike, next: Priority) => void;
  onRescheduleSuccess: () => void;
}) {
  const dateObj = new Date(day.date);
  const dayName = dayNames[dateObj.getDay()];
  // AC-001: "今天"高亮基于服务端业务日期,而非浏览器本地日期。
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
          {isToday ? <Tag color="blue" style={{ margin: 0 }}>今天</Tag> : null}
          {!day.available ? (
            <Tag color="red" style={{ margin: 0 }}>
              不可学习
            </Tag>
          ) : null}
        </Space>
        {day.available ? (
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {day.availableMinutes}分
          </Typography.Text>
        ) : null}
      </div>
      {borderState === "unavailable" ? (
        <Tag color="orange" icon={<LockOutlined />} style={{ alignSelf: "flex-start" }}>
          不可学习
        </Tag>
      ) : null}
      {borderState === "locked" ? (
        <Tag color="red" icon={<LockOutlined />} style={{ alignSelf: "flex-start" }}>
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
              sourceDate={day.date}
              onComplete={onComplete}
              onReopen={onReopen}
              onMoveNext={(t) => onMoveNext(t, day.date)}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onAddSubTask={onAddSubTask}
              onLinkParent={onLinkParent}
              onViewDetail={onViewDetail}
              onSetPriority={onSetPriority}
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

function DraggableTaskItem({
  task,
  studentId,
  sourceDate,
  onComplete,
  onReopen,
  onMoveNext,
  onDelete,
  onDuplicate,
  onAddSubTask,
  onLinkParent,
  onViewDetail,
  onSetPriority,
  onRescheduleSuccess,
}: {
  task: ScheduleTask;
  studentId: string;
  sourceDate: string;
  onComplete: (task: ScheduleTask) => void;
  onReopen: (task: ScheduleTask) => void;
  onMoveNext: (task: ScheduleTask) => void;
  onDelete: (task: TaskLike) => void;
  onDuplicate: (task: TaskLike) => void;
  onAddSubTask: (task: TaskLike, title: string) => void;
  onLinkParent: (task: TaskLike, linkedParentTaskId: string) => void;
  onViewDetail: (task: TaskLike) => void;
  onSetPriority: (task: TaskLike, next: Priority) => void;
  onRescheduleSuccess: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
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
        onReschedule={() => onRescheduleSuccess()}
        onDelete={(t) => onDelete(t)}
        onDuplicate={(t) => onDuplicate(t)}
        onAddSubTask={(t, title) => onAddSubTask(t, title)}
        onLinkParent={(t, linkedParentTaskId) =>
          onLinkParent(t, linkedParentTaskId)
        }
        onViewDetail={(t) => onViewDetail(t)}
        onSetPriority={(t, next) => onSetPriority(t, next)}
        extra={
          <Button
            size="small"
            type="link"
            aria-label="顺延到下一天"
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
        }
      />
    </div>
  );
}
