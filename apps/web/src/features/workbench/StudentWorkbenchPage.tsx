import {
  EditOutlined,
  LeftOutlined,
  MoreOutlined,
  PlusOutlined,
  RightOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Dropdown,
  Empty,
  Input,
  Modal,
  Popover,
  Segmented,
  Select,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
  DatePicker,
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
import type { MenuProps, TableColumnsType } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import dayjs, { type Dayjs } from "dayjs";
import { Link, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { ApiError } from "../../lib/api/ApiError";
import { StudentTaskMatrixShell } from "../../vendor/flowclass/matrix/StudentTaskMatrixShell";
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
import { useBusinessDate } from "../foundation/useBusinessDate";
import { InlineTaskComposer } from "../today/InlineTaskComposer";
import { convertTaskToLongTask } from "../longtasks/longTaskApi";
import {
  getWorkbench,
  type WorkbenchResponse,
  type WorkbenchStudentRow,
  type WorkbenchTask,
} from "./workbenchApi";
import { exportWorkbenchExcel } from "./exportWorkbenchExcel";
import { copyableDayTasks, formatDayTasksForCopy } from "./copyDayTasks";
import { getDataAdapter } from "../../data/runtime";
import { getPlatformAdapter } from "../../lib/platform/runtimePlatformAdapter";
import { setStudentRestDay } from "../students/availabilityApi";
import {
  archiveStudent,
  createStudentStatusLabel,
  deleteStudentStatusLabel,
  getArchiveImpact,
  listStudents,
  listStudentStatusLabels,
  updateStudentCard,
  updateStudentStatusLabel,
  type StudentStatusLabel,
} from "../students/studentApi";
import { StudentStatusLabelModal } from "../students/StudentStatusLabelModal";
import {
  resolveWorkbenchDrop,
  type WorkbenchDragData,
  type WorkbenchDropData,
} from "./workbenchDrag";

type Density = "compact" | "expanded";

const DENSITY_CONFIG: Record<
  Density,
  { estimatedRowHeight: number; studentWidth: number; dateWidth: number }
> = {
  compact: { estimatedRowHeight: 96, studentWidth: 180, dateWidth: 160 },
  expanded: { estimatedRowHeight: 160, studentWidth: 240, dateWidth: 240 },
};

const dayNames = ["日", "一", "二", "三", "四", "五", "六"];

function WorkbenchStudentCard({
  row,
  weekStart,
}: {
  row: WorkbenchStudentRow;
  weekStart: string;
}) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [statusLabelsOpen, setStatusLabelsOpen] = useState(false);
  const [draft, setDraft] = useState({
    statusLabelId: row.statusLabel?.id ?? null,
    classType: row.classType ?? "",
    examDate: row.examDate ?? "",
    note: row.note ?? "",
  });
  const labelsQuery = useQuery({
    queryKey: ["student-status-labels"],
    queryFn: listStudentStatusLabels,
    staleTime: 30_000,
  });
  const updateMutation = useMutation({
    mutationFn: () =>
      updateStudentCard(row.id, {
        statusLabelId: draft.statusLabelId,
        classType: draft.classType.trim() || null,
        examDate: draft.examDate || null,
        note: draft.note.trim() || null,
        expectedVersion: row.version ?? 0,
      }),
    onSuccess: async () => {
      setEditing(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workbench"] }),
        queryClient.invalidateQueries({ queryKey: ["students"] }),
      ]);
    },
    onError: (error: Error) => void message.error(error.message),
  });
  const statusLabelsMutation = useMutation({
    mutationFn: async (
      drafts: Array<{
        id?: string;
        label: string;
        color: string | null;
        sortOrder: number;
      }>,
    ) =>
      Promise.all(
        drafts.map((draft) =>
          draft.id
            ? updateStudentStatusLabel(draft.id, draft)
            : createStudentStatusLabel(draft),
        ),
      ),
    onSuccess: async () => {
      setStatusLabelsOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["student-status-labels"] }),
        queryClient.invalidateQueries({ queryKey: ["workbench"] }),
      ]);
    },
    onError: (error: Error) => void message.error(error.message),
  });
  const archiveMutation = useMutation({
    mutationFn: () => archiveStudent(row.id, row.version ?? 0),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workbench"] }),
        queryClient.invalidateQueries({ queryKey: ["students"] }),
        invalidateTaskViews(queryClient),
      ]);
      void message.success("学生已归档");
    },
    onError: (error: Error) => void message.error(error.message),
  });
  const requestArchive = async () => {
    try {
      const impact = await getArchiveImpact(row.id);
      const names = impact.definitions
        .map((item) => `“${item.name}”`)
        .join("、");
      modal.confirm({
        title: `归档 ${row.name}？`,
        content: `将取消 ${impact.pendingTaskCount} 条待办、暂停 ${impact.tracks.length} 个长期任务${names ? `，其中 ${names} 仅该生使用，将一并归档` : ""}。`,
        okText: "确认归档",
        okButtonProps: { danger: true },
        cancelText: "取消",
        onOk: () => archiveMutation.mutateAsync(),
      });
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : "无法读取归档影响",
      );
    }
  };
  const examSummary = (() => {
    if (!row.examDate) return null;
    const days = dayjs(row.examDate)
      .startOf("day")
      .diff(dayjs().startOf("day"), "day");
    return `${dayjs(row.examDate).format("M/D")}（${days < 0 ? "已考" : `还剩 ${days} 天`}）`;
  })();

  const editor = (
    <Space orientation="vertical" style={{ width: 280 }}>
      <Select
        aria-label="紧急状态"
        value={draft.statusLabelId ?? ""}
        style={{ width: "100%" }}
        options={[
          { value: "", label: "不紧急" },
          ...(labelsQuery.data ?? []).map((label) => ({
            value: label.id,
            label: label.label,
          })),
        ]}
        onChange={(value) =>
          setDraft((previous) => ({
            ...previous,
            statusLabelId: value || null,
          }))
        }
      />
      <Button
        type="link"
        style={{ alignSelf: "flex-start", paddingInline: 0 }}
        onClick={() => setStatusLabelsOpen(true)}
      >
        管理状态…
      </Button>
      <Input
        aria-label="班级/班型"
        placeholder="班级/班型"
        value={draft.classType}
        onChange={(event) =>
          setDraft((previous) => ({
            ...previous,
            classType: event.target.value,
          }))
        }
      />
      <Input
        aria-label="考试日期"
        type="date"
        value={draft.examDate}
        onChange={(event) =>
          setDraft((previous) => ({
            ...previous,
            examDate: event.target.value,
          }))
        }
      />
      <Input.TextArea
        aria-label="备注"
        placeholder="备注"
        rows={3}
        value={draft.note}
        onChange={(event) =>
          setDraft((previous) => ({ ...previous, note: event.target.value }))
        }
      />
      <Button
        type="primary"
        loading={updateMutation.isPending}
        onClick={() => updateMutation.mutate()}
      >
        保存
      </Button>
    </Space>
  );

  return (
    <>
      <div
        style={{
          padding: 6,
          borderRadius: 6,
          boxShadow: row.statusLabel?.color
            ? `inset 0 0 0 2px ${row.statusLabel.color}`
            : undefined,
        }}
      >
        <Space orientation="vertical" size={1} style={{ width: "100%" }}>
          <Space size={4} wrap={false} style={{ width: "100%" }}>
            <Link to={`/students/${row.id}/profile`}>{row.name}</Link>
            <Tag
              color={row.statusLabel?.color ?? undefined}
              style={{ marginInlineEnd: 0 }}
            >
              {row.statusLabel?.label ?? "不紧急"}
            </Tag>
            <Popover
              open={editing}
              onOpenChange={setEditing}
              trigger="click"
              content={editor}
              title="编辑学生卡片"
            >
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                aria-label={`编辑 ${row.name}`}
              />
            </Popover>
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  {
                    key: "vocabulary",
                    label: (
                      <Link to={`/students/${row.id}/vocabulary`}>生词本</Link>
                    ),
                  },
                  {
                    key: "schedule",
                    label: (
                      <Link
                        to={`/students/${row.id}/schedule?${new URLSearchParams({ date: weekStart })}`}
                      >
                        排期
                      </Link>
                    ),
                  },
                  { type: "divider" },
                  {
                    key: "archive",
                    danger: true,
                    label: "归档学生",
                    onClick: () => void requestArchive(),
                  },
                ],
              }}
            >
              <Button
                type="text"
                size="small"
                icon={<MoreOutlined />}
                aria-label={`${row.name} 更多操作`}
              />
            </Dropdown>
          </Space>
          {(row.classType || examSummary) && (
            <Typography.Text type="secondary">
              {[row.classType, examSummary].filter(Boolean).join(" · ")}
            </Typography.Text>
          )}
          {row.note ? (
            <Tooltip title={row.note}>
              <Typography.Text ellipsis style={{ maxWidth: "100%" }}>
                {row.note}
              </Typography.Text>
            </Tooltip>
          ) : null}
        </Space>
      </div>
      <StudentStatusLabelModal
        open={statusLabelsOpen}
        labels={labelsQuery.data ?? []}
        confirmLoading={statusLabelsMutation.isPending}
        onCancel={() => setStatusLabelsOpen(false)}
        onSubmit={(labels) => statusLabelsMutation.mutate(labels)}
        onDelete={async (label: StudentStatusLabel) => {
          await deleteStudentStatusLabel(label.id);
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: ["student-status-labels"],
            }),
            queryClient.invalidateQueries({ queryKey: ["workbench"] }),
            queryClient.invalidateQueries({ queryKey: ["students"] }),
          ]);
        }}
      />
    </>
  );
}

/**
 * Adapts a WorkbenchTask summary (minimal backend payload) into the shared
 * TaskCard TaskLike contract. Missing fields are defaulted; the backend
 * WorkbenchTaskSummary only emits id/shortTitle/status/version today, so we
 * synthesize safe defaults for the required TaskLike fields.
 */
function toTaskLike(task: WorkbenchTask): TaskLike {
  return {
    id: task.id,
    title: task.title ?? task.shortTitle ?? "未命名",
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
  const [searchParams, setSearchParams] = useSearchParams();
  const weekStart = getWeekStart(
    z.iso.date().safeParse(searchParams.get("week") ?? searchParams.get("date"))
      .data ?? today,
  );
  const setWeekStart = (week: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("week", week);
    setSearchParams(next, { replace: true });
  };
  // P2-WBK-007: 紧凑/扩展密度切换(会话内持久化)。
  const [density, setDensity] = useState<Density>("compact");
  const densityConfig = DENSITY_CONFIG[density];
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    () => ({
      index: 48,
      student: densityConfig.studentWidth,
      ...Object.fromEntries(
        Array.from({ length: 7 }, (_, index) => [
          `dow-${index + 1}`,
          densityConfig.dateWidth,
        ]),
      ),
    }),
  );
  const [manualColumnKeys, setManualColumnKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const saveColumnWidthsTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === "undefined"
      ? 400
      : Math.max(400, window.innerHeight - 300),
  );
  useEffect(() => {
    const updateViewportHeight = () =>
      setViewportHeight(Math.max(400, window.innerHeight - 300));
    updateViewportHeight();
    window.addEventListener("resize", updateViewportHeight);
    return () => window.removeEventListener("resize", updateViewportHeight);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const key = `ui.workbench.colWidths.${density}`;
    const defaults = {
      index: 48,
      student: densityConfig.studentWidth,
      ...Object.fromEntries(
        Array.from({ length: 7 }, (_, index) => [
          `dow-${index + 1}`,
          densityConfig.dateWidth,
        ]),
      ),
    };
    // Defer the reset one microtask so density changes do not synchronously
    // cascade a render from inside the effect body.
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setColumnWidths(defaults);
      setManualColumnKeys(new Set());
    });
    const adapter = getDataAdapter();
    if (typeof adapter.getAppSetting !== "function") return;
    void adapter
      .getAppSetting(key)
      .then((value) => {
        if (cancelled || typeof value !== "string") return;
        try {
          const parsed = JSON.parse(value) as Record<string, unknown>;
          const valid = Object.fromEntries(
            Object.entries(parsed).filter(([columnKey, width]) =>
              columnKey === "student" || columnKey.startsWith("dow-")
                ? typeof width === "number" && Number.isFinite(width)
                : false,
            ),
          ) as Record<string, number>;
          setColumnWidths((previous) => ({ ...previous, ...valid }));
          setManualColumnKeys(new Set(Object.keys(valid)));
        } catch {
          // Ignore malformed preferences and continue with density defaults.
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [density, densityConfig.dateWidth, densityConfig.studentWidth]);
  const handleColumnResize = (key: string, width: number) => {
    const nextWidth = Math.min(600, Math.max(100, Math.round(width)));
    setColumnWidths((previous) => {
      const next = { ...previous, [key]: nextWidth };
      if (saveColumnWidthsTimer.current) {
        clearTimeout(saveColumnWidthsTimer.current);
      }
      saveColumnWidthsTimer.current = setTimeout(() => {
        const values = Object.fromEntries(
          Object.entries(next).filter(
            ([columnKey]) =>
              columnKey === "student" || columnKey.startsWith("dow-"),
          ),
        );
        const adapter = getDataAdapter();
        if (typeof adapter.putAppSetting === "function") {
          void adapter.putAppSetting(
            `ui.workbench.colWidths.${density}`,
            JSON.stringify(values),
          );
        }
      }, 500);
      return next;
    });
    setManualColumnKeys((previous) => {
      const next = new Set(previous);
      if (key !== "index") next.add(key);
      return next;
    });
  };
  const studentQuery = searchParams.get("search") ?? "";
  const setStudentQuery = (search: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("week", weekStart);
    if (search) next.set("search", search);
    else next.delete("search");
    setSearchParams(next, { replace: true });
  };
  const [activeComposer, setActiveComposer] = useState<{
    studentId: string;
    date: string;
  } | null>(null);
  const [exportRangeOpen, setExportRangeOpen] = useState(false);
  const [exportRange, setExportRange] = useState<[string, string]>([
    weekStart,
    weekStart,
  ]);
  const [exporting, setExporting] = useState(false);
  // MAJOR-5: read-only detail drawer; the target carries the WorkbenchTask
  // itself (it has trackId/scheduleOrigin when the adapter emits them) plus
  // the owning student's name from the matrix row.
  const [detailTarget, setDetailTarget] = useState<TaskDetailTarget | null>(
    null,
  );
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { offerSeriesSuggestion } = useSeriesSuggestion();

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

  const openExportRange = () => {
    setExportRange([weekStart, weekEndStr]);
    setExportRangeOpen(true);
  };

  const runExport = async () => {
    setExporting(true);
    try {
      const response = await getWorkbench(exportRange[0], exportRange[1]);
      await exportWorkbenchExcel(response);
      void message.success("已导出 Excel");
      setExportRangeOpen(false);
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const restDayMutation = useMutation({
    mutationFn: (input: { studentId: string; date: string; rest: boolean }) =>
      setStudentRestDay(input.studentId, input.date, input.rest),
    onSuccess: (result, input) => {
      const targets = result.targetDates.join("、");
      if (input.rest) {
        void message.success(
          `已标记休息，${result.moved} 个任务移到 ${targets || "下一学习日"}` +
            (result.lockedSkipped
              ? `；${result.lockedSkipped} 个锁定任务未移动`
              : "") +
            (result.blocked ? `；${result.blocked} 个任务暂无可学习日` : ""),
        );
      } else {
        void message.success("已取消休息日");
      }
    },
    onError: (error) => {
      void message.error(
        error instanceof Error ? error.message : "更新休息日失败",
      );
    },
    onSettled: () => invalidate(),
  });

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
  const archivedSearchQuery = useQuery({
    queryKey: ["students", "archived-search", studentQuery],
    queryFn: () => listStudents(studentQuery),
    enabled: studentQuery.trim().length > 0,
    retry: false,
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
    onSuccess: (result) => {
      // 任务已完成，只是轨道没接上下一项：警告而不是报错。
      if (result.chainWarning) void message.warning(result.chainWarning);
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

  // 系列推进：右键“继续这个系列”创建“序号+1、排到下一个可学习日”的新任务。
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
    onSettled: invalidate,
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
    onSettled: invalidate,
  });

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
    const outcome = resolveWorkbenchDrop(event);
    if (outcome.kind === "reschedule") rescheduleMutation.mutate(outcome.input);
    else if (outcome.kind === "refuse") void message.warning(outcome.reason);
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
  const archivedMatchCount =
    archivedSearchQuery.data?.items.filter(
      (student) => student.status === "ARCHIVED",
    ).length ?? 0;
  const dates: string[] = [];
  const start = new Date(data.range.from);
  const end = new Date(data.range.to);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }

  const columns: TableColumnsType<WorkbenchStudentRow> = [
    {
      title: "序号",
      key: "row-number",
      fixed: "left",
      width: 48,
      render: (_v: unknown, _row: WorkbenchStudentRow, index: number) =>
        index + 1,
    },
    {
      title: "学生",
      key: "student",
      fixed: "left",
      width: columnWidths.student ?? densityConfig.studentWidth,
      render: (_v: unknown, row: WorkbenchStudentRow) => (
        <WorkbenchStudentCard row={row} weekStart={weekStart} />
      ),
    },
    ...dates.map((date, dateIndex) => ({
      title: formatDateHeader(date),
      key: `dow-${dateIndex + 1}`,
      width: columnWidths[`dow-${dateIndex + 1}`] ?? densityConfig.dateWidth,
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
        const composerOpen =
          activeComposer?.studentId === row.id && activeComposer.date === date;
        const cellMenuItems: MenuProps["items"] = [
          {
            key: "copy-day-tasks",
            label: "复制当天作业",
            disabled: copyableDayTasks(cell?.tasks ?? []).length === 0,
            onClick: () => {
              void getPlatformAdapter()
                .copyText(formatDayTasksForCopy(date, cell?.tasks ?? []))
                .then(() => message.success("已复制"))
                .catch((error: unknown) =>
                  message.error(
                    error instanceof Error ? error.message : "复制失败",
                  ),
                );
            },
          },
          { type: "divider" },
          {
            key: "toggle-rest-day",
            label: cell?.available === false ? "取消休息日" : "标记为休息日",
            onClick: () =>
              restDayMutation.mutate({
                studentId: row.id,
                date,
                rest: cell?.available !== false,
              }),
          },
        ];
        if (composerOpen) {
          content = (
            <div style={{ padding: "2px 4px" }}>
              <InlineTaskComposer
                studentId={row.id}
                studentName={row.name}
                scheduledDate={date}
                commitOnBlur
                onCancel={() => setActiveComposer(null)}
                onCreated={async () => {
                  setActiveComposer(null);
                  await invalidateTaskViews(queryClient);
                }}
              />
            </div>
          );
        } else if (!cell || cell.tasks.length === 0) {
          content = (
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
              {cell.tasks.map((task: WorkbenchTask) => {
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
                      onCreateNext={
                        taskLike.sourceType !== "TRACK" &&
                        parseSeriesTitleCandidates(taskLike.title).length > 0
                          ? (t, numberIndex) =>
                              createNextSeriesMutation.mutate({
                                task: t,
                                numberIndex,
                              })
                          : undefined
                      }
                      onConvertToLongTask={
                        taskLike.sourceType === "AD_HOC" &&
                        taskLike.status === "PENDING" &&
                        !taskLike.locked
                          ? (t, numberIndex) =>
                              convertToLongTaskMutation.mutate({
                                task: t,
                                numberIndex,
                              })
                          : undefined
                      }
                      onRename={(t, title) =>
                        updateTaskMutation.mutate({ task: t, title })
                      }
                      cellMenuItems={cellMenuItems}
                      onViewDetail={() =>
                        setDetailTarget({
                          task: {
                            ...taskLike,
                            trackId: task.trackId ?? null,
                            note: task.note,
                          },
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
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                aria-label={`为 ${row.name} 在 ${date} 添加任务`}
                onClick={() => setActiveComposer({ studentId: row.id, date })}
              />
            </Space>
          );
        }
        return (
          <Dropdown trigger={["contextMenu"]} menu={{ items: cellMenuItems }}>
            <WorkbenchDroppableCell
              studentId={row.id}
              date={date}
              available={cell?.available ?? true}
            >
              {content}
            </WorkbenchDroppableCell>
          </Dropdown>
        );
      },
    })),
  ];

  return (
    <Card
      title={`学生工作台 · 共 ${filteredStudents.length} 人`}
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
          <Button onClick={openExportRange}>导出 Excel</Button>
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
      {filteredStudents.length === 0 ? (
        <Empty
          description={
            archivedMatchCount > 0 ? (
              <Space orientation="vertical" size={2}>
                <span>在已归档学生中找到 {archivedMatchCount} 个</span>
                <Link
                  to={`/students?${new URLSearchParams({ status: "ARCHIVED", search: studentQuery })}`}
                >
                  查看已归档学生
                </Link>
              </Space>
            ) : normalizedQuery ? (
              "没有匹配的学生"
            ) : (
              "没有活跃学生"
            )
          }
        />
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleWorkbenchDragEnd}>
          <StudentTaskMatrixShell
            columns={columns}
            data={filteredStudents}
            estimatedRowHeight={densityConfig.estimatedRowHeight}
            viewportHeight={viewportHeight}
            manualColumnKeys={manualColumnKeys}
            onColumnResize={handleColumnResize}
          />
        </DndContext>
      )}
      <TaskDetailDrawer
        target={detailTarget}
        onClose={() => setDetailTarget(null)}
      />
      <Modal
        open={exportRangeOpen}
        title="导出 Excel"
        okText="导出"
        cancelText="取消"
        confirmLoading={exporting}
        onOk={() => void runExport()}
        onCancel={() => setExportRangeOpen(false)}
      >
        <DatePicker.RangePicker
          value={[dayjs(exportRange[0]), dayjs(exportRange[1])]}
          onChange={(values: [Dayjs | null, Dayjs | null] | null) => {
            if (values?.[0] && values[1]) {
              setExportRange([
                values[0].format("YYYY-MM-DD"),
                values[1].format("YYYY-MM-DD"),
              ]);
            }
          }}
        />
      </Modal>
    </Card>
  );
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
  ...triggerProps
}: {
  studentId: string;
  date: string;
  available: boolean;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
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
      {...triggerProps}
      ref={setNodeRef}
      data-droppable-student-id={studentId}
      data-droppable-date={date}
      style={{
        position: "relative",
        width: "100%",
        minHeight: "100%",
        background: !available
          ? "repeating-linear-gradient(45deg, rgba(140,140,140,.12) 0, rgba(140,140,140,.12) 8px, rgba(255,255,255,.6) 8px, rgba(255,255,255,.6) 16px)"
          : isOver
            ? "rgba(22,119,255,0.08)"
            : undefined,
      }}
    >
      {!available ? (
        <span
          style={{
            position: "absolute",
            top: 2,
            left: 4,
            zIndex: 1,
            color: "#8c8c8c",
            fontSize: 12,
          }}
        >
          休息
        </span>
      ) : null}
      <div style={{ filter: available ? undefined : "grayscale(1)" }}>
        {children}
      </div>
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
