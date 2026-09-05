import { DeleteOutlined, FlagFilled, FlagOutlined } from "@ant-design/icons";
import {
  Checkbox,
  Dropdown,
  Popconfirm,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { MenuProps } from "antd";
import { useState } from "react";
import { buildTaskMenuItems } from "./TaskContextMenu";
import { getPlatformAdapter } from "../../lib/platform/runtimePlatformAdapter";
import { RescheduleModal } from "./RescheduleModal";
import type { Priority, TaskLike } from "./taskApi";

export type TaskDensity = "compact" | "expanded";

export interface TaskCardProps {
  task: TaskLike;
  /** Called when the checkbox is ticked (complete). */
  onComplete: (task: TaskLike) => void;
  /** Called when the checkbox is cleared (reopen). */
  onReopen: (task: TaskLike) => void;
  /** Called with the new target date when the user picks a date. */
  onReschedule?: (task: TaskLike, targetDate: string) => void;
  /** Carries a pending task to its next available study date. */
  onCarryForward?: (task: TaskLike) => void;
  /** Called when the user confirms deletion. */
  onDelete: (task: TaskLike) => void;
  /** Called with an optional target date when the user duplicates. */
  onDuplicate: (task: TaskLike, targetDate?: string) => void;
  /** 系列推进：生成“序号+1、排到下一天”的新任务（右键菜单项）。 */
  onCreateNext?: (task: TaskLike) => void;
  /** 原地升级为长期任务（右键菜单项；仅待办普通任务由父级启用）。 */
  onConvertToLongTask?: (task: TaskLike) => void;
  /** Called when the user submits a new subtask title. */
  onAddSubTask: (task: TaskLike, title: string) => void;
  /** Called with the chosen main/parent task id when the user links. */
  onLinkParent?: (task: TaskLike, linkedParentTaskId: string) => void;
  /** Called when the user clicks "查看详情". */
  onViewDetail: (task: TaskLike) => void;
  /** Called with the next priority when the user cycles the flag. */
  onSetPriority?: (task: TaskLike, next: Priority) => void;
  /** Number of subtasks under this task. */
  subtaskCount?: number;
  density?: TaskDensity;
  draggable?: boolean;
  /** Optional extra node rendered at the far right (e.g. move button). */
  extra?: React.ReactNode;
}

/** Flag color per priority. NONE/LOW render no visible flag. */
const priorityFlagColor: Record<Priority, string | null> = {
  HIGH: "#ff4d4f",
  MEDIUM: "#faad14",
  LOW: null,
  NONE: null,
};

function priorityLabel(p: Priority): string {
  switch (p) {
    case "HIGH":
      return "高";
    case "MEDIUM":
      return "中";
    case "LOW":
      return "低";
    default:
      return "";
  }
}

/** Next priority when the user clicks the flag. HIGH → MEDIUM → NONE. */
function nextPriority(p: Priority): Priority {
  switch (p) {
    case "HIGH":
      return "MEDIUM";
    case "MEDIUM":
      return "NONE";
    default:
      return "HIGH";
  }
}

function isPriority(value: unknown): value is Priority {
  return (
    value === "HIGH" ||
    value === "MEDIUM" ||
    value === "LOW" ||
    value === "NONE"
  );
}

/**
 * TickTick-style shared task card. Pure presentational + callbacks — the
 * parent component injects all mutation handlers so this card can be reused
 * across Today, Schedule, Workbench, etc.
 *
 * Interactions:
 *  - checkbox: complete/reopen (disabled when locked)
 *  - star icon: toggles star, calls onToggleStar
 *  - hover: floating delete button (Popconfirm) appears at the far right
 *  - right-click: antd Dropdown context menu (reschedule / duplicate /
 *    add subtask / link parent / view detail / delete)
 *  - locked tasks: all interactions disabled, visually muted
 */
export function TaskCard({
  task,
  onComplete,
  onReopen,
  onReschedule,
  onCarryForward,
  onDelete,
  onDuplicate,
  onCreateNext,
  onConvertToLongTask,
  onAddSubTask,
  onLinkParent,
  onViewDetail,
  onSetPriority,
  subtaskCount,
  density = "compact",
  draggable = false,
  extra,
}: TaskCardProps) {
  const completed = task.status === "COMPLETED";
  const locked = task.locked;
  // INT-CAL-008 / ACC-074: a carried-over source row is history. It keeps its
  // place so the trail is visible, but it must not be tickable as if it were
  // still today's work — the live task is the carry-forward target.
  const history = task.carriedOver === true;
  const actionable = !locked && !history;
  // A BLOCKED task is NOT locked: reschedule (drag or context menu) is its
  // only documented way out (PRD §7.1 BLOCKED → PENDING 人工重新安排), so
  // the card must keep the menu, drag, priority and delete available. The
  // checkbox is the single control that stays off: a blocked task cannot be
  // completed (domain only completes PENDING) nor reopened (COMPLETED only).
  const completable = actionable && task.status !== "BLOCKED";
  const priority: Priority = isPriority(task.priority) ? task.priority : "NONE";
  const flagColor = priorityFlagColor[priority];
  const [hovered, setHovered] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  const menuItems: MenuProps["items"] = buildTaskMenuItems({
    // History rows are treated like locked rows in the menu: no reschedule,
    // no delete, no priority edits on something that already moved on.
    locked: !actionable,
    canCarryForward: task.status === "PENDING" && !task.locked,
    priority,
    onSetPriority: onSetPriority
      ? (next) => onSetPriority(task, next)
      : undefined,
    onReschedule: () => setRescheduleOpen(true),
    onCarryForward: onCarryForward ? () => onCarryForward(task) : undefined,
    onDuplicate: () => onDuplicate(task),
    onCreateNext: onCreateNext ? () => onCreateNext(task) : undefined,
    onConvertToLongTask: onConvertToLongTask
      ? () => onConvertToLongTask(task)
      : undefined,
    onAddSubTask: () => {
      void getPlatformAdapter()
        .requestText({ title: "子任务标题" })
        .then((title) => {
          if (title && title.trim()) onAddSubTask(task, title.trim());
        });
    },
    onLinkParent: () => {
      if (!onLinkParent) return;
      void getPlatformAdapter()
        .requestText({ title: "关联主任务 ID（UUID）" })
        .then((id) => {
          if (id && id.trim()) onLinkParent(task, id.trim());
        });
    },
    onViewDetail: () => onViewDetail(task),
    onDelete: () => onDelete(task),
  });

  function handleFlagClick(e: React.MouseEvent): void {
    // The flag sits inside the Checkbox's label subtree. A bare stopPropagation
    // does not stop the native label→input toggle, so clicking the flag would
    // also flip the checkbox. preventDefault cancels that label association.
    e.preventDefault();
    e.stopPropagation();
    if (locked || !onSetPriority) return;
    onSetPriority(task, nextPriority(priority));
  }

  return (
    <>
      <Dropdown
        menu={{ items: menuItems }}
        trigger={["contextMenu"]}
        disabled={locked}
      >
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            position: "relative",
            padding: density === "expanded" ? "8px 12px" : "4px 8px",
            borderRadius: 6,
            cursor: draggable ? (locked ? "not-allowed" : "grab") : "default",
            opacity: completed || locked ? 0.65 : 1,
            transition: "background-color 0.15s ease",
            background: hovered ? "rgba(0,0,0,0.03)" : "transparent",
          }}
        >
          <Space
            size="small"
            style={{
              width: "100%",
              paddingRight: hovered && actionable ? 28 : 0,
              // Weakened styling for history rows (INT-CAL-008).
              opacity: history ? 0.6 : undefined,
            }}
          >
            <Checkbox
              checked={completed}
              disabled={!completable}
              onChange={(e) => {
                if (e.target.checked) onComplete(task);
                else onReopen(task);
              }}
              aria-label={`任务 ${task.shortTitle ?? task.title}`}
            >
              <Space size="small" style={{ minWidth: 0 }}>
                <Typography.Text
                  delete={completed}
                  strong={!completed}
                  ellipsis
                  title={task.shortTitle ?? task.title}
                  style={{
                    textDecoration: completed ? "line-through" : undefined,
                    // Let the title take the available width and truncate with
                    // an ellipsis when the parent constrains it, instead of
                    // wrapping and pushing the flag/tags onto new lines.
                    display: "inline-block",
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    verticalAlign: "middle",
                  }}
                >
                  {task.shortTitle ?? task.title}
                </Typography.Text>
                {flagColor ? (
                  <button
                    type="button"
                    onClick={handleFlagClick}
                    disabled={locked}
                    aria-label={`优先级 ${priorityLabel(priority)}（点击切换）`}
                    style={{
                      border: "none",
                      background: "transparent",
                      cursor: locked ? "not-allowed" : "pointer",
                      padding: 0,
                      color: flagColor,
                      fontSize: 14,
                      lineHeight: 1,
                    }}
                  >
                    <FlagFilled />
                  </button>
                ) : onSetPriority ? (
                  <button
                    type="button"
                    onClick={handleFlagClick}
                    disabled={locked}
                    aria-label="设置优先级"
                    style={{
                      border: "none",
                      background: "transparent",
                      cursor: locked ? "not-allowed" : "pointer",
                      padding: 0,
                      color: "#bfbfbf",
                      fontSize: 14,
                      lineHeight: 1,
                    }}
                  >
                    <FlagOutlined />
                  </button>
                ) : null}
                {subtaskCount != null && subtaskCount > 0 ? (
                  <Tag>{subtaskCount} 子任务</Tag>
                ) : null}
                {task.itemOrdinal != null ? (
                  <Tag>第{task.itemOrdinal}节</Tag>
                ) : null}
                {task.durationMinutes != null ? (
                  <Typography.Text type="secondary">
                    {task.durationMinutes}分钟
                  </Typography.Text>
                ) : null}
                {task.carriedOver ? (
                  // DLY-022: surface the carry origin when the adapter emits
                  // it; the bare badge still renders as a graceful fallback.
                  task.carriedFromDate ? (
                    <Tooltip title={`由 ${task.carriedFromDate} 顺延`}>
                      <Tag color="orange">顺延</Tag>
                    </Tooltip>
                  ) : (
                    <Tag color="orange">顺延</Tag>
                  )
                ) : null}
                {task.status === "BLOCKED" ? (
                  <Tooltip title="无可学习日可顺延；改期（拖拽或右键菜单）后回到待办">
                    <Tag color="red">阻塞</Tag>
                  </Tooltip>
                ) : null}
                {task.locked ? <Tag color="default">锁定</Tag> : null}
                {extra}
              </Space>
            </Checkbox>
          </Space>

          {/* Hover delete button — fades in, Popconfirm guards the action */}
          {actionable && onDelete ? (
            <Popconfirm
              title="确认删除"
              description="确定要删除此任务吗？"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => onDelete(task)}
            >
              <button
                type="button"
                aria-label="删除任务"
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  right: 4,
                  top: "50%",
                  transform: "translateY(-50%)",
                  opacity: hovered ? 1 : 0,
                  pointerEvents: hovered ? "auto" : "none",
                  transition: "opacity 0.15s ease",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: "#ff4d4f",
                  fontSize: 14,
                  padding: 4,
                }}
              >
                <DeleteOutlined />
              </button>
            </Popconfirm>
          ) : null}
        </div>
      </Dropdown>

      {onReschedule ? (
        <RescheduleModal
          open={rescheduleOpen}
          taskId={task.id}
          taskVersion={task.version}
          initialDate={task.scheduledDate}
          onCancel={() => setRescheduleOpen(false)}
          onSuccess={(targetDate) => {
            setRescheduleOpen(false);
            onReschedule(task, targetDate);
          }}
        />
      ) : null}
    </>
  );
}

export default TaskCard;
