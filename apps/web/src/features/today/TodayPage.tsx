import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Empty,
  Modal,
  Row,
  Skeleton,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { ApiError } from "../../lib/api/ApiError";
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
import {
  formatSeriesTitle,
  parseSeriesTitle,
} from "../../domain/task/seriesTitle";
import { useBusinessDate } from "../foundation/useBusinessDate";
import { convertTaskToLongTask } from "../longtasks/longTaskApi";
import {
  getToday,
  getTodayCarryovers,
  type CarryOverItem,
  type TodayResponse,
  type TodayTask,
} from "./todayApi";
import { InlineTaskComposer } from "./InlineTaskComposer";
import { triggerDayClose } from "../admin/dayCloseApi";

const dayNames = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * Adapts a TodayTask summary into the shared TaskCard TaskLike contract.
 * TodayTaskSummary already covers the common fields; optional D2 fields
 * (parentTaskId / priority / sortOrder / star) pass through when present.
 */
function toTaskLike(task: TodayTask): TaskLike {
  return {
    id: task.id,
    title: task.title,
    shortTitle: task.shortTitle,
    status: task.status,
    sourceType: task.sourceType,
    itemOrdinal: task.itemOrdinal,
    durationMinutes: task.durationMinutes,
    locked: task.locked,
    carriedOver: task.carriedOver,
    carriedFromDate: task.carriedFromDate ?? null,
    scheduledDate: task.scheduledDate,
    version: task.version,
    parentTaskId: task.parentTaskId ?? null,
    linkedParentTaskId: task.linkedParentTaskId ?? null,
    priority: task.priority ?? null,
    sortOrder: task.sortOrder ?? null,
    star: task.star ?? false,
  };
}

// INT-CAL-009 同日排序权重：NONE/未设置与 NULL 一样沉底（=3）。
const priorityWeights: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function priorityWeight(priority?: string | null): number {
  return priorityWeights[priority ?? ""] ?? 3;
}

/**
 * Same-day task ordering (INT-CAL-009): starred first, then priority weight
 * (HIGH < MEDIUM < LOW < NONE/unset), then manual sortOrder, then id as the
 * stable tiebreaker. Mirrors the tasksBetween SQL ORDER BY exactly so this
 * client-side re-sort never fights the adapter's row order.
 */
function sortBySortOrder(tasks: TodayTask[]): TodayTask[] {
  return [...tasks].sort((a, b) => {
    const starDelta = (b.star ? 1 : 0) - (a.star ? 1 : 0);
    if (starDelta !== 0) return starDelta;
    const priorityDelta =
      priorityWeight(a.priority) - priorityWeight(b.priority);
    if (priorityDelta !== 0) return priorityDelta;
    const sa = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const sb = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return a.id.localeCompare(b.id);
  });
}

export function TodayPage() {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { offerSeriesSuggestion } = useSeriesSuggestion();
  // The desktop adapter owns the local work date used across all views.
  const businessDate = useBusinessDate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedDate =
    z.iso.date().safeParse(searchParams.get("date")).data ?? businessDate;
  const setSelectedDate = (date: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("date", date);
    setSearchParams(next, { replace: true });
  };

  const todayQuery = useQuery({
    queryKey: ["today", selectedDate],
    queryFn: () => getToday(selectedDate),
    retry: false,
  });

  const [carryoverOpen, setCarryoverOpen] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  // MAJOR-5: the read-only detail drawer target; fed straight from the task
  // object the list already holds, so no extra query is needed.
  const [detailTarget, setDetailTarget] = useState<TaskDetailTarget | null>(
    null,
  );
  const carryoversQuery = useQuery({
    queryKey: ["today-carryovers", selectedDate],
    queryFn: () => getTodayCarryovers(selectedDate),
    enabled: carryoverOpen,
    retry: false,
  });

  const completeMutation = useMutation({
    mutationFn: (params: { taskId: string; version: number }) =>
      taskActions.complete(params.taskId, params.version, crypto.randomUUID()),
    onMutate: async (params) => {
      await queryClient.cancelQueries({
        queryKey: ["today", selectedDate],
      });
      const snapshot = todayQuery.data;
      queryClient.setQueryData<TodayResponse | undefined>(
        ["today", selectedDate],
        (prev) =>
          prev
            ? {
                ...prev,
                students: prev.students.map((group) => ({
                  ...group,
                  tasks: group.tasks.map((task) =>
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
      return { snapshot };
    },
    onError: (_error, _params, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(["today", selectedDate], context.snapshot);
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
      await queryClient.cancelQueries({
        queryKey: ["today", selectedDate],
      });
      const snapshot = todayQuery.data;
      queryClient.setQueryData<TodayResponse | undefined>(
        ["today", selectedDate],
        (prev) =>
          prev
            ? {
                ...prev,
                students: prev.students.map((group) => ({
                  ...group,
                  tasks: group.tasks.map((task) =>
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
      return { snapshot };
    },
    onError: (_error, _params, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(["today", selectedDate], context.snapshot);
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

  // AC-014: undo a single carry-over. The source task is restored to PENDING
  // and the carried-over target instance is cancelled. On success we refresh
  // both the today view and the carryover detail list.
  const undoCarryoverMutation = useMutation({
    mutationFn: (params: {
      taskId: string;
      sourceTaskId: string;
      version: number;
    }) =>
      taskActions.undoCarryover(
        params.taskId,
        params.sourceTaskId,
        params.version,
        crypto.randomUUID(),
      ),
    onSuccess: () => {
      void message.success("已撤销顺延");
    },
    onError: (error) => {
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "撤销顺延失败，请稍后重试",
      );
    },
    onSettled: () => {
      void invalidateTaskViews(queryClient);
    },
  });

  // D2: shared TaskCard callbacks. These mutations invalidate every task
  // view on settle so the list reflects the latest server state. 409 conflicts
  // surface through the same conflict banner as complete/reopen.
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

  // 系列推进（用户反馈）：打勾 day1 后点箭头，下一个可学习日出现 day2；序号
  // 由本地适配器按同前缀最大值 +1 接续，当天已有 day1~day3 时逐行点箭头得到
  // day4~day6。返回新任务视图用于 toast 预览。
  const createNextSeriesMutation = useMutation({
    mutationFn: (task: TaskLike) =>
      createNextSeriesTask(task.id, { expectedVersion: task.version }),
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

  // 右键“设为长期任务”：普通任务原地升级为长期任务轨道的当前项（任务 id、
  // 标题快照都不变），之后完成即按标题模板自动生成下一项；历史任务不回填。
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
    onSettled: () => {
      void invalidateTaskViews(queryClient);
    },
  });

  // Priority toggle. Optimistic: flip the flag color in the cache so the icon
  // responds immediately; roll back on error.
  const updateTaskMutation = useMutation({
    mutationFn: (params: { task: TaskLike; priority?: Priority }) =>
      updateTask(params.task.id, {
        expectedVersion: params.task.version,
        priority: params.priority,
      }),
    onMutate: async (params) => {
      await queryClient.cancelQueries({
        queryKey: ["today", selectedDate],
      });
      const snapshot = todayQuery.data;
      queryClient.setQueryData<TodayResponse | undefined>(
        ["today", selectedDate],
        (prev) =>
          prev
            ? {
                ...prev,
                students: prev.students.map((group) => ({
                  ...group,
                  tasks: group.tasks.map((task) =>
                    task.id === params.task.id
                      ? {
                          ...task,
                          priority: params.priority ?? task.priority ?? null,
                        }
                      : task,
                  ),
                })),
              }
            : prev,
      );
      return { snapshot };
    },
    onError: (error, _params, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(["today", selectedDate], context.snapshot);
      }
      void message.error(
        error instanceof ApiError ? error.message : "更新任务失败，请稍后重试",
      );
    },
    onSettled: () => {
      void invalidateTaskViews(queryClient);
    },
  });

  // D2: reschedule is driven by RescheduleModal inside TaskCard; the card
  // calls onReschedule(task, targetDate) only after a successful PATCH, so
  // the page just needs to refresh the view to reflect the new date.
  // 日结是助教每天点一次的动作，放在首页统计卡片右侧即可。结果只需一句话：
  // 顺延了几项、有没有卡住的，逐项运行日志对使用者没有意义。
  const dayCloseMutation = useMutation({
    mutationFn: (date: string) => triggerDayClose(date),
    onSuccess: (summary) => {
      void invalidateTaskViews(queryClient);
      if (summary.scanned === 0) {
        void message.success("日结完成：没有需要顺延的任务");
        return;
      }
      const parts = [`已顺延 ${summary.carried} 项`];
      if (summary.blocked > 0) parts.push(`${summary.blocked} 项无可用学习日`);
      if (summary.failed > 0) parts.push(`${summary.failed} 项失败`);
      const text = `日结完成：${parts.join("，")}`;
      if (summary.blocked > 0 || summary.failed > 0) {
        void message.warning(text);
      } else {
        void message.success(text);
      }
    },
    onError: (error: unknown) => {
      void message.error(
        error instanceof ApiError ? error.message : "日结执行失败，请稍后重试",
      );
    },
  });

  const handleRescheduleSuccess = () => {
    void invalidateTaskViews(queryClient);
  };

  const shiftDate = (days: number) => {
    const date = new Date(selectedDate);
    date.setDate(date.getDate() + days);
    setSelectedDate(date.toISOString().slice(0, 10));
  };

  if (todayQuery.isPending) {
    return (
      <Card title="今日工作">
        <Skeleton active paragraph={{ rows: 8 }} />
      </Card>
    );
  }

  if (todayQuery.isError) {
    const error = todayQuery.error;
    return (
      <Card title="今日工作">
        <Alert
          type="error"
          title="今日工作暂不可用"
          showIcon
          description={
            error instanceof ApiError
              ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
              : "请检查本地数据文件后重试。"
          }
          action={
            <Button type="link" onClick={() => void todayQuery.refetch()}>
              重试
            </Button>
          }
        />
      </Card>
    );
  }

  const data = todayQuery.data;
  const dateObj = new Date(selectedDate);
  const dayName = dayNames[dateObj.getDay()];
  // 阻塞任务散在各学生卡片里，数字旁给一份汇总，省得逐个卡片翻。
  const blockedTasks = data.students.flatMap((group) =>
    group.tasks
      .filter((task) => task.status === "BLOCKED")
      .map((task) => ({
        id: task.id,
        title: task.shortTitle ?? task.title,
        studentId: group.studentId,
        studentName: group.studentName,
        scheduledDate: task.scheduledDate,
      })),
  );

  return (
    <Spin
      spinning={
        completeMutation.isPending ||
        reopenMutation.isPending ||
        undoCarryoverMutation.isPending ||
        deleteTaskMutation.isPending ||
        duplicateTaskMutation.isPending ||
        updateTaskMutation.isPending
      }
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Card>
          <Space style={{ justifyContent: "space-between", width: "100%" }}>
            <Space>
              <Button icon={<LeftOutlined />} onClick={() => shiftDate(-1)}>
                上一天
              </Button>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {selectedDate} 星期{dayName}
              </Typography.Title>
              <Button onClick={() => shiftDate(1)}>
                下一天
                <RightOutlined />
              </Button>
              {selectedDate !== businessDate ? (
                <Button
                  type="link"
                  onClick={() => setSelectedDate(businessDate)}
                >
                  回到今天
                </Button>
              ) : null}
            </Space>
          </Space>
        </Card>

        <Card
          extra={
            <Button
              type="primary"
              loading={dayCloseMutation.isPending}
              onClick={() => dayCloseMutation.mutate(selectedDate)}
            >
              执行日结
            </Button>
          }
        >
          <Space size="large" wrap>
            <Statistic title="学生数" value={data.metrics.totalStudents} />
            <Statistic title="待完成" value={data.metrics.totalPendingTasks} />
            <Statistic
              title="已完成"
              value={data.metrics.totalCompletedTasks}
            />
            <Statistic title="顺延" value={data.metrics.carriedOverTasks} />
            <Statistic
              title="阻塞"
              value={data.metrics.blockedTasks}
              valueStyle={{
                color: data.metrics.blockedTasks > 0 ? "#ff4d4f" : undefined,
              }}
              suffix={
                blockedTasks.length > 0 ? (
                  <Button
                    type="link"
                    size="small"
                    onClick={() => setBlockedOpen(true)}
                  >
                    明细
                  </Button>
                ) : null
              }
            />
            <Statistic
              title="冲突"
              value={data.metrics.conflictCount}
              valueStyle={{
                color: data.metrics.conflictCount > 0 ? "#fa8c16" : undefined,
              }}
            />
          </Space>
        </Card>

        <Card>
          <Space style={{ justifyContent: "space-between", width: "100%" }}>
            <Typography.Text>
              昨日顺延到本日：{data.metrics.carriedOverTasks} 项
            </Typography.Text>
            <Button
              type="link"
              onClick={() => setCarryoverOpen((open) => !open)}
            >
              {carryoverOpen ? "收起" : "查看明细"}
            </Button>
          </Space>
          {carryoverOpen ? (
            <CarryoverList
              loading={carryoversQuery.isPending}
              error={carryoversQuery.error}
              items={carryoversQuery.data ?? []}
              onUndo={(item) =>
                undoCarryoverMutation.mutate({
                  taskId: item.targetTaskId ?? item.sourceTaskId,
                  sourceTaskId: item.sourceTaskId,
                  version: item.version,
                })
              }
              undoPending={undoCarryoverMutation.isPending}
            />
          ) : null}
        </Card>

        {data.students.length === 0 ? (
          <Card>
            <Empty description="今日无任务" />
          </Card>
        ) : (
          <Row
            gutter={[16, 16]}
            style={{ width: "100%" }}
            // Wide screens get 5 columns (24/5 ≈ 4.8 → use responsive spans),
            // narrower screens drop to 4 columns. Each card holds the student
            // header + their task list so horizontal space is used fully.
          >
            {data.students.map((group) => (
              <Col
                key={group.studentId}
                xs={24}
                sm={12}
                md={8}
                lg={6}
                xl={5}
                xxl={5}
              >
                <Card
                  title={
                    <Space>
                      <Link
                        to={`/students/${group.studentId}/profile`}
                        aria-label={`打开 ${group.studentName} 资料`}
                      >
                        {group.studentName}
                      </Link>
                      <Typography.Text type="secondary">
                        {group.studentCode}
                      </Typography.Text>
                      <Tag>{group.devicePolicy}</Tag>
                    </Space>
                  }
                  extra={
                    <Space>
                      <Link to={`/students/${group.studentId}/vocabulary`}>
                        生词本
                      </Link>
                      <Link
                        to={`/students/${group.studentId}/schedule?${new URLSearchParams({ date: selectedDate })}`}
                      >
                        排期
                      </Link>
                    </Space>
                  }
                >
                  {group.tasks.length === 0 ? (
                    <Typography.Text type="secondary">无任务</Typography.Text>
                  ) : (
                    <Space direction="vertical" style={{ width: "100%" }}>
                      {sortBySortOrder(group.tasks).map((task) => {
                        const taskLike = toTaskLike(task);
                        const isSubTask = Boolean(task.parentTaskId);
                        // 系列任务（手工/导入、标题带尾号）在行尾显示 → 箭头：
                        // 完成打勾后点一下即生成“序号+1、排到下一个可学习日”的
                        // 新任务，和长期任务轨道同一条排期规则。
                        // TRACK 任务的下一项由轨道完成时自动推进，不在此重复。
                        const series =
                          taskLike.sourceType === "TRACK"
                            ? null
                            : parseSeriesTitle(taskLike.title);
                        return (
                          <div
                            key={task.id}
                            style={
                              isSubTask
                                ? { marginLeft: 24, width: "100%" }
                                : { width: "100%" }
                            }
                          >
                            <TaskCard
                              task={taskLike}
                              density="compact"
                              onComplete={(t) =>
                                completeMutation.mutate({
                                  taskId: t.id,
                                  version: t.version,
                                })
                              }
                              onReopen={(t) =>
                                reopenMutation.mutate({
                                  taskId: t.id,
                                  version: t.version,
                                })
                              }
                              onReschedule={() => handleRescheduleSuccess()}
                              onCarryForward={(t) =>
                                carryForwardMutation.mutate(t)
                              }
                              onDelete={(t) => deleteTaskMutation.mutate(t)}
                              onDuplicate={(t) =>
                                duplicateTaskMutation.mutate(t)
                              }
                              onCreateNext={
                                series
                                  ? (t) => createNextSeriesMutation.mutate(t)
                                  : undefined
                              }
                              extra={
                                series ? (
                                  <Button
                                    size="small"
                                    type="link"
                                    aria-label={`继续这个系列（${formatSeriesTitle(series, series.number + 1)}）`}
                                    title="接排下一项：序号 +1，排到下一个可学习日"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      createNextSeriesMutation.mutate(taskLike);
                                    }}
                                  >
                                    →
                                  </Button>
                                ) : undefined
                              }
                              onConvertToLongTask={
                                taskLike.sourceType === "AD_HOC" &&
                                taskLike.status === "PENDING" &&
                                !taskLike.locked
                                  ? (t) => convertToLongTaskMutation.mutate(t)
                                  : undefined
                              }
                              onViewDetail={() =>
                                setDetailTarget({
                                  task: { ...taskLike, note: task.note },
                                  studentName: group.studentName,
                                })
                              }
                              onSetPriority={(t, next) =>
                                updateTaskMutation.mutate({
                                  task: t,
                                  priority: next,
                                })
                              }
                            />
                          </div>
                        );
                      })}
                    </Space>
                  )}

                  <InlineTaskComposer
                    studentId={group.studentId}
                    studentName={group.studentName}
                    scheduledDate={data.businessDate}
                  />
                </Card>
              </Col>
            ))}
          </Row>
        )}

        {(completeMutation.isError || reopenMutation.isError) &&
        !(completeMutation.isPending || reopenMutation.isPending) ? (
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
      <Modal
        title="阻塞任务"
        open={blockedOpen}
        onCancel={() => setBlockedOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Table
          rowKey="id"
          dataSource={blockedTasks}
          pagination={false}
          size="small"
          columns={[
            { title: "任务", dataIndex: "title", key: "title" },
            { title: "学生", dataIndex: "studentName", key: "studentName" },
            {
              title: "原定",
              dataIndex: "scheduledDate",
              key: "scheduledDate",
              render: (value: string | null) => value ?? "-",
            },
            {
              title: "",
              key: "action",
              render: (_, row) => (
                <Link
                  to={`/students/${row.studentId}/schedule?${new URLSearchParams({ date: row.scheduledDate ?? selectedDate })}`}
                  onClick={() => setBlockedOpen(false)}
                >
                  去改期
                </Link>
              ),
            },
          ]}
        />
      </Modal>
    </Spin>
  );
}

function CarryoverList({
  loading,
  error,
  items,
  onUndo,
  undoPending,
}: {
  loading: boolean;
  error: Error | null;
  items: CarryOverItem[];
  onUndo: (item: CarryOverItem) => void;
  undoPending: boolean;
}) {
  if (loading) {
    return <Skeleton active paragraph={{ rows: 3 }} style={{ marginTop: 8 }} />;
  }
  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        style={{ marginTop: 8 }}
        message="顺延明细暂不可用"
        description={
          error instanceof ApiError
            ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
            : error.message
        }
      />
    );
  }
  if (items.length === 0) {
    return <Empty description="无顺延记录" style={{ marginTop: 8 }} />;
  }
  return (
    <Table<CarryOverItem>
      style={{ marginTop: 8 }}
      rowKey="sourceTaskId"
      dataSource={items}
      pagination={false}
      size="small"
      columns={[
        {
          title: "原日期",
          dataIndex: "originalDate",
          key: "originalDate",
          render: (v: string | null) => v ?? "-",
        },
        {
          title: "目标日期",
          dataIndex: "targetDate",
          key: "targetDate",
          render: (v: string | null) => v ?? "-",
        },
        {
          title: "学生",
          dataIndex: "studentName",
          key: "studentName",
        },
        {
          title: "任务",
          dataIndex: "title",
          key: "title",
        },
        {
          title: "原因",
          dataIndex: "reason",
          key: "reason",
          render: (v: string | null, item) =>
            v ?? (item.scheduleOrigin === "AUTO" ? "自动顺延" : "-"),
        },
        {
          title: "执行时间",
          dataIndex: "executedAt",
          key: "executedAt",
          render: (v: string | null) =>
            v ? new Date(v).toLocaleString("zh-CN") : "-",
        },
        {
          title: "操作",
          key: "actions",
          render: (_value, item) =>
            item.targetTaskId ? (
              <Space size="small">
                <Link to={`/students/${item.studentId}/schedule`}>
                  查看新实例
                </Link>
                <Button
                  type="link"
                  size="small"
                  danger
                  loading={undoPending}
                  onClick={() => onUndo(item)}
                >
                  撤销
                </Button>
              </Space>
            ) : (
              <Tag>已阻塞</Tag>
            ),
        },
      ]}
    />
  );
}
