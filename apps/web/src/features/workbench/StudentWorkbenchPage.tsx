import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Segmented,
  Skeleton,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../lib/api/http";
import { completeTask, reopenTask } from "../today/todayApi";
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
import { useBusinessDate } from "../foundation/useBusinessDate";
import {
  getWorkbench,
  type WorkbenchResponse,
  type WorkbenchStudentRow,
  type WorkbenchTask,
} from "./workbenchApi";

type Density = "compact" | "expanded";

const DENSITY_CONFIG: Record<
  Density,
  { rowHeight: number; visibleTasksPerCell: number; viewportRows: number }
> = {
  // 紧凑模式:行高更小,聚合 +N(只显示前 2 条任务,其余 +N)。
  compact: { rowHeight: 72, visibleTasksPerCell: 2, viewportRows: 8 },
  // 扩展模式:行高更大,显示更多任务详情(前 5 条)。
  // 行高需容纳 5 张任务卡片(每张 ~28px + 4px 间距)+ +N 提示,故放宽到 200。
  expanded: { rowHeight: 200, visibleTasksPerCell: 5, viewportRows: 4 },
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
  // AC-001: 业务日期由服务端按组织时区计算,优先使用后端 businessDate。
  const today = useBusinessDate();
  const [weekStart, setWeekStart] = useState(getWeekStart(today));
  // P2-WBK-007: 紧凑/扩展密度切换(会话内持久化)。
  const [density, setDensity] = useState<Density>("compact");
  const densityConfig = DENSITY_CONFIG[density];
  const queryClient = useQueryClient();
  const { message } = App.useApp();

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

  // D2: shared TaskCard callbacks. Each mutation invalidates the workbench
  // query on settle so the grid reflects the latest server state. The
  // backend /tasks endpoints are tenant-scoped; complete/reopen reuse the
  // today API helpers (same /tasks/{id}/complete|reopen contract).
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["workbench", weekStart] });

  const completeMutation = useMutation({
    mutationFn: (task: TaskLike) =>
      completeTask(task.id, task.version, crypto.randomUUID()),
    onError: (error) => {
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
      reopenTask(task.id, task.version, crypto.randomUUID()),
    onError: (error) => {
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "重开任务失败，请稍后重试",
      );
    },
    onSettled: invalidate,
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
      linkMainTask(params.task.id, params.task.version, params.linkedParentTaskId),
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
    mutationFn: (params: {
      task: TaskLike;
      priority?: Priority;
    }) =>
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

  const anyMutationPending =
    completeMutation.isPending ||
    reopenMutation.isPending ||
    deleteTaskMutation.isPending ||
    duplicateTaskMutation.isPending ||
    createSubTaskMutation.isPending ||
    linkMainTaskMutation.isPending ||
    updateTaskMutation.isPending;

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
              : "请确认 API 已启动并登录。"
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
        <Space direction="vertical" size={0}>
          <Link
            to={`/students/${row.id}/profile`}
            aria-label={`打开 ${row.name} 资料`}
          >
            {row.name}
          </Link>
          <Space size={4}>
            <Typography.Text type="secondary">{row.code}</Typography.Text>
            <Link
              to={`/students/${row.id}/vocabulary`}
              aria-label={`${row.name} 生词本`}
            >
              生词本({row.vocabularyCountThisWeek})
            </Link>
            <Link to={`/students/${row.id}/schedule`} aria-label={`${row.name} 排期`}>
              排期
            </Link>
          </Space>
          {row.tags.length > 0 ? (
            <Space size={4}>
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
        style: { borderRight: "1px solid var(--ant-color-border-secondary, #f0f0f0)" },
      }),
      onCell: () => ({
        // P2-WBK-UI: 日期列之间的竖向分隔线,从表头延伸到行底,
        // 让 7 个日期列在视觉上彼此分开。
        style: { borderRight: "1px solid var(--ant-color-border-secondary, #f0f0f0)" },
      }),
      render: (_v: unknown, row: WorkbenchStudentRow) => {
        const cell = row.days[date];
        if (!cell || cell.tasks.length === 0) return null;
        return (
          <Space direction="vertical" size={2} style={{ width: "100%", padding: "2px 4px" }}>
            {cell.tasks.slice(0, visibleTasks).map((task: WorkbenchTask) => {
              const taskLike = toTaskLike(task);
              return (
                <div key={task.id} style={{ width: "100%" }}>
                  <TaskCard
                    task={taskLike}
                    density="compact"
                    onComplete={(t) => completeMutation.mutate(t)}
                    onReopen={(t) => reopenMutation.mutate(t)}
                    onReschedule={() => invalidate()}
                    onDelete={(t) => deleteTaskMutation.mutate(t)}
                    onDuplicate={(t) => duplicateTaskMutation.mutate(t)}
                    onAddSubTask={(t, title) =>
                      createSubTaskMutation.mutate({ task: t, title })
                    }
                    onLinkParent={(t, linkedParentTaskId) =>
                      linkMainTaskMutation.mutate({ task: t, linkedParentTaskId })
                    }
                    onViewDetail={(t) => void message.info(`任务 ${t.id} 详情待实现`)}
                    onSetPriority={(t, next) =>
                      updateTaskMutation.mutate({ task: t, priority: next })
                    }
                  />
                </div>
              );
            })}
            {cell.tasks.length > visibleTasks ? (
              <Typography.Text type="secondary">
                +{cell.tasks.length - visibleTasks}
              </Typography.Text>
            ) : null}
          </Space>
        );
      },
    })),
  ];

  return (
    <Spin spinning={anyMutationPending}>
      <Card
        title="学生工作台"
        extra={
          <Space wrap>
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
          <Empty description="当前组织没有活跃学生" />
        ) : (
          <VirtualizedWorkbenchTable
            columns={columns}
            data={data.students}
            rowHeight={ROW_HEIGHT}
            viewportRows={densityConfig.viewportRows}
            totalWidth={180 + dates.length * 160}
          />
        )}
      </Card>
    </Spin>
  );
}

interface VirtualizedWorkbenchTableProps {
  columns: TableColumnsType<WorkbenchStudentRow>;
  data: WorkbenchStudentRow[];
  rowHeight: number;
  viewportRows: number;
  totalWidth: number;
}

/**
 * P2-WBK-004: 行虚拟化工作台表格。
 *
 * antd 6 Table 通过 `components.body` 接受自定义 body 渲染器;我们在此接管 body,
 * 在内部用 @tanstack/react-virtual 的 useVirtualizer 只渲染可见学生行,
 * 同时保留 antd Table 表头、固定首列(fixed: "left")和 +N 聚合渲染逻辑。
 * 首列 sticky 由 renderCell 对 fixed==="left" 列注入 position:sticky 实现。
 */
function VirtualizedWorkbenchTable({
  columns,
  data,
  rowHeight,
  viewportRows,
  totalWidth,
}: VirtualizedWorkbenchTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewportHeight = rowHeight * viewportRows;

  // react-compiler: useVirtualizer 返回的函数不可安全 memoize,这是 TanStack Virtual
  // 的已知行为,此处关闭该规则的 memoize 检查。
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 4,
  });

  const items = virtualizer.getVirtualItems();

  const renderCell = (row: WorkbenchStudentRow, colIndex: number) => {
    const col = columns[colIndex];
    if (!col) return null;
    const render = col.render as
      | ((value: unknown, record: WorkbenchStudentRow, index: number) => ReactNode)
      | undefined;
    const content = render ? render(undefined, row, colIndex) : null;
    const isFixedLeft = col.fixed === "left";
    const width = typeof col.width === "number" ? col.width : undefined;
    return (
      <div
        key={col.key ?? colIndex}
        className={
          isFixedLeft ? "ant-table-cell ant-table-cell-fix-left" : undefined
        }
        style={{
          width,
          minWidth: width,
          maxWidth: width,
          ...(isFixedLeft
            ? {
                position: "sticky",
                left: 0,
                zIndex: 2,
                background: "var(--ant-color-bg-container, #fff)",
                boxShadow: "6px 0 6px -4px rgba(0,0,0,0.08)",
              }
            : {
                // P2-WBK-UI: 日期列之间的竖向分隔线,与表头 onCell 边框一致,
                // 让 7 个日期列在虚拟化 body 中也彼此分开。
                borderRight:
                  "1px solid var(--ant-color-border-secondary, #f0f0f0)",
              }),
        }}
      >
        {content}
      </div>
    );
  };

  return (
    <Table<WorkbenchStudentRow>
      rowKey="id"
      dataSource={data}
      pagination={false}
      scroll={{ x: totalWidth, y: viewportHeight }}
      columns={columns}
      components={{
        body: (rows: readonly WorkbenchStudentRow[]) => (
          <div
            ref={scrollRef}
            style={{
              height: viewportHeight,
              overflow: "auto",
              contain: "strict",
            }}
          >
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: "100%",
                position: "relative",
              }}
            >
              {items.map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (!row) return null;
                return (
                  <div
                    key={row.id}
                    data-row-key={row.id}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`,
                      display: "flex",
                      minWidth: totalWidth,
                    }}
                    className="ant-table-row"
                  >
                    {columns.map((_, colIndex) => renderCell(row, colIndex))}
                  </div>
                );
              })}
            </div>
          </div>
        ),
      }}
    />
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
