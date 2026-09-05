import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  buildMonthDays,
  formatBusinessDate,
  parseBusinessDate,
} from "./dateUtils";
import { MonthView } from "./MonthView";
import { canMoveCalendarEvent } from "./types";

describe("Flowclass month grid shell", () => {
  it("builds a stable Monday-first 42-day month grid", () => {
    const days = buildMonthDays(new Date(2026, 7, 15));
    expect(days).toHaveLength(42);
    expect(days[0].businessDate).toBe("2026-07-27");
    expect(days[41].businessDate).toBe("2026-09-06");
  });

  it("round-trips business dates without UTC drift", () => {
    expect(formatBusinessDate(parseBusinessDate("2026-08-19"))).toBe(
      "2026-08-19",
    );
  });

  it("lays out Monday-first weekday headers and 42 caller-rendered cells", () => {
    render(
      <MonthView
        anchorDate="2026-08-15"
        renderDay={(day) => (
          <div data-testid="cell" data-date={day.businessDate}>
            {day.isCurrentMonth ? "in" : "out"}
          </div>
        )}
      />,
    );

    const grid = screen.getByTestId("flowclass-month-view");
    const headers = within(grid).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "周一",
      "周二",
      "周三",
      "周四",
      "周五",
      "周六",
      "周日",
    ]);

    // The shell contributes layout only: every cell body comes from the caller,
    // which is how WD keeps its own TaskCard, checkbox and context menu.
    const cells = within(grid).getAllByTestId("cell");
    expect(cells).toHaveLength(42);
    expect(cells[0]).toHaveAttribute("data-date", "2026-07-27");
    expect(cells[0]).toHaveTextContent("out");
    expect(cells[5]).toHaveAttribute("data-date", "2026-08-01");
    expect(cells[5]).toHaveTextContent("in");
    expect(cells[41]).toHaveAttribute("data-date", "2026-09-06");
  });

  it("is the single move guard for locked tasks and no-op moves", () => {
    // ACC-055: a locked task can never move.
    expect(
      canMoveCalendarEvent(
        { locked: true, scheduledDate: "2026-08-19" },
        "2026-08-20",
      ),
    ).toBe(false);
    // Dropping a task back onto its own date is not a move.
    expect(
      canMoveCalendarEvent(
        { locked: false, scheduledDate: "2026-08-19" },
        "2026-08-19",
      ),
    ).toBe(false);
    expect(
      canMoveCalendarEvent(
        { locked: false, scheduledDate: "2026-08-19" },
        "2026-08-20",
      ),
    ).toBe(true);
  });
});
