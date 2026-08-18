import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGate, AuthProvider } from "./AuthProvider";
import { ContextGate } from "../foundation/ContextGate";
import { clearSession } from "./authStore";

const session = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresIn: 900,
  user: {
    username: "assistant",
    displayName: "开发助教",
    roles: ["ASSISTANT"],
  },
};

const context = {
  user: {
    id: "00000000-0000-4000-8000-000000000011",
    displayName: "开发助教",
    roles: ["ASSISTANT"],
  },
  organization: {
    id: "00000000-0000-4000-8000-000000000001",
    code: "LOCAL",
    name: "本地开发机构",
  },
  businessDate: "2026-08-18",
  timezone: "Asia/Shanghai",
  dayCloseTime: "05:00:00",
  permissions: ["student.read"],
  featureFlags: {},
  clientMinCompatibleVersion: "0.1.0",
};

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Response;

function renderGate() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <AuthGate>
          <ContextGate>
            <div>工作台已就绪</div>
          </ContextGate>
        </AuthGate>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("AuthProvider and ContextGate", () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearSession();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("logs in, persists only the refresh token, and unlocks context-gated routes", async () => {
    const fetchMock = vi.fn<FetchMock>(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.includes("/auth/login")) {
          const rawBody = typeof init?.body === "string" ? init.body : "";
          const body = JSON.parse(rawBody) as Record<string, unknown>;
          expect(body).toEqual({
            username: "assistant",
            password: "secret",
          });
          return new Response(JSON.stringify(session), { status: 200 });
        }
        if (url.includes("/context")) {
          return new Response(JSON.stringify(context), { status: 200 });
        }
        throw new Error(`unexpected request: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderGate();
    await userEvent.type(screen.getByLabelText("用户名"), "assistant");
    await userEvent.type(screen.getByLabelText("密码"), "secret");
    await userEvent.click(screen.getByRole("button", { name: /登\s*录/ }));

    expect(await screen.findByText("工作台已就绪")).toBeInTheDocument();
    expect(sessionStorage.getItem("assistant-workbench.refresh-token")).toBe(
      "refresh-token",
    );
    const contextCall = fetchMock.mock.calls.find((call) =>
      requestUrl(call[0]).endsWith("/context"),
    );
    expect(contextCall).toBeDefined();
    expect(contextCall?.[1]?.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer access-token" }),
    );
  });

  it("restores a refresh session before querying context", async () => {
    sessionStorage.setItem(
      "assistant-workbench.refresh-token",
      "refresh-token",
    );
    const fetchMock = vi.fn<FetchMock>((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("/auth/refresh"))
        return new Response(JSON.stringify(session));
      if (url.includes("/context"))
        return new Response(JSON.stringify(context));
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderGate();

    await waitFor(() =>
      expect(screen.getByText("工作台已就绪")).toBeInTheDocument(),
    );
    const calls = fetchMock.mock.calls as Array<
      [RequestInfo | URL, RequestInit?]
    >;
    expect(calls.length).toBe(2);
    expect(requestUrl(calls[0]?.[0] ?? "")).toContain("/auth/refresh");
    expect(requestUrl(calls[1]?.[0] ?? "")).toContain("/context");
  });
});
