import {
  FlagFilled,
  HistoryOutlined,
  LockOutlined,
  MoreOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Button,
  Checkbox,
  Dropdown,
  Modal,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { MenuProps } from "antd";
import { useEffect, useRef, useState } from "react";
import { parseSeriesTitleCandidates } from "../../domain/task/seriesTitle";
import { buildTaskMenuItems } from "./TaskContextMenu";
import { itemOrdinalLabel } from "./itemOrdinalLabel";
import { RescheduleModal } from "./RescheduleModal";
import { SeriesNumberPicker } from "./SeriesNumberPicker";
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
  /** 系列推进：接着排下一项（右键菜单「继续这个系列」）。 */
  onCreateNext?: (task: TaskLike, numberIndex?: number) => void;
  /** 原地升级为长期任务（右键菜单项；仅待办普通任务由父级启用）。 */
  onConvertToLongTask?: (task: TaskLike, numberIndex?: number) => void;
  /** 标题双击改名；未提供时仍保持原来的只读标题行为。 */
  onRename?: (task: TaskLike, title: string) => void;
  /** Called when the user clicks "查看详情". */
  onViewDetail: (task: TaskLike) => void;
  /** Menu entries owned by the surrounding cell (copy/rest-day actions). */
  cellMenuItems?: MenuProps["items"];
  /** Called with the next priority when the user cycles the flag. */
  onSetPriority?: (task: TaskLike, next: Priority) => void;
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

// Keep the single-click action pending until the browser has had a chance to
// dispatch the matching double-click event. This avoids opening details before
// a rename gesture can cancel the first click.
const SINGLE_CLICK_DELAY_MS = 500;

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

/** Shared task row; commands are supplied by each task view. */
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
  onRename,
  onViewDetail,
  cellMenuItems,
  onSetPriority,
  density = "compact",
  draggable = false,
  extra,
}: TaskCardProps) {
  const completed = task.status === "COMPLETED";
  const locked = task.locked;
  // INT-CAL-008 / ACC-074: a carried-over source row is history. It keeps its
  // place so the trail is visible, but it must not be tickable as if it were
  // still today's work — the live task is the carry-forward target.
  const history =
    task.carriedOver === true ||
    task.status === "CARRIED_OVER" ||
    task.status === "CANCELLED";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState(task.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const skipRenameBlur = useRef(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [seriesAction, setSeriesAction] = useState<"next" | "convert" | null>(
    null,
  );
  const ordinalLabel = itemOrdinalLabel(task);
  const seriesCandidates = parseSeriesTitleCandidates(task.title);

  const clearTitleClickTimer = () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  };

  function runSeriesAction(
    action: "next" | "convert",
    numberIndex?: number,
  ): void {
    const callback = action === "next" ? onCreateNext : onConvertToLongTask;
    if (!callback) return;
    if (numberIndex == null && seriesCandidates.length > 1) {
      setSeriesAction(action);
      return;
    }
    callback(task, seriesCandidates.length > 1 ? numberIndex : undefined);
  }

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
    onCreateNext: onCreateNext ? () => runSeriesAction("next") : undefined,
    onConvertToLongTask: onConvertToLongTask
      ? () => runSeriesAction("convert")
      : undefined,
    onViewDetail: () => onViewDetail(task),
    onDelete: () => setDeleteOpen(true),
  });
  const combinedMenuItems: MenuProps["items"] = [
    ...(cellMenuItems ?? []),
    ...(cellMenuItems && cellMenuItems.length > 0
      ? [{ type: "divider" as const }]
      : []),
    ...(menuItems ?? []),
  ];

  useEffect(
    () => () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    },
    [],
  );

  function handleFlagClick(e: React.MouseEvent): void {
    e.stopPropagation();
    if (!actionable || !onSetPriority) return;
    onSetPriority(task, nextPriority(priority));
  }

  return (
    <>
      <Dropdown
        menu={{
          items: combinedMenuItems,
          onClick: () => setMenuOpen(false),
        }}
        trigger={["contextMenu"]}
        open={menuOpen}
        onOpenChange={setMenuOpen}
      >
        <div
          onContextMenu={(event) => event.stopPropagation()}
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
          <div
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 6,
              minWidth: 0,
              opacity: history ? 0.6 : undefined,
            }}
          >
            <span
              onPointerDown={(event) => event.stopPropagation()}
              style={{ display: "inline-flex", flexShrink: 0 }}
            >
              <Checkbox
                checked={completed}
                disabled={!completable}
                onChange={(e) => {
                  if (e.target.checked) onComplete(task);
                  else onReopen(task);
                }}
                aria-label={`任务 ${task.shortTitle ?? task.title}`}
              />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              {editingTitle && onRename ? (
                <input
                  autoFocus
                  value={renameDraft}
                  aria-label="编辑任务标题"
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onBlur={() => {
                    if (skipRenameBlur.current) {
                      skipRenameBlur.current = false;
                      return;
                    }
                    const nextTitle = renameDraft.trim();
                    setEditingTitle(false);
                    if (nextTitle && nextTitle !== task.title) {
                      onRename(task, nextTitle);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      skipRenameBlur.current = true;
                      event.currentTarget.blur();
                      setRenameDraft(task.title);
                      setEditingTitle(false);
                    } else if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                  style={{
                    width: "100%",
                    border: "1px solid #1677ff",
                    borderRadius: 4,
                    padding: "2px 4px",
                    font: "inherit",
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={(event) => {
                    // React dispatches a second click (detail === 2) before
                    // the dblclick event. Cancel the pending single action at
                    // both points so details are never opened for a rename.
                    if (event.detail > 1) {
                      clearTitleClickTimer();
                      return;
                    }
                    clearTitleClickTimer();
                    clickTimerRef.current = setTimeout(() => {
                      clickTimerRef.current = null;
                      onViewDetail(task);
                    }, SINGLE_CLICK_DELAY_MS);
                  }}
                  onDoubleClick={(event) => {
                    clearTitleClickTimer();
                    if (!onRename || !actionable) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setRenameDraft(task.title);
                    setEditingTitle(true);
                  }}
                  aria-label={`查看任务 ${task.shortTitle ?? task.title}`}
                  title={task.shortTitle ?? task.title}
                  style={{
                    border: 0,
                    padding: 0,
                    background: "transparent",
                    color: "inherit",
                    font: "inherit",
                    fontWeight: completed ? 400 : 600,
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                    textDecoration: completed ? "line-through" : undefined,
                    display: "block",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {task.shortTitle ?? task.title}
                </button>
              )}
              {density === "expanded" &&
              (ordinalLabel ||
                task.durationMinutes != null ||
                task.carriedOver ||
                task.status === "BLOCKED" ||
                task.locked) ? (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {ordinalLabel ? <Tag>{ordinalLabel}</Tag> : null}
                  {task.durationMinutes != null ? (
                    <Typography.Text type="secondary">
                      {task.durationMinutes}分钟
                    </Typography.Text>
                  ) : null}
                  {task.carriedOver ? (
                    <Tooltip
                      title={
                        task.carriedFromDate
                          ? `由 ${task.carriedFromDate} 顺延`
                          : undefined
                      }
                    >
                      <Tag color="orange">顺延</Tag>
                    </Tooltip>
                  ) : null}
                  {task.status === "BLOCKED" ? (
                    <Tooltip title="暂无可学习日">
                      <Tag color="red">阻塞</Tag>
                    </Tooltip>
                  ) : null}
                  {task.locked ? <Tag color="default">锁定</Tag> : null}
                </div>
              ) : null}
            </div>
            {flagColor ? (
              <button
                type="button"
                onClick={handleFlagClick}
                disabled={!actionable}
                onPointerDown={(event) => event.stopPropagation()}
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
            ) : null}
            {density === "compact" && history ? (
              <Tooltip
                title={
                  task.carriedFromDate
                    ? `由 ${task.carriedFromDate} 顺延`
                    : "顺延记录"
                }
              >
                <HistoryOutlined
                  aria-label="顺延记录"
                  style={{ color: "#d48806" }}
                />
              </Tooltip>
            ) : null}
            {density === "compact" && task.status === "BLOCKED" ? (
              <Tooltip title="暂无可学习日">
                <WarningOutlined
                  aria-label="阻塞"
                  style={{ color: "#cf1322" }}
                />
              </Tooltip>
            ) : null}
            {density === "compact" && locked ? (
              <Tooltip title="锁定">
                <LockOutlined aria-label="锁定" />
              </Tooltip>
            ) : null}
            {extra ? (
              <span
                style={{ flexShrink: 0 }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                {extra}
              </span>
            ) : null}
            <Tooltip title="更多操作">
              <Button
                type="text"
                size="small"
                icon={<MoreOutlined />}
                aria-label={`更多操作 ${task.shortTitle ?? task.title}`}
                style={{ flexShrink: 0, width: 24, height: 24 }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen((open) => !open);
                }}
              />
            </Tooltip>
          </div>
        </div>
      </Dropdown>

      {deleteOpen ? (
        <Modal
          open
          title="删除任务"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onCancel={() => setDeleteOpen(false)}
          onOk={() => {
            setDeleteOpen(false);
            onDelete(task);
          }}
        >
          <Typography.Text>{task.title}</Typography.Text>
        </Modal>
      ) : null}

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

      {seriesAction ? (
        <SeriesNumberPicker
          open
          title={task.title}
          candidates={seriesCandidates}
          onCancel={() => setSeriesAction(null)}
          onConfirm={(numberIndex) => {
            const action = seriesAction;
            setSeriesAction(null);
            if (action === "next") onCreateNext?.(task, numberIndex);
            else onConvertToLongTask?.(task, numberIndex);
          }}
        />
      ) : null}
    </>
  );
}

export default TaskCard;
