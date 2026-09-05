import { describe, expect, it } from "vitest";
import {
  findDateToken,
  matchStudents,
  parseQuickAddText,
  type QuickAddStudent,
} from "./quickAddParser";

const TODAY = "2026-08-30"; // 周日

const students: QuickAddStudent[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "林同学",
    alias: "小林",
    studentCode: "S001",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "王小明",
    alias: null,
    studentCode: "S002",
  },
];

function shiftToday(days: number): string {
  const date = new Date(TODAY);
  date.setDate(date.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

describe("findDateToken", () => {
  it("resolves relative keywords from the anchor date", () => {
    expect(findDateToken("明天 复习", TODAY)?.date).toBe(shiftToday(1));
    expect(findDateToken("后天 复习", TODAY)?.date).toBe(shiftToday(2));
    expect(findDateToken("大后天 复习", TODAY)?.date).toBe(shiftToday(3));
    expect(findDateToken("今天 复习", TODAY)?.date).toBe(TODAY);
  });

  it("resolves 周X to the next occurrence and 下周X to next week", () => {
    // 今天是周日：本周一已过 → 下周一。
    expect(findDateToken("周一 听写", TODAY)?.date).toBe("2026-08-31");
    expect(findDateToken("周五 听写", TODAY)?.date).toBe("2026-09-04");
    expect(findDateToken("下周三 听写", TODAY)?.date).toBe("2026-09-09");
    expect(findDateToken("下下周三 听写", TODAY)?.date).toBe("2026-09-16");
  });

  it("resolves M月D日 and M-D short forms, rolling to next year when past", () => {
    expect(findDateToken("9月1日 口算", TODAY)?.date).toBe("2026-09-01");
    expect(findDateToken("9/1 前的 8-31", TODAY)?.date).toBe("2026-08-31");
    // 1月1日在今年已过 → 明年。
    expect(findDateToken("1月1日 口算", TODAY)?.date).toBe("2027-01-01");
  });

  it("resolves exact ISO dates and rejects impossible calendar days", () => {
    expect(findDateToken("2026-12-31 阅读", TODAY)?.date).toBe("2026-12-31");
    expect(findDateToken("2026-2-30 阅读", TODAY)).toBeNull();
    expect(findDateToken("没有日期的输入", TODAY)).toBeNull();
  });

  it("resolves TickTick-style compact and Chinese-numeral dates", () => {
    // 0831 → 8月31日；四位数字前后紧贴数字时不误判（10831）。
    expect(findDateToken("0831 复习", TODAY)).toMatchObject({
      date: "2026-08-31",
      label: "8月31日",
    });
    expect(findDateToken("10831", TODAY)).toBeNull();
    // 中文数字月份 + 中文/阿拉伯日。
    expect(findDateToken("八月三十一 听写", TODAY)).toMatchObject({
      date: "2026-08-31",
      label: "8月31日",
    });
    expect(findDateToken("八月三十一日 听写", TODAY)?.label).toBe("8月31日");
    expect(findDateToken("十一月二十号 听写", TODAY)?.date).toBe("2026-11-20");
    // 八月1 今年已过 → 顺延到明年 8 月 1 日。
    expect(findDateToken("八月1 口算", TODAY)).toMatchObject({
      date: "2027-08-01",
      label: "8月1日",
    });
  });

  it("prefers the earliest token and keeps the longer weekday phrase", () => {
    const hit = findDateToken("下周三而不是周三", TODAY);
    expect(hit?.label).toBe("下周三");
    expect(hit?.date).toBe("2026-09-09");
  });
});

describe("matchStudents", () => {
  it("matches by name, alias and student code with longest token first", () => {
    const byAlias = matchStudents("小林 做口算", students);
    expect(byAlias[0]?.student.name).toBe("林同学");
    const byCode = matchStudents("S002 阅读", students);
    expect(byCode[0]?.student.name).toBe("王小明");
    const both = matchStudents("王小明和小林 一起", students);
    expect(both.map((candidate) => candidate.student.name)).toEqual([
      "王小明",
      "林同学",
    ]);
  });

  it("ignores single-character names to avoid false positives", () => {
    const single: QuickAddStudent[] = [
      {
        id: "10000000-0000-4000-8000-000000000003",
        name: "王",
        alias: null,
        studentCode: "S003",
      },
    ];
    expect(matchStudents("王同学今天请假", single)).toEqual([]);
  });
});

describe("parseQuickAddText", () => {
  it("splits student, date and title from a natural sentence", () => {
    const match = parseQuickAddText("林同学 明天 密卷08 阅读", students, TODAY);
    expect(match.student?.name).toBe("林同学");
    expect(match.date).toBe(shiftToday(1));
    expect(match.dateLabel).toBe("明天");
    expect(match.title).toBe("密卷08 阅读");
  });

  it("works without separators between segments", () => {
    const match = parseQuickAddText("王小明9月1日口算", students, TODAY);
    expect(match.student?.name).toBe("王小明");
    expect(match.date).toBe("2026-09-01");
    expect(match.title).toBe("口算");
  });

  it("splits compact 4-digit dates mixed with the title", () => {
    const match = parseQuickAddText("王小明0831口算", students, TODAY);
    expect(match.student?.name).toBe("王小明");
    expect(match.date).toBe("2026-08-31");
    expect(match.dateLabel).toBe("8月31日");
    expect(match.title).toBe("口算");
  });

  it("defaults to no date and keeps the full text when nothing matches", () => {
    const match = parseQuickAddText("临时安排", students, TODAY);
    expect(match.student).toBeNull();
    expect(match.date).toBeNull();
    expect(match.title).toBe("临时安排");
  });

  it("strips leading connectives after removing the student token", () => {
    const match = parseQuickAddText("给林同学 明天 听写", students, TODAY);
    expect(match.student?.name).toBe("林同学");
    expect(match.title).toBe("听写");
  });

  it("returns an empty match for empty input", () => {
    expect(parseQuickAddText("  ", students, TODAY)).toMatchObject({
      students: [],
      student: null,
      date: null,
      title: "",
    });
  });
});
