import { z } from "zod";
import { getDataAdapter } from "../../data/runtime";

export const devicePolicyOverrideSchema = z
  .enum(["ALLOWED", "NOT_ALLOWED", "CONFIRM"])
  .nullable();

const weeklyPatternDaySchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  available: z.boolean(),
  availableMinutes: z.number().int().min(0).max(1440),
  devicePolicyOverride: devicePolicyOverrideSchema,
});

const weeklyPatternSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  status: z.string(),
  days: z.array(weeklyPatternDaySchema).length(7),
  version: z.number(),
  updatedAt: z.string(),
});

const dayAvailabilitySchema = z.object({
  id: z.string().uuid(),
  businessDate: z.string(),
  available: z.boolean(),
  availableMinutes: z.number().int().min(0).max(1440),
  devicePolicyOverride: devicePolicyOverrideSchema,
  note: z.string().nullable(),
  version: z.number(),
});

const weekPlanSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  weekStartDate: z.string(),
  sourceType: z.enum(["BASE_PATTERN", "PREVIOUS_WEEK", "MANUAL"]),
  sourceId: z.string().uuid().nullable(),
  status: z.string(),
  confirmedAt: z.string().nullable(),
  days: z.array(dayAvailabilitySchema).length(7),
  version: z.number(),
  updatedAt: z.string(),
});

export type DevicePolicyOverride = z.infer<typeof devicePolicyOverrideSchema>;
export type WeeklyPatternDay = z.infer<typeof weeklyPatternDaySchema>;
export type WeeklyPattern = z.infer<typeof weeklyPatternSchema>;
export type DayAvailability = z.infer<typeof dayAvailabilitySchema>;
export type WeekPlan = z.infer<typeof weekPlanSchema>;

export function getWeeklyPattern(studentId: string): Promise<WeeklyPattern> {
  return getDataAdapter()
    .getWeeklyPattern(studentId)
    .then((value) => weeklyPatternSchema.parse(value));
}

export function saveWeeklyPattern(
  studentId: string,
  input: { effectiveFrom: string; days: WeeklyPatternDay[] },
): Promise<WeeklyPattern> {
  return getDataAdapter()
    .saveWeeklyPattern(studentId, input)
    .then((value) => weeklyPatternSchema.parse(value));
}

export function getWeekPlan(
  studentId: string,
  weekStart: string,
): Promise<WeekPlan> {
  return getDataAdapter()
    .getWeekPlan(studentId, weekStart)
    .then((value) => weekPlanSchema.parse(value));
}

export function saveWeekPlan(
  studentId: string,
  weekStart: string,
  input: {
    sourceType: WeekPlan["sourceType"];
    replaceDraft: boolean;
    days?: Array<
      Pick<
        DayAvailability,
        | "businessDate"
        | "available"
        | "availableMinutes"
        | "devicePolicyOverride"
        | "note"
      >
    >;
  },
): Promise<WeekPlan> {
  return getDataAdapter()
    .saveWeekPlan(studentId, weekStart, input)
    .then((value) => weekPlanSchema.parse(value));
}
