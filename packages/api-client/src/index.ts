/**
 * Small typed client generated from docs/api/openapi-foundation.yaml.
 * The implementation is dependency-free so web and Tauri can share it.
 */
export type ProblemDetail = {
  code: string;
  detail?: string;
  requestId: string;
  fieldErrors: Array<{ field: string; message: string }>;
  current: Record<string, unknown>;
};

export type AuthView = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { username: string; displayName: string; roles: string[] };
};

export type ContextView = {
  user: { id: string; displayName: string; roles: string[] };
  organization: { id: string; code: string; name: string };
  businessDate: string;
  timezone: string;
  dayCloseTime: string;
  permissions: string[];
  featureFlags: Record<string, boolean>;
  clientMinCompatibleVersion: string;
};

export type StudentView = {
  id: string;
  studentCode: string;
  name: string;
  alias: string | null;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  classType: string | null;
  enrollmentDate: string | null;
  defaultDevicePolicy: "ALLOWED" | "NOT_ALLOWED" | "CONFIRM";
  primaryAssistantId: string | null;
  note: string | null;
  version: number;
  updatedAt: string;
};

export type Page<T> = {
  items: T[];
  page: number;
  size: number;
  total: number;
  hasNext: boolean;
};

export type TemplateView = {
  id: string;
  templateCode: string;
  name: string;
  shortName: string | null;
  subjectCode: string;
  categoryCode: string | null;
  unitLabel: string;
  defaultDurationMinutes: number | null;
  defaultRequiresDevice: boolean;
  status: "DRAFT" | "ACTIVE" | "RETIRED" | "ARCHIVED";
  currentPublishedVersionId: string | null;
  currentPublishedVersionNumber: number | null;
  currentItemCount: number | null;
  version: number;
  updatedAt: string;
};

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly problem?: ProblemDetail,
  ) {
    super(problem?.detail ?? problem?.code ?? `HTTP ${status}`);
    this.name = "ApiClientError";
  }
}

export class AssistantApiClient {
  constructor(
    private readonly baseUrl: string,
    private accessToken?: string,
  ) {}

  setAccessToken(accessToken: string | undefined): void {
    this.accessToken = accessToken;
  }

  login(username: string, password: string): Promise<AuthView> {
    return this.request<AuthView>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  }

  refresh(refreshToken: string): Promise<AuthView> {
    return this.request<AuthView>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
  }

  logout(refreshToken: string): Promise<void> {
    return this.request<void>("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
  }

  getContext(): Promise<ContextView> {
    return this.request<ContextView>("/context");
  }

  listStudents(query?: string): Promise<Page<StudentView>> {
    return this.request<Page<StudentView>>(
      `/students${query ? `?query=${encodeURIComponent(query)}` : ""}`,
    );
  }

  createStudent(input: {
    studentCode: string;
    name: string;
    defaultDevicePolicy?: "ALLOWED" | "NOT_ALLOWED" | "CONFIRM";
    classType?: string;
  }): Promise<StudentView> {
    return this.request<StudentView>("/students", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  listTemplates(query?: string): Promise<Page<TemplateView>> {
    return this.request<Page<TemplateView>>(
      `/templates${query ? `?query=${encodeURIComponent(query)}` : ""}`,
    );
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(this.accessToken
          ? { Authorization: `Bearer ${this.accessToken}` }
          : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => undefined);
      throw new ApiClientError(
        response.status,
        body && typeof body === "object" ? (body as ProblemDetail) : undefined,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

export const apiClientPackageVersion = "0.1.0" as const;
