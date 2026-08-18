import { z } from "zod";
import { getAccessToken } from "../../features/auth/authStore";

const environment = import.meta.env as unknown as Record<string, unknown>;
const apiBaseUrl =
  typeof environment.VITE_API_BASE_URL === "string"
    ? environment.VITE_API_BASE_URL
    : "/api/v1";

type SessionRefreshHandler = () => Promise<boolean>;
let sessionRefreshHandler: SessionRefreshHandler | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export function setSessionRefreshHandler(
  handler: SessionRefreshHandler | null,
): void {
  sessionRefreshHandler = handler;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly fieldErrors: ReadonlyArray<{ field: string; message: string }>;
  readonly current: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    code?: string,
    requestId?: string,
    fieldErrors: ReadonlyArray<{ field: string; message: string }> = [],
    current: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.fieldErrors = fieldErrors;
    this.current = current;
  }
}

const problemDetailSchema = z.object({
  detail: z.string().optional(),
  title: z.string().optional(),
  code: z.string().optional(),
  requestId: z.string().optional(),
  fieldErrors: z
    .array(z.object({ field: z.string(), message: z.string() }))
    .optional(),
  current: z.record(z.string(), z.unknown()).optional(),
});

export async function getJson<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  return requestJson(path, schema, init, false);
}

async function requestJson<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit | undefined,
  hasRetried: boolean,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(getAccessToken()
        ? { Authorization: `Bearer ${getAccessToken()}` }
        : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    if (
      response.status === 401 &&
      !hasRetried &&
      !path.startsWith("/auth/") &&
      sessionRefreshHandler
    ) {
      refreshInFlight ??= sessionRefreshHandler().finally(() => {
        refreshInFlight = null;
      });
      if (await refreshInFlight) {
        return requestJson(path, schema, init, true);
      }
    }
    const body: unknown = await response.json().catch(() => ({}));
    const problem = problemDetailSchema.safeParse(body);
    throw new ApiError(
      response.status,
      problem.success
        ? (problem.data.detail ?? problem.data.title ?? response.statusText)
        : response.statusText,
      problem.success ? problem.data.code : undefined,
      problem.success
        ? (problem.data.requestId ??
            response.headers.get("X-Request-Id") ??
            undefined)
        : (response.headers.get("X-Request-Id") ?? undefined),
      problem.success ? (problem.data.fieldErrors ?? []) : [],
      problem.success ? (problem.data.current ?? {}) : {},
    );
  }

  if (response.status === 204) return schema.parse(null);
  const text = await response.text();
  const parsed: unknown = text.length === 0 ? null : JSON.parse(text);
  return schema.parse(parsed);
}

export function postJson<T>(
  path: string,
  schema: z.ZodType<T>,
  body: unknown,
): Promise<T> {
  return getJson(path, schema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function patchJson<T>(
  path: string,
  schema: z.ZodType<T>,
  body: unknown,
): Promise<T> {
  return getJson(path, schema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function putJson<T>(
  path: string,
  schema: z.ZodType<T>,
  body: unknown,
): Promise<T> {
  return getJson(path, schema, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function postVoid(path: string, body: unknown): Promise<void> {
  return sendVoid(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function putVoid(path: string, body: unknown): Promise<void> {
  return sendVoid(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deleteVoid(path: string, body?: unknown): Promise<void> {
  // DELETE typically returns 204 No Content; route through the shared
  // sendVoid plumbing so auth, retry, and error handling match the other
  // verbs without forcing callers to route a DELETE through getJson (whose
  // <T> type + schema parse implies a response body that DELETE has none).
  return sendVoid(
    path,
    body === undefined
      ? { method: "DELETE" }
      : {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}

async function sendVoid(path: string, init: RequestInit): Promise<void> {
  await requestJson(path, z.unknown(), init, false);
}
