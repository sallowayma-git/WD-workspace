# Calendar adoption decision

## Decision: Partial adoption — grid shell adopted, event layer dropped

Status: **integrated** (2026-08-20). The PoC gate ran first with mock events; this file records the final outcome, not the intent.

`StudentSchedulePage`'s month view is now laid out by the ported Flowclass month grid. Flowclass's own event-rendering and calendar-state layer was **not** adopted, because WD already owns better equivalents.

## What ships

| Ported file                               | Role in the product                                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `vendor/flowclass/calendar/MonthView.tsx` | Monday-first six-week grid + weekday header + out-of-month marking. Cells are rendered by the caller via `renderDay`.      |
| `vendor/flowclass/calendar/dateUtils.ts`  | `buildMonthDays` (42-day grid), `startOfIsoWeek`, and UTC-safe business-date round-trip.                                   |
| `vendor/flowclass/calendar/types.ts`      | `canMoveCalendarEvent` — the single move guard used by calendar drag, matrix drag, the context menu and `RescheduleModal`. |
| `vendor/flowclass/flowclass-compat.css`   | Scoped `.flowclass-scope` styles. No Tailwind preflight, no Flow globals (risk R8).                                        |

WD supplies each month cell (`DayCell`): the completion checkbox, the right-click
context menu, the `+N` overflow, the study-day / minutes marking, the "今天"
highlight and the dnd-kit droppable.

## What was dropped, and why

| Flowclass file                                                                                                             | Why it is not in the product                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CalendarProvider`                                                                                                         | WD's page already owns `view` and `selectedDate`. Keeping a second calendar state would be the duplicate UI `INT-CAL-001` tells us to delete.                      |
| `EventProvider`                                                                                                            | Task truth comes from react-query over the local SQLite adapter. A second in-memory event store would be a second source of truth.                                 |
| `CalendarDnDContext`                                                                                                       | `StudentSchedulePage` already has a `DndContext` with pointer + keyboard sensors. Nesting a second one would break sensor ownership.                               |
| `DraggableEvent`, `MonthViewDropzone`                                                                                      | WD's `TaskCard` + `DayCell` are strictly richer (checkbox, menu, priority flag, lineage badges). Adopting Flow's chips would have regressed `INT-CAL-003/004/010`. |
| `WeekView`, `DayView`                                                                                                      | They position by hour. WD tasks have a business date and no real start/end time.                                                                                   |
| `YearView`, `NDayView`, `ScheduleView`, `EventItem`, `QuotaAttendance`, `AttendanceIndicatorBar`, `CalendarSidebarContext` | Not needed, or attendance/course business.                                                                                                                         |

`INT-CAL-002` ("add a TaskCalendarAdapter") is recorded as **superseded**. A
`ScheduleResponse → TaskCalendarEvent[]` adapter existed during the PoC and was
removed on integration: `DayCell` consumes `ScheduleDay` directly, so a second
event model would be exactly the two-layer duplication the task book forbids in
Definition of Done #6. `canMoveCalendarEvent` keeps the structural contract that
adapter was carrying.

## Why Day/Week keep WD's own layout

- `ScheduleTask` has a business date and no real start/end time.
- Flowclass Day/Week depend on hour positioning, time cursors and minute drop zones.
- Inventing times such as 09:00–09:30 would create false domain data (risk R2).
- WD's date-first Day/Week views already work and already reschedule via dnd-kit.

## Window semantics

Each view is backed by exactly the days it draws — the local adapter derives the
range from the view, so no cell is a placeholder:

| View  | Window                                                                   |
| ----- | ------------------------------------------------------------------------ |
| Day   | the selected day only                                                    |
| Week  | the Monday-first ISO week containing the selected day                    |
| Month | the full 42-day grid, starting at the Monday of the week holding the 1st |

Regression coverage: `apps/web/src/data/local/sqliteLocalDataAdapter.test.ts`
("scopes each schedule view to the window that view actually shows") and
`apps/web/src/vendor/flowclass/calendar/calendar.test.tsx`.
