import type { MenuProps } from "antd";
import { describe, expect, it, vi } from "vitest";
import { buildTaskMenuItems } from "./TaskContextMenu";

type MenuItem = Exclude<NonNullable<MenuProps["items"]>[number], null>;

function carryItem(
  canCarryForward: boolean,
  onCarryForward: (() => void) | undefined,
) {
  const items = buildTaskMenuItems({
    locked: false,
    canCarryForward,
    onCarryForward,
    onReschedule: vi.fn(),
    onDuplicate: vi.fn(),
    onViewDetail: vi.fn(),
    onDelete: vi.fn(),
  });
  return items?.find(
    (item): item is MenuItem =>
      item != null && "key" in item && item.key === "carryForward",
  );
}

describe("TaskContextMenu carry command", () => {
  it("enables carry only when the task is eligible", () => {
    expect(carryItem(true, vi.fn())).toMatchObject({ disabled: false });
    expect(carryItem(false, vi.fn())).toMatchObject({ disabled: true });
  });

  it("disables carry when no command handler is available", () => {
    const item = carryItem(true, undefined);
    expect(item).toMatchObject({ disabled: true });
  });
});

describe("TaskContextMenu createNext command", () => {
  const baseProps = {
    locked: false,
    canCarryForward: false,
    onReschedule: vi.fn(),
    onDuplicate: vi.fn(),
    onViewDetail: vi.fn(),
    onDelete: vi.fn(),
  };

  function nextItem(onCreateNext: (() => void) | undefined) {
    const items = buildTaskMenuItems({ ...baseProps, onCreateNext });
    return items?.find(
      (item): item is MenuItem =>
        item != null && "key" in item && item.key === "createNext",
    );
  }

  it("appears only when a createNext handler is wired", () => {
    expect(nextItem(vi.fn())).toMatchObject({ disabled: false });
    expect(nextItem(undefined)).toBeUndefined();
  });

  it("stays disabled for locked tasks", () => {
    const items = buildTaskMenuItems({
      ...baseProps,
      locked: true,
      onCreateNext: vi.fn(),
    });
    const item = items?.find(
      (item): item is MenuItem =>
        item != null && "key" in item && item.key === "createNext",
    );
    expect(item).toMatchObject({ disabled: true });
  });
});

describe("TaskContextMenu convertToLongTask command", () => {
  const baseProps = {
    locked: false,
    canCarryForward: false,
    onReschedule: vi.fn(),
    onDuplicate: vi.fn(),
    onViewDetail: vi.fn(),
    onDelete: vi.fn(),
  };

  function convertItem(onConvertToLongTask: (() => void) | undefined) {
    const items = buildTaskMenuItems({ ...baseProps, onConvertToLongTask });
    return items?.find(
      (item): item is MenuItem =>
        item != null && "key" in item && item.key === "convertToLongTask",
    );
  }

  it("appears only for eligible tasks (the page wires the handler)", () => {
    expect(convertItem(vi.fn())).toMatchObject({ disabled: false });
    // TRACK/locked/history tasks never receive the handler from pages.
    expect(convertItem(undefined)).toBeUndefined();
  });

  it("invokes the convert handler on click", () => {
    const handler = vi.fn();
    const item = convertItem(handler);
    expect(item).toBeDefined();
    if (item && "onClick" in item && item.onClick) {
      (item.onClick as () => void)();
    }
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// The menu is deliberately short. 子任务 and 关联主任务 are gone: the latter
// asked the assistant to type a task UUID by hand, and no assistant should
// ever see a UUID. The DB columns stay; the commands must not come back.
describe("TaskContextMenu surface", () => {
  const keys = new Set(
    (
      buildTaskMenuItems({
        locked: false,
        canCarryForward: true,
        onCarryForward: vi.fn(),
        onSetPriority: vi.fn(),
        onReschedule: vi.fn(),
        onDuplicate: vi.fn(),
        onCreateNext: vi.fn(),
        onConvertToLongTask: vi.fn(),
        onViewDetail: vi.fn(),
        onDelete: vi.fn(),
      }) ?? []
    ).flatMap((item) =>
      item != null && "key" in item && typeof item.key === "string"
        ? [item.key]
        : [],
    ),
  );

  it("offers exactly the commands an assistant needs", () => {
    expect([...keys]).toEqual([
      "priority",
      "reschedule",
      "carryForward",
      "duplicate",
      "createNext",
      "convertToLongTask",
      "viewDetail",
      "delete",
    ]);
  });

  it("never offers subtask or link-parent (they needed a hand-typed UUID)", () => {
    expect(keys.has("addSubTask")).toBe(false);
    expect(keys.has("linkParent")).toBe(false);
  });

  it("labels series continuation without template jargon", () => {
    const item = (
      buildTaskMenuItems({
        locked: false,
        canCarryForward: false,
        onReschedule: vi.fn(),
        onDuplicate: vi.fn(),
        onCreateNext: vi.fn(),
        onViewDetail: vi.fn(),
        onDelete: vi.fn(),
      }) ?? []
    ).find(
      (entry): entry is MenuItem =>
        entry != null && "key" in entry && entry.key === "createNext",
    );
    expect(item).toMatchObject({ label: "继续这个系列" });
  });
});
