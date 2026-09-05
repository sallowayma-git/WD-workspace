const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseBusinessDate(value: string): Date {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid business date: ${value}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function formatBusinessDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addCalendarDays(value: Date, amount: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + amount);
  return result;
}

export function startOfIsoWeek(value: Date): Date {
  const result = new Date(value);
  const mondayOffset = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - mondayOffset);
  return result;
}

export interface CalendarDay {
  date: Date;
  businessDate: string;
  isCurrentMonth: boolean;
}

export function buildMonthDays(currentDate: Date): CalendarDay[] {
  const firstOfMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1,
  );
  const gridStart = startOfIsoWeek(firstOfMonth);
  return Array.from({ length: 42 }, (_, index) => {
    const date = addCalendarDays(gridStart, index);
    return {
      date,
      businessDate: formatBusinessDate(date),
      isCurrentMonth: date.getMonth() === currentDate.getMonth(),
    };
  });
}
