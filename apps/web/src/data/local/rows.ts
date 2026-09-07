//! SQLite 行与入参的取值helpers：适配器各领域模块共用同一套取值口径。

import { ApiError } from "../../lib/api/ApiError";
import { TaskTransitionError } from "../../domain/task/taskTransitions";

export type DbRow = Record<string, unknown>;

export function text(row: DbRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Missing text column ${key}`);
  return value;
}

export function nullableText(row: DbRow, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

export function numberValue(row: DbRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number")
    throw new Error(`Missing number column ${key}`);
  return value;
}

export function nullableNumber(row: DbRow, key: string): number | null {
  const value = row[key];
  return typeof value === "number" ? value : null;
}

export function bool(row: DbRow, key: string): boolean {
  return numberValue(row, key) !== 0;
}

/** 入参取值：调用点很多，保留短名字。 */
export function record(input: Record<string, unknown>, key: string): unknown {
  return input[key];
}

export function requiredString(
  input: Record<string, unknown>,
  key: string,
): string {
  const value = record(input, key);
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(422, `${key} is required`, "LOCAL_VALIDATION_ERROR");
  }
  return value;
}

export function requiredNumber(
  input: Record<string, unknown>,
  key: string,
): number {
  const value = record(input, key);
  if (typeof value !== "number") {
    throw new ApiError(422, `${key} is required`, "LOCAL_VALIDATION_ERROR");
  }
  return value;
}

export function nullableInputString(
  input: Record<string, unknown>,
  key: string,
): string | null {
  const value = record(input, key);
  return typeof value === "string" && value !== "" ? value : null;
}

export function nullableInputNumber(
  input: Record<string, unknown>,
  key: string,
): number | null {
  const value = record(input, key);
  return typeof value === "number" ? value : null;
}

export function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 领域异常转 ApiError：本地适配器的错误出口只有这一个。 */
export function localError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof TaskTransitionError) {
    throw new ApiError(409, error.message, error.code);
  }
  throw new ApiError(
    409,
    error instanceof Error ? error.message : "本地数据操作失败",
    "LOCAL_DATABASE_ERROR",
  );
}
