import { EditOutlined, SaveOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Space,
  Tag,
  Typography,
} from "antd";
import type { DescriptionsProps } from "antd";
import { useState, type ReactNode } from "react";
import { updateTask, type TaskLike } from "./taskApi";
import { invalidateTaskViews } from "./taskActions";
import { itemOrdinalLabel } from "./itemOrdinalLabel";

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
      title="任务详情"
      size={480}
      destroyOnHidden
    >
      {task ? (
        <TaskDetailBody
          key={`${task.id}:${task.version}`}
          initialTask={task}
          studentName={target?.studentName ?? null}
        />
      ) : null}
    </Drawer>
  );
}

function TaskDetailBody({
  initialTask,
  studentName,
}: {
  initialTask: TaskLike & TaskDetailExtras;
  studentName: string | null;
}) {
  const queryClient = useQueryClient();
  const [task, setTask] = useState(initialTask);
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm<{ title: string; note: string }>();
  const saveMutation = useMutation({
    mutationFn: (values: { title: string; note: string }) =>
      updateTask(task.id, {
        ...values,
        title: values.title.trim(),
        expectedVersion: task.version,
      }),
    onSuccess: async (saved) => {
      setTask({
        ...task,
        title: saved.titleSnapshot ?? task.title,
        shortTitle: saved.shortTitleSnapshot,
        note: saved.note,
        version: saved.version,
      });
      setEditing(false);
      await invalidateTaskViews(queryClient);
    },
  });
  // A CARRIED_OVER source row is history (INT-CAL-008 / ACC-074): keep the
  // trail visible but say so at the top of the drawer in a weakened style.
  const history = task.carriedOver === true || task.status === "CARRIED_OVER";
  const editable =
    task.sourceType === "AD_HOC" &&
    !task.locked &&
    !history &&
    task.status !== "CANCELLED";
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
  const ordinalLabel = itemOrdinalLabel(task);

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
    // 序号沿用卡片那套判断：标题末尾数字已等于序号时（长期任务）不再重复一遍。
    ...(ordinalLabel
      ? [{ key: "track", label: "轨道", children: ordinalLabel }]
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
      {editing ? (
        <Form
          form={form}
          layout="vertical"
          disabled={saveMutation.isPending}
          onFinish={(values) => saveMutation.mutate(values)}
        >
          <Form.Item
            name="title"
            label="标题"
            rules={[
              { required: true, whitespace: true, message: "请输入任务标题" },
            ]}
          >
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={3} />
          </Form.Item>
          {saveMutation.isError ? (
            <Alert
              type="error"
              showIcon
              message={saveMutation.error.message}
              style={{ marginBottom: 12 }}
            />
          ) : null}
          <Space style={{ marginBottom: 16 }}>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={saveMutation.isPending}
            >
              保存
            </Button>
            <Button
              onClick={() => setEditing(false)}
              disabled={saveMutation.isPending}
            >
              取消
            </Button>
          </Space>
        </Form>
      ) : editable ? (
        <Button
          aria-label="编辑任务"
          icon={<EditOutlined />}
          style={{ marginBottom: 16 }}
          onClick={() => {
            form.setFieldsValue({ title: task.title, note: task.note ?? "" });
            saveMutation.reset();
            setEditing(true);
          }}
        >
          编辑任务
        </Button>
      ) : null}
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
      <Descriptions
        column={1}
        size="small"
        bordered
        items={
          editing
            ? items.filter(
                (item) =>
                  item.key !== "title" &&
                  item.key !== "shortTitle" &&
                  item.key !== "note",
              )
            : items
        }
      />
    </>
  );
}

export default TaskDetailDrawer;
