import { describe, expect, it } from "vitest";
// StudentProfilePage imports these same helpers for its week-plan query key,
// so this file is the single behavioral contract for both call sites.
import { mondayOf, shiftWeek } from "./WeekPlanEditor";

// The helpers must use plain local year/month/day arithmetic, never a
// toISOString() round-trip: in zones ahead of UTC (e.g. UTC+8) the round-trip
// maps a local Monday midnight to the previous UTC Sunday, and the week
// window silently becomes Sunday→Saturday. The expected Mondays below are
// calendar facts, so these assertions hold in any host timezone.
describe("week-plan date helpers", () => {
  it("returns the Monday of the ISO week containing a Friday", () => {
    expect(mondayOf("2026-08-28")).toBe("2026-08-24");
  });

  it("keeps a Monday as itself", () => {
    expect(mondayOf("2026-08-24")).toBe("2026-08-24");
  });

  it("maps a Sunday to the previous Monday, not the next one", () => {
    expect(mondayOf("2026-08-23")).toBe("2026-08-17");
  });

  it("crosses the year boundary into the previous December", () => {
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
  });

  it("shifts whole weeks without drifting a day", () => {
    expect(shiftWeek("2026-08-24", 1)).toBe("2026-08-31");
    expect(shiftWeek("2026-08-24", -1)).toBe("2026-08-17");
    expect(shiftWeek("2026-12-28", 1)).toBe("2027-01-04");
  });

  it("stays on Monday across consecutive round-trips", () => {
    let week = mondayOf("2026-08-28");
    for (let i = 0; i < 8; i += 1) {
      week = shiftWeek(week, 1);
    }
    expect(week).toBe("2026-10-19");
    expect(mondayOf(week)).toBe(week);
  });
});
