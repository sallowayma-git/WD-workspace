import {
  CopyOutlined,
  DeleteOutlined,
  CalendarOutlined,
  LinkOutlined,
  PlusOutlined,
  EyeOutlined,
  FlagFilled,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import type { Priority } from "./taskApi";

export interface TaskContextMenuProps {
  locked: boolean;
  /** Current priority of the task, used to mark the active option. */
  priority?: Priority;
  onSetPriority?: (next: Priority) => void;
  onReschedule: () => void;
  onDuplicate: () => void;
  onAddSubTask: () => void;
  onLinkParent: () => void;
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
 */
export function buildTaskMenuItems(
  props: TaskContextMenuProps,
): MenuProps["items"] {
  const {
    locked,
    priority,
    onSetPriority,
    onReschedule,
    onDuplicate,
    onAddSubTask,
    onLinkParent,
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
      key: "duplicate",
      icon: <CopyOutlined />,
      label: "复制",
      disabled: locked,
      onClick: onDuplicate,
    },
    {
      key: "addSubTask",
      icon: <PlusOutlined />,
      label: "添加子任务…",
      disabled: locked,
      onClick: onAddSubTask,
    },
    {
      key: "linkParent",
      icon: <LinkOutlined />,
      label: "关联主任务…",
      disabled: locked,
      onClick: onLinkParent,
    },
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
