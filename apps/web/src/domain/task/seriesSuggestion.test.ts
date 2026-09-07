import { describe, expect, it } from "vitest";
import {
  detectSeriesSuggestions,
  SERIES_SUGGESTION_MIN_RUN,
  type SeriesAssignmentRow,
} from "./seriesSuggestion";

function row(
  title: string,
  over: Partial<SeriesAssignmentRow> = {},
): SeriesAssignmentRow {
  return {
    id: `task-${title}`,
    title,
    sourceType: "AD_HOC",
    status: "PENDING",
    locked: false,
    scheduledDate: "2026-09-05",
    version: 0,
    ...over,
  };
}

function series(prefix: string, ordinals: readonly number[]) {
  return ordinals.map((n) => row(`${prefix}${n}`));
}

describe("detectSeriesSuggestions", () => {
  it("asks after four consecutive ordinals and targets the latest item", () => {
    const [suggestion, ...rest] = detectSeriesSuggestions(
      series("一天一句长难句day", [1, 2, 3, 4]),
    );

    expect(rest).toHaveLength(0);
    expect(suggestion).toMatchObject({
      seriesName: "一天一句长难句",
      titlePattern: "一天一句长难句day{n}",
      assignmentCount: 4,
      latestOrdinal: 4,
      nextOrdinal: 5,
      taskId: "task-一天一句长难句day4",
    });
  });

  it("stays silent below the run threshold", () => {
    expect(SERIES_SUGGESTION_MIN_RUN).toBe(4);
    expect(detectSeriesSuggestions(series("密卷", [1, 2, 3]))).toEqual([]);
  });

  // 连续性只看末尾一段：[1,2,4,5,6] 的末尾连续长度是 3。
  it("counts only the trailing consecutive run", () => {
    expect(detectSeriesSuggestions(series("密卷", [1, 2, 4, 5, 6]))).toEqual(
      [],
    );
    expect(
      detectSeriesSuggestions(series("密卷", [1, 3, 4, 5, 6])),
    ).toHaveLength(1);
  });

  // §13：尾部数字是弱信号，单个「真题2024」不能推断成系列。
  it("never fires on a single trailing number", () => {
    expect(detectSeriesSuggestions([row("真题2024")])).toEqual([]);
  });

  it("ignores titles that are nothing but digits", () => {
    expect(detectSeriesSuggestions(series("", [1, 2, 3, 4]))).toEqual([]);
  });

  it("skips rows the assistant did not hand-assign or already cancelled", () => {
    const tracked = series("密卷", [1, 2, 3, 4]).map((r) => ({
      ...r,
      sourceType: "TRACK",
    }));
    expect(detectSeriesSuggestions(tracked)).toEqual([]);

    const cancelled = series("密卷", [1, 2, 3, 4]).map((r) => ({
      ...r,
      status: "CANCELLED",
    }));
    expect(detectSeriesSuggestions(cancelled)).toEqual([]);
  });

  // 升级落点必须是最大序号那一项；它不可升级时先不问，下次接排再问。
  it("waits when the latest item cannot be converted in place", () => {
    const done = series("密卷", [1, 2, 3, 4]);
    done[3] = { ...done[3], status: "COMPLETED" };
    expect(detectSeriesSuggestions(done)).toEqual([]);

    const locked = series("密卷", [1, 2, 3, 4]);
    locked[3] = { ...locked[3], locked: true };
    expect(detectSeriesSuggestions(locked)).toEqual([]);

    const undated = series("密卷", [1, 2, 3, 4]);
    undated[3] = { ...undated[3], scheduledDate: null };
    expect(detectSeriesSuggestions(undated)).toEqual([]);
  });

  it("counts completed items but converts the pending latest one", () => {
    const rows = series("密卷", [1, 2, 3, 4]).map((r, i) =>
      i < 3 ? { ...r, status: "COMPLETED" } : r,
    );
    expect(detectSeriesSuggestions(rows)).toMatchObject([
      { assignmentCount: 4, taskId: "task-密卷4" },
    ]);
  });

  it("suppresses series listed in excludeKeys", () => {
    const rows = series("密卷", [1, 2, 3, 4]);
    expect(
      detectSeriesSuggestions(rows, { excludeKeys: new Set(["密卷"]) }),
    ).toEqual([]);
  });

  // 后缀不同是两个系列：「长难句 第3天」与「长难句 第3」各自计数。
  it("splits series that share a prefix but differ in suffix", () => {
    const rows = [
      ...series("长难句 第", [1, 2, 3, 4]),
      ...[1, 2, 3, 4].map((n) => row(`长难句 第${n}天`)),
    ];
    const found = detectSeriesSuggestions(rows);
    expect(found).toHaveLength(2);
    expect(found.map((s) => s.titlePattern).sort()).toEqual([
      "长难句 第{n}",
      "长难句 第{n}天",
    ]);
  });

  it("orders the longest run first", () => {
    const rows = [
      ...series("密卷", [1, 2, 3, 4]),
      ...series("真题", [1, 2, 3, 4, 5, 6]),
    ];
    expect(detectSeriesSuggestions(rows).map((s) => s.seriesName)).toEqual([
      "真题",
      "密卷",
    ]);
  });

  it("matches full-width and case variants onto one normalized key", () => {
    const rows = [
      row("Day1"),
      row("day2"),
      row("DAY3"),
      row("Ｄａｙ4"),
      row("day5"),
    ];
    expect(detectSeriesSuggestions(rows)).toHaveLength(1);
  });
});
