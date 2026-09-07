import {
  CopyOutlined,
  DeleteOutlined,
  CalendarOutlined,
  EyeOutlined,
  FlagFilled,
  ForwardOutlined,
  RocketOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import type { Priority } from "./taskApi";

export interface TaskContextMenuProps {
  locked: boolean;
  /** Current priority of the task, used to mark the active option. */
  priority?: Priority;
  onSetPriority?: (next: Priority) => void;
  onReschedule: () => void;
  canCarryForward: boolean;
  onCarryForward?: () => void;
  onDuplicate: () => void;
  /** 系列推进：接着排下一项（序号+1，落到下一个可学习日）。未提供时不显示。 */
  onCreateNext?: () => void;
  /** 原地升级为长期任务（SEQUENCE 轨道）。仅待办的普通任务会拿到该回调。 */
  onConvertToLongTask?: () => void;
  onViewDetail: () => void;
  onDelete: () => void;
}

/**
 * Builds the antd Dropdown items array for a task's right-click context menu.
 * Kept as a pure function so TaskContextMenu stays testable and reusable.
 *
 * The priority submenu mirrors TickTick's flag row: a red flag (高), a yellow
 * flag (中), and a clear option (取消) that removes the priority. The active
 * option is marked with a check so the user can see the current state.
 *
 * 菜单是刻意短的：完成/改期/顺延/复制/继续这个系列/设为长期任务/查看详情/
 * 删除/优先级。子任务与「关联主任务」曾经在这里，需要助教手输一个 UUID 才能
 * 用——助教永远不应该看到 UUID，两项连同输入框一起从产品里删掉了（数据库列
 * parent_task_id / linked_parent_task_id 保留，migration 不动）。别再加回来。
 */
export function buildTaskMenuItems(
  props: TaskContextMenuProps,
): MenuProps["items"] {
  const {
    locked,
    priority,
    onSetPriority,
    onReschedule,
    canCarryForward,
    onCarryForward,
    onDuplicate,
    onCreateNext,
    onConvertToLongTask,
    onViewDetail,
    onDelete,
  } = props;

  const flagColor =
    priority === "HIGH"
      ? "#ff4d4f"
      : priority === "MEDIUM"
        ? "#faad14"
        : "#bfbfbf";

  const priorityChildren: MenuProps["items"] = [
    {
      key: "priority-high",
      icon: <FlagFilled style={{ color: "#ff4d4f" }} />,
      label: "高",
      disabled: locked || !onSetPriority,
      onClick: () => onSetPriority?.("HIGH"),
    },
    {
      key: "priority-medium",
      icon: <FlagFilled style={{ color: "#faad14" }} />,
      label: "中",
      disabled: locked || !onSetPriority,
      onClick: () => onSetPriority?.("MEDIUM"),
    },
    { type: "divider" },
    {
      key: "priority-none",
      icon: <FlagFilled style={{ color: "#bfbfbf" }} />,
      label: "取消",
      disabled: locked || !onSetPriority,
      onClick: () => onSetPriority?.("NONE"),
    },
  ];

  return [
    {
      key: "priority",
      icon: <FlagFilled style={{ color: flagColor }} />,
      label: "优先级",
      disabled: locked || !onSetPriority,
      children: priorityChildren,
    },
    { type: "divider" },
    {
      key: "reschedule",
      icon: <CalendarOutlined />,
      label: "改期…",
      disabled: locked,
      onClick: onReschedule,
    },
    {
      key: "carryForward",
      icon: <ForwardOutlined />,
      label: "顺延到下一学习日",
      disabled: !canCarryForward || !onCarryForward,
      onClick: onCarryForward,
    },
    {
      key: "duplicate",
      icon: <CopyOutlined />,
      label: "复制",
      disabled: locked,
      onClick: onDuplicate,
    },
    ...(onCreateNext
      ? [
          {
            key: "createNext",
            icon: <RocketOutlined />,
            label: "继续这个系列",
            disabled: locked,
            onClick: onCreateNext,
          },
        ]
      : []),
    ...(onConvertToLongTask
      ? [
          { type: "divider" as const },
          {
            key: "convertToLongTask",
            icon: <ThunderboltOutlined />,
            label: "设为长期任务…",
            disabled: locked,
            onClick: onConvertToLongTask,
          },
        ]
      : []),
    { type: "divider" },
    {
      key: "viewDetail",
      icon: <EyeOutlined />,
      label: "查看详情",
      onClick: onViewDetail,
    },
    {
      key: "delete",
      icon: <DeleteOutlined />,
      label: "删除",
      danger: true,
      disabled: locked,
      onClick: onDelete,
    },
  ];
}

export default buildTaskMenuItems;
