import { Descriptions, Drawer, Space, Tag, Typography } from "antd";
import type { DescriptionsProps } from "antd";
import type { ReactNode } from "react";
import type { TaskLike } from "./taskApi";

/**
 * Read-only task detail drawer (audit 2026-08-27 §4 MAJOR-5 / INT-CAL-003).
 * Replaces the five former message.info detail placeholders in Today,
 * Schedule and Workbench. The drawer is fed entirely from the task object
 * the opening page already holds in its list — no extra query — so the
 * input is the shared TaskLike card contract plus the optional detail
 * fields below: a projection that lacks them simply renders "-" instead of
 * failing.
 */
export interface TaskDetailExtras {
  trackId?: string | null;
  scheduleOrigin?: string | null;
  note?: string | null;
  overrideReason?: string | null;
  carriedToInstanceId?: string | null;
  completedAt?: string | null;
}

export interface TaskDetailTarget {
  task: TaskLike & TaskDetailExtras;
  /** Owning student's display name, when the opening page knows it. */
  studentName?: string | null;
}

// Mirrors the status Tag colors already used across the app (TaskUsageDrawer /
// GlobalSearchDialog) so the drawer never invents a second palette.
const statusMeta: Record<string, { color: string; label: string }> = {
  PENDING: { color: "blue", label: "待完成" },
  COMPLETED: { color: "green", label: "已完成" },
  CARRIED_OVER: { color: "orange", label: "已顺延" },
  BLOCKED: { color: "red", label: "已阻塞" },
  CANCELLED: { color: "default", label: "已取消" },
};

const sourceTypeLabels: Record<string, string> = {
  TRACK: "轨道任务",
  AD_HOC: "临时任务",
};

const scheduleOriginLabels: Record<string, string> = {
  AUTO: "自动排期",
  MANUAL: "手动调整",
  CARRYOVER: "顺延生成",
  TRACK: "轨道排期",
  IMPORT: "导入",
};

// Same hue family as the TaskCard flag icons (HIGH red / MEDIUM orange).
const priorityTags: Record<string, { label: string; color: string }> = {
  HIGH: { label: "高优先级", color: "red" },
  MEDIUM: { label: "中优先级", color: "orange" },
  LOW: { label: "低优先级", color: "default" },
};

export function TaskDetailDrawer({
  target,
  onClose,
}: {
  target: TaskDetailTarget | null;
  onClose: () => void;
}) {
  const task = target?.task ?? null;
  return (
    <Drawer
      open={task !== null}
      onClose={onClose}
      title={task ? (task.shortTitle ?? task.title) : "任务详情"}
      width={480}
      destroyOnHidden
    >
      {task ? (
        <TaskDetailBody task={task} studentName={target?.studentName ?? null} />
      ) : null}
    </Drawer>
  );
}

function TaskDetailBody({
  task,
  studentName,
}: {
  task: TaskLike & TaskDetailExtras;
  studentName: string | null;
}) {
  // A CARRIED_OVER source row is history (INT-CAL-008 / ACC-074): keep the
  // trail visible but say so at the top of the drawer in a weakened style.
  const history = task.carriedOver === true || task.status === "CARRIED_OVER";
  const hasLineage =
    history || task.carriedFromDate != null || task.carriedToInstanceId != null;

  const status = statusMeta[task.status] ?? {
    color: "default",
    label: task.status,
  };
  const sourceLabel = sourceTypeLabels[task.sourceType] ?? task.sourceType;
  const originLabel = task.scheduleOrigin
    ? (scheduleOriginLabels[task.scheduleOrigin] ?? task.scheduleOrigin)
    : null;

  const flags: ReactNode[] = [];
  const priority = task.priority ? priorityTags[task.priority] : undefined;
  if (priority) flags.push(<Tag key="priority">{priority.label}</Tag>);
  if (task.star) flags.push(<Tag key="star">星标</Tag>);
  if (task.locked) flags.push(<Tag key="locked">锁定</Tag>);

  const items: DescriptionsProps["items"] = [
    { key: "title", label: "标题", children: task.title },
    ...(task.shortTitle && task.shortTitle !== task.title
      ? [
          {
            key: "shortTitle",
            label: "简称",
            children: task.shortTitle,
          },
        ]
      : []),
    { key: "student", label: "学生", children: studentName ?? "-" },
    {
      key: "scheduledDate",
      label: "计划日期",
      children: task.scheduledDate ?? "-",
    },
    {
      key: "status",
      label: "状态",
      children: <Tag color={status.color}>{status.label}</Tag>,
    },
    {
      key: "source",
      label: "来源",
      children: originLabel ? `${sourceLabel} · ${originLabel}` : sourceLabel,
    },
    ...(task.trackId != null || task.itemOrdinal != null
      ? [
          {
            key: "track",
            label: "轨道",
            children: (
              <Space size="small" wrap>
                <span>
                  {task.itemOrdinal != null
                    ? `轨道第 ${task.itemOrdinal} 项`
                    : "轨道任务"}
                </span>
                {task.trackId ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {task.trackId}
                  </Typography.Text>
                ) : null}
              </Space>
            ),
          },
        ]
      : []),
    {
      key: "duration",
      label: "时长",
      children:
        task.durationMinutes != null ? `${task.durationMinutes} 分钟` : "-",
    },
    {
      key: "flags",
      label: "标记",
      children:
        flags.length > 0 ? (
          <Space size={4} wrap>
            {flags}
          </Space>
        ) : (
          "-"
        ),
    },
    { key: "note", label: "备注", children: task.note ?? "-" },
    ...(task.overrideReason
      ? [
          {
            key: "overrideReason",
            label: "调整原因",
            children: task.overrideReason,
          },
        ]
      : []),
    { key: "version", label: "版本", children: String(task.version) },
    ...(task.completedAt
      ? [
          {
            key: "completedAt",
            label: "完成时间",
            children: new Date(task.completedAt).toLocaleString("zh-CN"),
          },
        ]
      : []),
  ];

  return (
    <>
      {hasLineage ? (
        <div
          style={{
            border: "1px dashed #d9d9d9",
            borderRadius: 8,
            background: "#fafafa",
            padding: "8px 12px",
            marginBottom: 16,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <Typography.Text type="secondary" strong>
            顺延记录
          </Typography.Text>
          {history ? (
            <Typography.Text type="secondary">
              这是顺延来源的历史实例
            </Typography.Text>
          ) : null}
          {task.carriedFromDate ? (
            <Typography.Text>
              由 {task.carriedFromDate} 顺延而来
            </Typography.Text>
          ) : null}
          {task.carriedToInstanceId ? (
            <Typography.Text>已顺延至新实例</Typography.Text>
          ) : null}
        </div>
      ) : null}
      <Descriptions column={1} size="small" bordered items={items} />
    </>
  );
}

export default TaskDetailDrawer;
