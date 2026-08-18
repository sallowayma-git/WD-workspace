import { DeleteOutlined, FlagFilled, FlagOutlined } from "@ant-design/icons";
import { Checkbox, Dropdown, Popconfirm, Space, Tag, Typography } from "antd";
import type { MenuProps } from "antd";
import { useState } from "react";
import { buildTaskMenuItems } from "./TaskContextMenu";
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
  /** Called when the user confirms deletion. */
  onDelete: (task: TaskLike) => void;
  /** Called with an optional target date when the user duplicates. */
  onDuplicate: (task: TaskLike, targetDate?: string) => void;
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
  onDelete,
  onDuplicate,
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
  const locked = task.locked || task.status === "BLOCKED";
  const priority: Priority = isPriority(task.priority) ? task.priority : "NONE";
  const flagColor = priorityFlagColor[priority];
  const [hovered, setHovered] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  const menuItems: MenuProps["items"] = buildTaskMenuItems({
    locked,
    priority,
    onSetPriority: onSetPriority
      ? (next) => onSetPriority(task, next)
      : undefined,
    onReschedule: () => setRescheduleOpen(true),
    onDuplicate: () => onDuplicate(task),
    onAddSubTask: () => {
      // Inline prompt for the subtask title. Using window.prompt keeps the
      // component dependency-free; parents wanting richer UX can wrap this
      // card and intercept the onAddSubTask callback instead.
      const title = window.prompt("子任务标题");
      if (title && title.trim()) onAddSubTask(task, title.trim());
    },
    onLinkParent: () => {
      if (!onLinkParent) return;
      const id = window.prompt("关联主任务 ID（UUID）");
      if (id && id.trim()) onLinkParent(task, id.trim());
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
            style={{ width: "100%", paddingRight: hovered && !locked ? 28 : 0 }}
          >
            <Checkbox
              checked={completed}
              disabled={locked}
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
                {task.carriedOver ? <Tag color="orange">顺延</Tag> : null}
                {task.locked ? <Tag color="default">锁定</Tag> : null}
                {extra}
              </Space>
            </Checkbox>
          </Space>

          {/* Hover delete button — fades in, Popconfirm guards the action */}
          {!locked && onDelete ? (
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
