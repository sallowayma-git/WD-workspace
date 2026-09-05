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
