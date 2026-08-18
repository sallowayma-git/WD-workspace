import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
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
import { Link } from "react-router-dom";
import { ApiError } from "../../lib/api/http";
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
import { useFeatureFlag } from "../foundation/useFeatureFlag";
import {
  completeTask,
  getToday,
  getTodayCarryovers,
  reopenTask,
  undoCarryover,
  type CarryOverItem,
  type TodayResponse,
  type TodayTask,
} from "./todayApi";
import { InlineTaskComposer } from "./InlineTaskComposer";

const dayNames = ["日", "一", "二", "三", "四", "五", "六"];

function readVersion(current: Record<string, unknown>): number | null {
  return typeof current.version === "number" ? current.version : null;
}

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
    scheduledDate: task.scheduledDate,
    version: task.version,
    parentTaskId: task.parentTaskId ?? null,
    linkedParentTaskId: task.linkedParentTaskId ?? null,
    priority: task.priority ?? null,
    sortOrder: task.sortOrder ?? null,
    star: task.star ?? false,
  };
}

/**
 * Sorts tasks by sortOrder when present, otherwise preserves insertion order.
 * Subtasks follow their parent (parentTaskId non-null) naturally because the
 * backend already orders by id within a student group; sortOrder overrides
 * when available.
 */
function sortBySortOrder(tasks: TodayTask[]): TodayTask[] {
  return [...tasks].sort((a, b) => {
    const sa = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const sb = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return a.id.localeCompare(b.id);
  });
}

export function TodayPage() {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  // AC-001: 业务日期由服务端按组织时区 (Asia/Shanghai) 计算,
  // 优先使用后端 /context 返回的 businessDate 作为初始日期;
  // 仅在 /context 尚未就绪时回退到浏览器本地日期作为占位。
  const businessDate = useBusinessDate();
  const [selectedDate, setSelectedDate] = useState(businessDate);
  const [conflict, setConflict] = useState<{
    message: string;
    currentVersion: number | null;
  } | null>(null);

  // P2-TDY-008: 批量任务操作由 feature flag 控制,默认关闭。
  // 当后端 /context 返回 featureFlags.bulkTaskOps === true 时启用。
  const bulkOpsEnabled = useFeatureFlag("bulkTaskOps");
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkRunning, setBulkRunning] = useState(false);

  const todayQuery = useQuery({
    queryKey: ["today", selectedDate],
    queryFn: () => getToday(selectedDate),
    retry: false,
  });

  const [carryoverOpen, setCarryoverOpen] = useState(false);
  const carryoversQuery = useQuery({
    queryKey: ["today-carryovers", selectedDate],
    queryFn: () => getTodayCarryovers(selectedDate),
    enabled: carryoverOpen,
    retry: false,
  });

  const completeMutation = useMutation({
    mutationFn: (params: { taskId: string; version: number }) =>
      completeTask(params.taskId, params.version, crypto.randomUUID()),
    onMutate: async (params) => {
      setConflict(null);
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
                      ? { ...task, status: "COMPLETED" }
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
      if (error instanceof ApiError && error.status === 409) {
        const currentVersion = readVersion(error.current);
        setConflict({
          message: error.message,
          currentVersion,
        });
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["today", selectedDate] });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: (params: { taskId: string; version: number }) =>
      reopenTask(params.taskId, params.version, crypto.randomUUID()),
    onMutate: async (params) => {
      setConflict(null);
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
                      ? { ...task, status: "PENDING" }
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
      if (error instanceof ApiError && error.status === 409) {
        const currentVersion = readVersion(error.current);
        setConflict({
          message: error.message,
          currentVersion,
        });
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["today", selectedDate] });
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
      undoCarryover(
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
      void queryClient.invalidateQueries({
        queryKey: ["today", selectedDate],
      });
      void queryClient.invalidateQueries({
        queryKey: ["today-carryovers", selectedDate],
      });
    },
  });

  // D2: shared TaskCard callbacks. These mutations all invalidate the today
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
      void queryClient.invalidateQueries({ queryKey: ["today", selectedDate] });
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
      void queryClient.invalidateQueries({ queryKey: ["today", selectedDate] });
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
      void queryClient.invalidateQueries({ queryKey: ["today", selectedDate] });
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
      void queryClient.invalidateQueries({ queryKey: ["today", selectedDate] });
    },
  });

  // Priority toggle. Optimistic: flip the flag color in the cache so the icon
  // responds immediately; roll back on error.
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
      if (error instanceof ApiError && error.status === 409) {
        const currentVersion = readVersion(error.current);
        setConflict({
          message: error.message,
          currentVersion,
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
      void queryClient.invalidateQueries({ queryKey: ["today", selectedDate] });
    },
  });

  // D2: reschedule is driven by RescheduleModal inside TaskCard; the card
  // calls onReschedule(task, targetDate) only after a successful PATCH, so
  // the page just needs to refresh the view to reflect the new date.
  const handleRescheduleSuccess = () => {
    void queryClient.invalidateQueries({ queryKey: ["today", selectedDate] });
  };

  const shiftDate = (days: number) => {
    const date = new Date(selectedDate);
    date.setDate(date.getDate() + days);
    setSelectedDate(date.toISOString().slice(0, 10));
    setSelectedTaskIds(new Set());
  };

  // P2-TDY-008: 批量操作按顺序执行,复用 completeTask/reopenTask。
  // 每个任务携带各自的 version;遇到 409 即终止剩余批次并提示冲突。
  const runBulk = async (action: "complete" | "reopen") => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;
    setBulkRunning(true);
    let firstConflict: ApiError | null = null;
    let succeeded = 0;
    for (const id of ids) {
      const task = data?.students
        .flatMap((g) => g.tasks)
        .find((t) => t.id === id);
      if (!task) continue;
      try {
        if (action === "complete") {
          await completeTask(task.id, task.version, crypto.randomUUID());
        } else {
          await reopenTask(task.id, task.version, crypto.randomUUID());
        }
        succeeded += 1;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          firstConflict = error;
          break;
        }
        // 非 409 错误:终止批次并提示。
        void message.error(
          error instanceof ApiError
            ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
            : "批量操作失败,请稍后重试",
        );
        break;
      }
    }
    void queryClient.invalidateQueries({ queryKey: ["today", selectedDate] });
    setSelectedTaskIds(new Set());
    if (firstConflict) {
      setConflict({
        message: firstConflict.message,
        currentVersion: readVersion(firstConflict.current),
      });
    } else if (succeeded > 0) {
      void message.success(
        action === "complete"
          ? `已批量完成 ${succeeded} 项任务`
          : `已批量重开 ${succeeded} 项任务`,
      );
    }
    setBulkRunning(false);
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
              : "请确认 API 已启动并登录。"
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

  // P2-TDY-008: 仅当批量操作 flag 开启时计算所有任务 id(用于全选/统计)。
  const allTaskIds = bulkOpsEnabled
    ? data.students.flatMap((group) => group.tasks.map((task) => task.id))
    : [];

  return (
    <Spin
      spinning={
        completeMutation.isPending ||
        reopenMutation.isPending ||
        undoCarryoverMutation.isPending ||
        deleteTaskMutation.isPending ||
        duplicateTaskMutation.isPending ||
        createSubTaskMutation.isPending ||
        linkMainTaskMutation.isPending ||
        updateTaskMutation.isPending ||
        bulkRunning
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

        <Card>
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

        {bulkOpsEnabled ? (
          <Card size="small">
            <Space
              style={{ justifyContent: "space-between", width: "100%" }}
              wrap
            >
              <Space>
                <Checkbox
                  checked={
                    allTaskIds.length > 0 &&
                    selectedTaskIds.size === allTaskIds.length
                  }
                  indeterminate={
                    selectedTaskIds.size > 0 &&
                    selectedTaskIds.size < allTaskIds.length
                  }
                  onChange={(e) => {
                    setSelectedTaskIds(
                      e.target.checked ? new Set(allTaskIds) : new Set(),
                    );
                  }}
                >
                  全选({selectedTaskIds.size}/{allTaskIds.length})
                </Checkbox>
                <Button
                  size="small"
                  disabled={selectedTaskIds.size === 0}
                  onClick={() => void runBulk("complete")}
                >
                  批量完成
                </Button>
                <Button
                  size="small"
                  disabled={selectedTaskIds.size === 0}
                  onClick={() => void runBulk("reopen")}
                >
                  批量重开
                </Button>
              </Space>
              <Typography.Text type="secondary">
                批量操作(beta)
              </Typography.Text>
            </Space>
          </Card>
        ) : null}

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
                      <Link to={`/students/${group.studentId}/schedule`}>
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
                              onDelete={(t) => deleteTaskMutation.mutate(t)}
                              onDuplicate={(t) =>
                                duplicateTaskMutation.mutate(t)
                              }
                              onAddSubTask={(t, title) =>
                                createSubTaskMutation.mutate({
                                  task: t,
                                  title,
                                })
                              }
                              onLinkParent={(t, linkedParentTaskId) =>
                                linkMainTaskMutation.mutate({
                                  task: t,
                                  linkedParentTaskId,
                                })
                              }
                              onViewDetail={(t) =>
                                void message.info(`任务 ${t.id} 详情待实现`)
                              }
                              onSetPriority={(t, next) =>
                                updateTaskMutation.mutate({
                                  task: t,
                                  priority: next,
                                })
                              }
                              extra={
                                bulkOpsEnabled ? (
                                  <Checkbox
                                    checked={selectedTaskIds.has(task.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) =>
                                      setSelectedTaskIds((prev) => {
                                        const next = new Set(prev);
                                        if (e.target.checked) {
                                          next.add(task.id);
                                        } else {
                                          next.delete(task.id);
                                        }
                                        return next;
                                      })
                                    }
                                    aria-label={`选择任务 ${task.shortTitle ?? task.title}`}
                                  />
                                ) : null
                              }
                            />
                          </div>
                        );
                      })}
                    </Space>
                  )}

                  <InlineTaskComposer
                    studentId={group.studentId}
                    scheduledDate={data.businessDate}
                  />
                </Card>
              </Col>
            ))}
          </Row>
        )}

        {conflict ? (
          <Alert
            type="warning"
            title="任务已被其他用户修改"
            showIcon
            description={
              conflict.currentVersion !== null
                ? `${conflict.message}（服务器当前版本 v${conflict.currentVersion}）。已为您重新加载最新数据，请再次勾选。`
                : conflict.message
            }
            action={
              <Button type="link" onClick={() => void todayQuery.refetch()}>
                重新加载
              </Button>
            }
          />
        ) : null}

        {(completeMutation.isError || reopenMutation.isError) &&
        !conflict &&
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
