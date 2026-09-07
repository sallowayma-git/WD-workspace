export type DevicePolicy = "ALLOWED" | "NOT_ALLOWED" | "CONFIRM";

export interface WeeklyStudyDay {
  /** ISO weekday: Monday=1, Sunday=7. */
  dayOfWeek: number;
  enabled: boolean;
  availableMinutes: number;
  devicePolicy?: DevicePolicy | null;
}

export interface StudyDateOverride {
  date: string;
  available: boolean;
  availableMinutes?: number;
  devicePolicy?: DevicePolicy | null;
}

export interface AvailabilityCalendar {
  weekly: readonly WeeklyStudyDay[];
  overrides?: readonly StudyDateOverride[];
  defaultDevicePolicy: DevicePolicy;
}

export interface EffectiveStudyAvailability {
  available: boolean;
  availableMinutes: number;
  devicePolicy: DevicePolicy;
  source: "DATE_OVERRIDE" | "WEEKLY_PATTERN" | "DEFAULT";
}

function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid business date: ${value}`);
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  // Round-trip guard: JS Date silently rolls over impossible calendar dates
  // (2026-02-31 → 2026-03-03), which would let a non-existent date flow into
  // carry-forward windows and produce lineage with incoherent dates.
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    throw new Error(`Invalid business date: ${value}`);
  }
  return date;
}

function formatDate(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function isoDayOfWeek(value: Date): number {
  return value.getDay() === 0 ? 7 : value.getDay();
}

export function resolveStudyAvailability(
  calendar: AvailabilityCalendar,
  date: string,
): EffectiveStudyAvailability {
  const override = calendar.overrides?.find((item) => item.date === date);
  if (override) {
    return {
      available: override.available,
      availableMinutes: override.availableMinutes ?? 0,
      devicePolicy: override.devicePolicy ?? calendar.defaultDevicePolicy,
      source: "DATE_OVERRIDE",
    };
  }

  const weekly = calendar.weekly.find(
    (item) => item.dayOfWeek === isoDayOfWeek(parseDate(date)),
  );
  if (weekly) {
    return {
      available: weekly.enabled,
      availableMinutes: weekly.availableMinutes,
      devicePolicy: weekly.devicePolicy ?? calendar.defaultDevicePolicy,
      source: "WEEKLY_PATTERN",
    };
  }

  return {
    available: true,
    availableMinutes: 120,
    devicePolicy: calendar.defaultDevicePolicy,
    source: "DEFAULT",
  };
}

export function findNextAvailableStudyDate(input: {
  calendar: AvailabilityCalendar;
  afterDate: string;
  requiresDevice?: boolean;
  horizonDays?: number;
  excludeDates?: readonly string[];
}): string | null {
  const horizonDays = input.horizonDays ?? 90;
  const excluded = new Set(input.excludeDates ?? []);
  const start = parseDate(input.afterDate);

  for (let offset = 1; offset <= horizonDays; offset += 1) {
    const candidate = new Date(start);
    candidate.setDate(candidate.getDate() + offset);
    const date = formatDate(candidate);
    if (excluded.has(date)) continue;
    const availability = resolveStudyAvailability(input.calendar, date);
    if (!availability.available) continue;
    if (input.requiresDevice && availability.devicePolicy !== "ALLOWED") {
      continue;
    }
    return date;
  }
  return null;
}
