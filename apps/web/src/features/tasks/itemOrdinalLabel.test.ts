import { describe, expect, it } from "vitest";
import { itemOrdinalLabel } from "./itemOrdinalLabel";
import type { TaskLike } from "./taskApi";

function task(fields: Partial<TaskLike>): TaskLike {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    title: "任务",
    status: "PENDING",
    sourceType: "TRACK",
    locked: false,
    version: 0,
    ...fields,
  };
}

// 「第 N 节」是排课工具的说法，这不是排课工具（§8）。逐项模板显示「第 N 项」；
// 长期任务的标题本身就是 Day 7，不再挂一个说同一个数字的标签。
describe("itemOrdinalLabel", () => {
  it("labels an itemized template item 第 N 项", () => {
    expect(
      itemOrdinalLabel(task({ title: "定语从句精讲", itemOrdinal: 7 })),
    ).toBe("第7项");
  });

  it("drops the tag when the title already ends with that ordinal", () => {
    expect(
      itemOrdinalLabel(task({ title: "一天一句长难句 Day 7", itemOrdinal: 7 })),
    ).toBeNull();
    expect(
      itemOrdinalLabel(task({ title: "长难句 第7天", itemOrdinal: 7 })),
    ).toBeNull();
    expect(
      itemOrdinalLabel(task({ title: "密卷33", itemOrdinal: 33 })),
    ).toBeNull();
  });

  it("reads the title the card actually renders (shortTitle wins)", () => {
    expect(
      itemOrdinalLabel(
        task({
          title: "一天一句长难句 Day 7",
          shortTitle: "长难句",
          itemOrdinal: 7,
        }),
      ),
    ).toBe("第7项");
  });

  it("keeps the tag when a trailing number is not the ordinal", () => {
    expect(itemOrdinalLabel(task({ title: "真题2024", itemOrdinal: 3 }))).toBe(
      "第3项",
    );
  });

  it("renders nothing for ad-hoc tasks without an ordinal", () => {
    expect(itemOrdinalLabel(task({ sourceType: "AD_HOC" }))).toBeNull();
    expect(itemOrdinalLabel(task({ itemOrdinal: null }))).toBeNull();
  });
});
