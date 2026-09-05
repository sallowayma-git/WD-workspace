import { describe, expect, it } from "vitest";
import {
  buildPlainTitlePattern,
  buildSeriesTitlePattern,
  formatSeriesTitle,
  isSameSeries,
  parseSeriesTitle,
  renderSeriesTitlePattern,
  seriesNormalizedKey,
} from "./seriesTitle";

describe("parseSeriesTitle", () => {
  it("parses trailing numbers, day-suffixed numbers and keeps prefix/suffix", () => {
    expect(parseSeriesTitle("一天一句长难句1")).toEqual({
      prefix: "一天一句长难句",
      number: 1,
      digits: "1",
      suffix: "",
    });
    expect(parseSeriesTitle("一天一句长难句day1")).toEqual({
      prefix: "一天一句长难句day",
      number: 1,
      digits: "1",
      suffix: "",
    });
    expect(parseSeriesTitle("长难句 第3天")).toEqual({
      prefix: "长难句 第",
      number: 3,
      digits: "3",
      suffix: "天",
    });
    expect(parseSeriesTitle("阅读 Day 12")).toEqual({
      prefix: "阅读 Day ",
      number: 12,
      digits: "12",
      suffix: "",
    });
  });

  it("returns null when the title does not end with a number", () => {
    expect(parseSeriesTitle("背单词")).toBeNull();
    expect(parseSeriesTitle("背50个单词")).toBeNull();
    expect(parseSeriesTitle("")).toBeNull();
  });

  it("keeps the digit string so leading zeros can be reproduced", () => {
    expect(parseSeriesTitle("Day010")?.digits).toBe("010");
  });
});

describe("isSameSeries", () => {
  it("matches by prefix and suffix regardless of the number", () => {
    const a = parseSeriesTitle("长难句day1")!;
    const b = parseSeriesTitle("长难句day3")!;
    const c = parseSeriesTitle("长难句第3天")!;
    expect(isSameSeries(a, b)).toBe(true);
    expect(isSameSeries(a, c)).toBe(false);
  });
});

describe("formatSeriesTitle", () => {
  it("renders the next number and preserves leading-zero width", () => {
    expect(formatSeriesTitle(parseSeriesTitle("一天一句长难句1")!, 2)).toBe(
      "一天一句长难句2",
    );
    expect(formatSeriesTitle(parseSeriesTitle("长难句 第3天")!, 4)).toBe(
      "长难句 第4天",
    );
    expect(formatSeriesTitle(parseSeriesTitle("Day010")!, 11)).toBe("Day011");
    expect(formatSeriesTitle(parseSeriesTitle("真题99")!, 100)).toBe("真题100");
  });
});

describe("sequence title pattern (长期任务模板)", () => {
  it("builds patterns with a {n} placeholder from parsed titles", () => {
    expect(
      buildSeriesTitlePattern({
        prefix: parseSeriesTitle("一天一句长难句 Day 1")!.prefix,
        suffix: "",
      }),
    ).toBe("一天一句长难句 Day {n}");
    expect(
      buildSeriesTitlePattern({
        prefix: parseSeriesTitle("密卷1")!.prefix,
        suffix: "",
      }),
    ).toBe("密卷{n}");
    expect(
      buildSeriesTitlePattern({
        prefix: parseSeriesTitle("长难句 第3天")!.prefix,
        suffix: "天",
      }),
    ).toBe("长难句 第{n}天");
  });

  it("falls back to a spaced placeholder when the title has no number", () => {
    expect(buildPlainTitlePattern("一天一句长难句")).toBe("一天一句长难句 {n}");
  });

  it("renders any ordinal from the pattern", () => {
    expect(renderSeriesTitlePattern("一天一句长难句 Day {n}", 17)).toBe(
      "一天一句长难句 Day 17",
    );
    expect(renderSeriesTitlePattern("密卷{n}", 33)).toBe("密卷33");
    expect(renderSeriesTitlePattern("长难句 第{n}天", 8)).toBe("长难句 第8天");
  });

  it("rejects patterns without exactly one placeholder or a bad ordinal", () => {
    expect(() => renderSeriesTitlePattern("没有占位符", 1)).toThrow();
    expect(() => renderSeriesTitlePattern("{n}{n}", 1)).toThrow();
    expect(() => renderSeriesTitlePattern("密卷{n}", 0)).toThrow();
  });

  it("normalizes keys for find-or-create (NFKC + whitespace + case)", () => {
    expect(seriesNormalizedKey("一天一句长难句 Day")).toBe(
      "一天一句长难句 day",
    );
    // 全角拉丁/数字折叠为半角。
    expect(seriesNormalizedKey("Ｄａｙ １")).toBe("day 1");
    expect(seriesNormalizedKey("  多  空格 ")).toBe("多 空格");
  });
});
