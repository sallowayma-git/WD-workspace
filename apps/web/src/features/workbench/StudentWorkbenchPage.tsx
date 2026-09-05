import { LeftOutlined, PlusOutlined, RightOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  Segmented,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { TableColumnsType } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../lib/api/ApiError";
import { StudentTaskMatrixShell } from "../../vendor/flowclass/matrix/StudentTaskMatrixShell";
import { TaskCard } from "../tasks/TaskCard";
import {
  TaskDetailDrawer,
  type TaskDetailTarget,
} from "../tasks/TaskDetailDrawer";
import { invalidateTaskViews, taskActions } from "../tasks/taskActions";
import {
  createNextSeriesTask,
  createSubTask,
  deleteTask,
  duplicateTask,
  linkMainTask,
  updateTask,
  type Priority,
  type TaskLike,
} from "../tasks/taskApi";
import { parseSeriesTitle } from "../../domain/task/seriesTitle";
import { useBusinessDate } from "../foundation/useBusinessDate";
import { InlineTaskComposer } from "../today/InlineTaskComposer";
import { convertTaskToLongTask } from "../longtasks/longTaskApi";
import {
  getWorkbench,
  type WorkbenchResponse,
  type WorkbenchStudentRow,
  type WorkbenchTask,
} from "./workbenchApi";
import {
  getWorkbenchRescheduleInput,
  type WorkbenchDragData,
  type WorkbenchDropData,
} from "./workbenchDrag";

type Density = "compact" | "expanded";

const DENSITY_CONFIG: Record<
  Density,
  { rowHeight: number; visibleTasksPerCell: number; viewportRows: number }
> = {
  // 紧凑模式:行高 96 需同时容纳 2 张任务卡片 + "+N" 提示（2×32+18+内边距），
  // 学生列两行内容也落在该高度内——行内容超高会在虚拟化行里互相重叠。
  compact: { rowHeight: 96, visibleTasksPerCell: 2, viewportRows: 6 },
  // 扩展模式:行高更大,显示更多任务详情(前 5 条)。
  // 行高需容纳 5 张任务卡片 + +N 提示(5×32+18+内边距),故放宽到 220。
  expanded: { rowHeight: 220, visibleTasksPerCell: 5, viewportRows: 3 },
};

const dayNames = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * Adapts a WorkbenchTask summary (minimal backend payload) into the shared
 * TaskCard TaskLike contract. Missing fields are defaulted; the backend
 * WorkbenchTaskSummary only emits id/shortTitle/status/version today, so we
 * synthesize safe defaults for the required TaskLike fields.
 */
function toTaskLike(task: WorkbenchTask): TaskLike {
  return {
    id: task.id,
    title: task.shortTitle ?? task.title ?? "未命名",
    shortTitle: task.shortTitle ?? task.title ?? null,
    status: task.status,
    sourceType: task.sourceType ?? "AD_HOC",
    itemOrdinal: task.itemOrdinal ?? null,
    durationMinutes: task.durationMinutes ?? null,
    locked: task.locked ?? false,
    carriedOver: task.carriedOver ?? false,
    carriedFromDate: task.carriedFromDate ?? null,
    scheduledDate: task.scheduledDate ?? null,
    version: task.version,
    parentTaskId: task.parentTaskId ?? null,
    linkedParentTaskId: task.linkedParentTaskId ?? null,
    priority: task.priority ?? null,
    sortOrder: task.sortOrder ?? null,
    star: task.star ?? false,
  };
}

export function StudentWorkbenchPage() {
  // Workbench ranges are anchored to the local machine's work date.
  const today = useBusinessDate();
  const [weekStart, setWeekStart] = useState(getWeekStart(today));
  // P2-WBK-007: 紧凑/扩展密度切换(会话内持久化)。
  const [density, setDensity] = useState<Density>("compact");
  const [studentQuery, setStudentQuery] = useState("");
  const [activeComposer, setActiveComposer] = useState<{
    studentId: string;
    date: string;
  } | null>(null);
  // MAJOR-5: read-only detail drawer; the target carries the WorkbenchTask
  // itself (it has trackId/scheduleOrigin when the adapter emits them) plus
  // the owning student's name from the matrix row.
  const [detailTarget, setDetailTarget] = useState<TaskDetailTarget | null>(
    null,
  );
  const densityConfig = DENSITY_CONFIG[density];
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  // D-1: without an explicit pointer activation constraint, PointerSensor
  // activates on pointerdown and swallows the subsequent click at the document
  // capture phase, so every click inside a matrix TaskCard (checkbox, priority
  // flag, hover delete, links) died silently. Requiring 6px of movement keeps
  // clicks clickable while drag still starts on a real drag gesture; the
  // keyboard sensor mirrors the Schedule page's accessible drag path.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  const workbenchQuery = useQuery({
    queryKey: ["workbench", weekStart],
    queryFn: () => getWorkbench(weekStart, weekEndStr),
    retry: false,
    // Tasks may be mutated from other views (Today/Schedule). Mark the cache
    // stale immediately so switching back to the workbench always refetches
    // and shows the latest state instead of a stale snapshot.
    staleTime: 0,
    refetchOnMount: true,
  });

  // Shared task actions keep the matrix aligned with Today and Schedule.
  // ACC-071: a completion in the matrix must reach Today and the calendar as
  // well. Invalidating only the workbench key left the other views to refresh
  // by accident (refetchOnMount / staleTime), so a task could read COMPLETED
  // here and PENDING there.
  const invalidate = () => void invalidateTaskViews(queryClient);

  const updateCachedTaskStatus = (taskId: string, status: string) => {
    queryClient.setQueriesData<WorkbenchResponse | undefined>(
      { queryKey: ["workbench", weekStart] },
      (previous) =>
        previous
          ? {
              ...previous,
              students: previous.students.map((row) => ({
                ...row,
                days: Object.fromEntries(
                  Object.entries(row.days).map(([date, cell]) => [
                    date,
                    {
                      ...cell,
                      tasks: cell.tasks.map((task) =>
                        task.id === taskId
                          ? { ...task, status, version: task.version + 1 }
                          : task,
                      ),
                    },
                  ]),
                ),
              })),
            }
          : previous,
    );
  };

  const beginTaskStatusMutation = async (taskId: string, status: string) => {
    await queryClient.cancelQueries({ queryKey: ["workbench", weekStart] });
    const snapshots = queryClient.getQueriesData<WorkbenchResponse>({
      queryKey: ["workbench", weekStart],
    });
    updateCachedTaskStatus(taskId, status);
    return { snapshots };
  };

  const restoreSnapshots = (
    snapshots: Array<[readonly unknown[], WorkbenchResponse | undefined]>,
  ) => {
    for (const [key, value] of snapshots) {
      queryClient.setQueryData(key, value);
    }
  };

  const completeMutation = useMutation({
    mutationFn: (task: TaskLike) =>
      taskActions.complete(task.id, task.version, crypto.randomUUID()),
    onMutate: (task) => beginTaskStatusMutation(task.id, "COMPLETED"),
    onError: (error, _task, context) => {
      if (context?.snapshots) restoreSnapshots(context.snapshots);
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "完成任务失败，请稍后重试",
      );
    },
    onSettled: invalidate,
  });

  const reopenMutation = useMutation({
    mutationFn: (task: TaskLike) =>
      taskActions.reopen(task.id, task.version, crypto.randomUUID()),
    onMutate: (task) => beginTaskStatusMutation(task.id, "PENDING"),
    onError: (error, _task, context) => {
      if (context?.snapshots) restoreSnapshots(context.snapshots);
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "重开任务失败，请稍后重试",
      );
    },
    onSettled: invalidate,
  });

  const carryForwardMutation = useMutation({
    mutationFn: (task: TaskLike) =>
      taskActions.carryForward(task.id, undefined, "MANUAL_CARRYOVER"),
    onSuccess: (result) => {
      if (result.status === "BLOCKED") {
        void message.warning(result.reason ?? "90 天内没有可用学习日");
        return;
      }
      void message.success(`已顺延至 ${result.targetDate ?? "下一学习日"}`);
    },
    onError: (error) => {
      void message.error(
        error instanceof ApiError ? error.message : "顺延失败，请稍后重试",
      );
    },
    onSettled: () => {
      void invalidateTaskViews(queryClient);
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (task: TaskLike) => deleteTask(task.id, task.version),
    onSuccess: () => void message.success("已删除任务"),
    onError: (error) => {
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "删除任务失败，请稍后重试",
      );
    },
    onSettled: invalidate,
  });

  const duplicateTaskMutation = useMutation({
    mutationFn: (task: TaskLike) =>
      duplicateTask(task.id, { expectedVersion: task.version }),
    onSuccess: () => void message.success("已复制任务"),
    onError: (error) => {
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "复制任务失败，请稍后重试",
      );
    },
    onSettled: invalidate,
  });

  // 系列推进：右键“生成下一项”创建“序号+1、排到下一天”的新任务。
  const createNextSeriesMutation = useMutation({
    mutationFn: (task: TaskLike) =>
      createNextSeriesTask(task.id, { expectedVersion: task.version }),
    onSuccess: (created) => {
      void message.success(
        `已生成「${created.titleSnapshot}」，排在 ${created.scheduledDate ?? "下一天"}`,
      );
    },
    onError: (error) => {
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "生成下一项失败，请稍后重试",
      );
    },
    onSettled: invalidate,
  });

  // 右键“设为长期任务”：普通任务原地升级为长期任务轨道的当前项，完成后续项
  // 由轨道按标题模板自动接排；历史任务不回填。
  const convertToLongTaskMutation = useMutation({
    mutationFn: (task: TaskLike) =>
      convertTaskToLongTask(task.id, { expectedVersion: task.version }),
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
    onSettled: invalidate,
  });

  const createSubTaskMutation = useMutation({
    mutationFn: (params: { task: TaskLike; title: string }) =>
      createSubTask(params.task.id, { title: params.title }),
    onSuccess: () => void message.success("已添加子任务"),
    onError: (error) => {
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "添加子任务失败，请稍后重试",
      );
    },
    onSettled: invalidate,
  });

  const linkMainTaskMutation = useMutation({
    mutationFn: (params: { task: TaskLike; linkedParentTaskId: string }) =>
      linkMainTask(
        params.task.id,
        params.task.version,
        params.linkedParentTaskId,
      ),
    onSuccess: () => void message.success("已关联主任务"),
    onError: (error) => {
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "关联主任务失败，请稍后重试",
      );
    },
    onSettled: invalidate,
  });

  const updateTaskMutation = useMutation({
    mutationFn: (params: { task: TaskLike; priority?: Priority }) =>
      updateTask(params.task.id, {
        expectedVersion: params.task.version,
        priority: params.priority,
      }),
    onMutate: async (params) => {
      // Optimistic update: flip the star/priority in the cached workbench
      // grid so the icon responds immediately; roll back on error. The
      // workbench cache nests tasks under students[].days[date].tasks, so
      // we patch the matching task across every cached window (mirrors
      // TodayPage's updateTaskMutation pattern).
      await queryClient.cancelQueries({ queryKey: ["workbench", weekStart] });
      const snapshots = queryClient.getQueriesData<WorkbenchResponse>({
        queryKey: ["workbench", weekStart],
      });
      queryClient.setQueriesData<WorkbenchResponse | undefined>(
        { queryKey: ["workbench", weekStart] },
        (prev) =>
          prev
            ? {
                ...prev,
                students: prev.students.map((row) => ({
                  ...row,
                  days: Object.fromEntries(
                    Object.entries(row.days).map(([date, cell]) => [
                      date,
                      {
                        ...cell,
                        tasks: cell.tasks.map((task) =>
                          task.id === params.task.id
                            ? {
                                ...task,
                                priority:
                                  params.priority ?? task.priority ?? null,
                              }
                            : task,
                        ),
                      },
                    ]),
                  ),
                })),
              }
            : prev,
      );
      return { snapshots };
    },
    onError: (error, _params, context) => {
      if (context?.snapshots) {
        for (const [key, data] of context.snapshots) {
          queryClient.setQueryData(key, data);
        }
      }
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "更新任务失败，请稍后重试",
      );
    },
    onSettled: invalidate,
  });

  const rescheduleMutation = useMutation({
    mutationFn: (params: {
      taskId: string;
      version: number;
      targetDate: string;
      targetStudentId: string;
    }) =>
      taskActions.reschedule(
        params.taskId,
        params.version,
        params.targetDate,
        undefined,
        params.targetStudentId,
      ),
    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: ["workbench"] });
      const snapshots = queryClient.getQueriesData<WorkbenchResponse>({
        queryKey: ["workbench"],
      });
      queryClient.setQueriesData<WorkbenchResponse | undefined>(
        { queryKey: ["workbench"] },
        (previous) => {
          if (!previous) return previous;
          let moved: WorkbenchTask | undefined;
          const students = previous.students.map((row) => {
            const days = Object.fromEntries(
              Object.entries(row.days).map(([date, cell]) => {
                const tasks = cell.tasks.filter((task) => {
                  if (task.id !== params.taskId) return true;
                  moved = task;
                  return false;
                });
                return [date, { ...cell, tasks }];
              }),
            );
            return { ...row, days };
          });
          if (!moved) return previous;
          const target = students.find(
            (row) => row.id === params.targetStudentId,
          );
          if (!target) return previous;
          const targetCell = target.days[params.targetDate] ?? {
            date: params.targetDate,
            available: true,
            availableMinutes: 0,
            tasks: [],
          };
          target.days[params.targetDate] = {
            ...targetCell,
            tasks: [
              ...targetCell.tasks,
              {
                ...moved,
                scheduledDate: params.targetDate,
                version: moved.version + 1,
              },
            ],
          };
          return { ...previous, students };
        },
      );
      return { snapshots };
    },
    onSuccess: () => void message.success("排期已更新"),
    onError: (error, _params, context) => {
      if (context?.snapshots) restoreSnapshots(context.snapshots);
      void message.error(
        error instanceof ApiError ? error.message : "排期更新失败，请稍后重试",
      );
    },
    onSettled: invalidate,
  });

  const handleWorkbenchDragEnd = (event: DragEndEvent) => {
    const input = getWorkbenchRescheduleInput(event);
    if (input) rescheduleMutation.mutate(input);
  };

  const shiftWeek = (days: number) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + days);
    setWeekStart(date.toISOString().slice(0, 10));
  };

  if (workbenchQuery.isPending) {
    return (
      <Card title="学生工作台">
        <Skeleton active paragraph={{ rows: 8 }} />
      </Card>
    );
  }

  if (workbenchQuery.isError) {
    const error = workbenchQuery.error;
    return (
      <Card title="学生工作台">
        <Alert
          type="error"
          title="工作台暂不可用"
          showIcon
          description={
            error instanceof ApiError
              ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
              : "请检查本地数据文件后重试。"
          }
          action={
            <Button type="link" onClick={() => void workbenchQuery.refetch()}>
              重试
            </Button>
          }
        />
      </Card>
    );
  }

  const data = workbenchQuery.data;
  const normalizedQuery = studentQuery.trim().toLocaleLowerCase();
  const filteredStudents = normalizedQuery
    ? data.students.filter((row) =>
        [
          row.name,
          row.code,
          row.devicePolicy,
          ...row.tags.flatMap((tag) => [tag.code, tag.name]),
        ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
      )
    : data.students;
  const dates: string[] = [];
  const start = new Date(data.range.from);
  const end = new Date(data.range.to);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }

  const ROW_HEIGHT = densityConfig.rowHeight;
  const visibleTasks = densityConfig.visibleTasksPerCell;

  const columns: TableColumnsType<WorkbenchStudentRow> = [
    {
      title: "学生",
      key: "student",
      fixed: "left",
      width: 180,
      render: (_v: unknown, row: WorkbenchStudentRow) => (
        // 学生列必须控制在行高内（紧凑 96px）：两行结构——第一行姓名+设备
        // 策略，第二行编号+入口。此前四行内容（含标签行）超高导致相邻
        // 行视觉重叠；学生标签只在扩展模式下展示。
        <Space direction="vertical" size={0}>
          <Space size={4} wrap={false} align="center">
            <Link
              to={`/students/${row.id}/profile`}
              aria-label={`打开 ${row.name} 资料`}
            >
              {row.name}
            </Link>
            <Tag color="blue" style={{ marginInlineEnd: 0 }}>
              {formatDevicePolicy(row.devicePolicy)}
            </Tag>
          </Space>
          <Space size={4} wrap={false}>
            <Typography.Text type="secondary">{row.code}</Typography.Text>
            <Link
              to={`/students/${row.id}/vocabulary`}
              aria-label={`${row.name} 生词本`}
            >
              生词本({row.vocabularyCountThisWeek})
            </Link>
            <Link
              to={`/students/${row.id}/schedule`}
              aria-label={`${row.name} 排期`}
            >
              排期
            </Link>
          </Space>
          {density === "expanded" && row.tags.length > 0 ? (
            <Space size={4} wrap>
              {row.tags.slice(0, 3).map((tag) => (
                <Tag key={tag.code}>{tag.name}</Tag>
              ))}
            </Space>
          ) : null}
        </Space>
      ),
    },
    ...dates.map((date) => ({
      title: formatDateHeader(date),
      key: date,
      width: 160,
      onHeaderCell: () => ({
        // P2-WBK-UI: 日期表头也加竖向分隔线,与 body 单元格的 borderRight
        // 对齐,避免表头日期与下方任务列错位造成认知困难。
        style: {
          borderRight: "1px solid var(--ant-color-border-secondary, #f0f0f0)",
        },
      }),
      onCell: () => ({
        // P2-WBK-UI: 日期列之间的竖向分隔线,从表头延伸到行底,
        // 让 7 个日期列在视觉上彼此分开。
        style: {
          borderRight: "1px solid var(--ant-color-border-secondary, #f0f0f0)",
        },
      }),
      render: (_v: unknown, row: WorkbenchStudentRow) => {
        const cell = row.days[date];
        let content: ReactNode;
        if (!cell || cell.tasks.length === 0) {
          const composerOpen =
            activeComposer?.studentId === row.id &&
            activeComposer.date === date;
          content = composerOpen ? (
            <div style={{ padding: "2px 4px" }}>
              <InlineTaskComposer
                studentId={row.id}
                studentName={row.name}
                scheduledDate={date}
                onCreated={async () => {
                  setActiveComposer(null);
                  await invalidateTaskViews(queryClient);
                }}
              />
            </div>
          ) : (
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              aria-label={`为 ${row.name} 在 ${date} 添加任务`}
              onClick={() => setActiveComposer({ studentId: row.id, date })}
            />
          );
        } else {
          content = (
            <Space
              direction="vertical"
              size={2}
              style={{ width: "100%", padding: "2px 4px" }}
            >
              {cell.tasks.slice(0, visibleTasks).map((task: WorkbenchTask) => {
                const taskLike = toTaskLike(task);
                return (
                  <WorkbenchDraggableTask
                    key={task.id}
                    task={task}
                    sourceStudentId={row.id}
                    sourceDate={date}
                    density={density}
                  >
                    <TaskCard
                      task={taskLike}
                      density={density}
                      onComplete={(t) => completeMutation.mutate(t)}
                      onReopen={(t) => reopenMutation.mutate(t)}
                      onReschedule={() => invalidate()}
                      onCarryForward={(t) => carryForwardMutation.mutate(t)}
                      onDelete={(t) => deleteTaskMutation.mutate(t)}
                      onDuplicate={(t) => duplicateTaskMutation.mutate(t)}
                      // 仅手工/导入的编号任务提供“生成下一项”；TRACK 任务的
                      // 下一项由轨道完成时自动推进。
                      onCreateNext={
                        taskLike.sourceType !== "TRACK" &&
                        parseSeriesTitle(taskLike.title)
                          ? (t) => createNextSeriesMutation.mutate(t)
                          : undefined
                      }
                      onConvertToLongTask={
                        taskLike.sourceType === "AD_HOC" &&
                        taskLike.status === "PENDING" &&
                        !taskLike.locked
                          ? (t) => convertToLongTaskMutation.mutate(t)
                          : undefined
                      }
                      onAddSubTask={(t, title) =>
                        createSubTaskMutation.mutate({ task: t, title })
                      }
                      onLinkParent={(t, linkedParentTaskId) =>
                        linkMainTaskMutation.mutate({
                          task: t,
                          linkedParentTaskId,
                        })
                      }
                      onViewDetail={() =>
                        // taskLike fills the required TaskLike fields the raw
                        // WorkbenchTask leaves nullable (title/sourceType);
                        // trackId is the one detail field WorkbenchTask
                        // carries beyond the TaskCard projection.
                        setDetailTarget({
                          task: { ...taskLike, trackId: task.trackId ?? null },
                          studentName: row.name,
                        })
                      }
                      onSetPriority={(t, next) =>
                        updateTaskMutation.mutate({ task: t, priority: next })
                      }
                    />
                  </WorkbenchDraggableTask>
                );
              })}
              {cell.tasks.length > visibleTasks ? (
                <Typography.Text type="secondary">
                  +{cell.tasks.length - visibleTasks}
                </Typography.Text>
              ) : null}
            </Space>
          );
        }
        return (
          <WorkbenchDroppableCell
            studentId={row.id}
            date={date}
            available={cell?.available ?? true}
          >
            {content}
          </WorkbenchDroppableCell>
        );
      },
    })),
  ];

  return (
    <Card
      title="学生工作台"
      extra={
        <Space wrap>
          <Input.Search
            allowClear
            value={studentQuery}
            placeholder="搜索学生"
            aria-label="搜索学生"
            style={{ width: 180 }}
            onChange={(event) => setStudentQuery(event.target.value)}
          />
          <Segmented<Density>
            value={density}
            onChange={(val) => setDensity(val)}
            options={[
              { label: "紧凑", value: "compact" },
              { label: "扩展", value: "expanded" },
            ]}
            aria-label="密度切换"
          />
          <Button icon={<LeftOutlined />} onClick={() => shiftWeek(-7)}>
            上一周
          </Button>
          <Typography.Text>
            {data.range.from} ~ {data.range.to}
          </Typography.Text>
          <Button onClick={() => shiftWeek(7)}>
            下一周
            <RightOutlined />
          </Button>
          {weekStart !== getWeekStart(today) ? (
            <Button
              type="link"
              onClick={() => setWeekStart(getWeekStart(today))}
            >
              回到本周
            </Button>
          ) : null}
        </Space>
      }
    >
      {data.students.length === 0 ? (
        <Empty description="没有活跃学生" />
      ) : filteredStudents.length === 0 ? (
        <Empty description="没有匹配的学生" />
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleWorkbenchDragEnd}>
          <StudentTaskMatrixShell
            columns={columns}
            data={filteredStudents}
            rowHeight={ROW_HEIGHT}
            viewportRows={densityConfig.viewportRows}
          />
        </DndContext>
      )}
      <TaskDetailDrawer
        target={detailTarget}
        onClose={() => setDetailTarget(null)}
      />
    </Card>
  );
}

function formatDevicePolicy(policy: string): string {
  switch (policy) {
    case "ALLOWED":
      return "可用设备";
    case "NOT_ALLOWED":
      return "禁用设备";
    case "CONFIRM":
      return "设备需确认";
    default:
      return policy;
  }
}

function getWeekStart(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date.toISOString().slice(0, 10);
}

function formatDateHeader(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()} ${dayNames[date.getDay()]}`;
}

function WorkbenchDroppableCell({
  studentId,
  date,
  available,
  children,
}: {
  studentId: string;
  date: string;
  available: boolean;
  children: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `workbench-cell:${studentId}:${date}`,
    data: {
      targetStudentId: studentId,
      targetDate: date,
      available,
    } satisfies WorkbenchDropData,
  });
  return (
    <div
      ref={setNodeRef}
      data-droppable-student-id={studentId}
      data-droppable-date={date}
      style={{
        width: "100%",
        minHeight: "100%",
        background: isOver ? "rgba(22,119,255,0.08)" : undefined,
      }}
    >
      {children}
    </div>
  );
}

function WorkbenchDraggableTask({
  task,
  sourceStudentId,
  sourceDate,
  density,
  children,
}: {
  task: WorkbenchTask;
  sourceStudentId: string;
  sourceDate: string;
  density: Density;
  children: ReactNode;
}) {
  const immovable = task.locked === true || task.carriedOver === true;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `workbench-task:${task.id}`,
    disabled: immovable,
    data: {
      taskId: task.id,
      sourceStudentId,
      sourceDate,
      version: task.version,
      locked: task.locked ?? false,
      carriedOver: task.carriedOver ?? false,
      trackId: task.trackId ?? null,
      sourceType: task.sourceType ?? "AD_HOC",
      title: task.shortTitle ?? task.title ?? "未命名",
    } satisfies WorkbenchDragData,
  });
  void density;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-task-drag-id={task.id}
      data-task-draggable={immovable ? "false" : "true"}
      style={{ width: "100%", opacity: isDragging ? 0.4 : 1 }}
    >
      {children}
    </div>
  );
}
