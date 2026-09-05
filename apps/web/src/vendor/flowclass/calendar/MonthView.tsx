/**
 * Source: Flowclass
 * Original path:
 * apps/admin/src/components/ui/FullCalendar/views/MonthView.tsx
 * Snapshot: flowclass local snapshot manifest sha256 cb4f93dc625794842c536f34a63d712298c6a92d8ac2133705945cd31d1ebcb2
 * Source SHA-256: dc2195620a406648c3d94643a64baad930f73bb1ee7473438422e7fae2e84247
 * Decision: ADAPT
 * Adaptations:
 * - Monday-first, date-only six-week grid
 * - removed i18n, Flow theming and attendance indicator bars
 * - removed the CalendarProvider/EventProvider context dependency: the anchor
 *   date is a prop, so WD keeps a single source of truth for view state
 * - each cell is rendered by the caller (`renderDay`), the same shell pattern
 *   used for StudentTaskMatrixShell, so WD's TaskCard, checkbox, context menu
 *   and study-day marking are preserved instead of Flow's lesson chips
 */
import { Fragment, useMemo, type ReactNode } from "react";
import {
  buildMonthDays,
  parseBusinessDate,
  type CalendarDay,
} from "./dateUtils";

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export interface MonthViewProps {
  /** Any yyyy-MM-dd date inside the month to lay out. */
  anchorDate: string;
  /** Renders one grid cell. The caller owns the cell's content and droppable. */
  renderDay: (day: CalendarDay) => ReactNode;
}

/**
 * Monday-first six-week month grid. It contributes layout only — which dates
 * appear in which column, and which of them fall outside the anchor month.
 */
export function MonthView({ anchorDate, renderDay }: MonthViewProps) {
  const days = useMemo(
    () => buildMonthDays(parseBusinessDate(anchorDate)),
    [anchorDate],
  );

  return (
    <div className="flowcal-month" data-testid="flowclass-month-view">
      <div className="flowcal-weekdays" role="row">
        {WEEKDAYS.map((day) => (
          <div key={day} className="flowcal-weekday" role="columnheader">
            {day}
          </div>
        ))}
      </div>
      <div className="flowcal-month-grid">
        {days.map((day) => (
          <Fragment key={day.businessDate}>{renderDay(day)}</Fragment>
        ))}
      </div>
    </div>
  );
}
