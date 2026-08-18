import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Space,
  Spin,
  Typography,
} from "antd";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ApiError } from "../../lib/api/http";
import { setSessionRefreshHandler } from "../../lib/api/http";
import { login, logout, refresh, type AuthSession } from "./authApi";
import { clearSession, getRefreshToken, saveSession } from "./authStore";

const environment = import.meta.env as unknown as Record<string, unknown>;
const authDisabledRaw = environment.VITE_AUTH_DISABLED;
const authDisabled =
  typeof authDisabledRaw === "string"
    ? authDisabledRaw.toLowerCase() === "true"
    : authDisabledRaw === true;

/**
 * Synthetic session used when VITE_AUTH_DISABLED=true. The backend dev profile
 * authenticates every request as the local administrator, so the frontend can
 * skip the login flow entirely and render the main shell directly.
 */
const DEV_SESSION: AuthSession = {
  accessToken: "",
  refreshToken: "",
  expiresIn: 0,
  user: {
    username: "admin",
    displayName: "开发管理员",
    roles: ["ADMIN"],
  },
};

type AuthContextValue = {
  session: AuthSession | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() =>
    authDisabled ? DEV_SESSION : null,
  );
  const [initializing, setInitializing] = useState(() =>
    !authDisabled && Boolean(getRefreshToken()),
  );

  useEffect(() => {
    if (authDisabled) return;
    const restore = async (): Promise<boolean> => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return false;
      try {
        const nextSession = await refresh(refreshToken);
        saveSession(nextSession);
        setSession(nextSession);
        return true;
      } catch {
        clearSession();
        setSession(null);
        return false;
      }
    };
    setSessionRefreshHandler(async () => {
      const refreshed = await restore();
      if (!refreshed) setInitializing(false);
      return refreshed;
    });
    void restore().finally(() => setInitializing(false));
    return () => setSessionRefreshHandler(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      login: async (username, password) => {
        const nextSession = await login(username, password);
        saveSession(nextSession);
        setSession(nextSession);
      },
      logout: async () => {
        if (authDisabled) return;
        const refreshToken = getRefreshToken();
        if (refreshToken) await logout(refreshToken).catch(() => undefined);
        clearSession();
        setSession(null);
      },
    }),
    [session],
  );

  if (initializing) {
    return (
      <div className="auth-loading" role="status">
        <Spin />
        <Typography.Text>正在恢复登录会话…</Typography.Text>
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  if (auth.session) return children;
  return <LoginPage />;
}

function LoginPage() {
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <main className="auth-page">
      <Card title="登录助教工作台" style={{ width: "min(100%, 420px)" }}>
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          {error ? <Alert type="error" title={error} showIcon /> : null}
          <Form
            layout="vertical"
            onFinish={(values: { username: string; password: string }) => {
              setSubmitting(true);
              setError(null);
              void auth
                .login(values.username, values.password)
                .catch((reason: unknown) => {
                  setError(
                    reason instanceof ApiError
                      ? reason.message
                      : "登录失败，请稍后重试",
                  );
                })
                .finally(() => setSubmitting(false));
            }}
          >
            <Form.Item
              name="username"
              label="用户名"
              rules={[{ required: true, message: "请输入用户名" }]}
            >
              <Input autoComplete="username" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: "请输入密码" }]}
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting} block>
              登录
            </Button>
          </Form>
        </Space>
      </Card>
    </main>
  );
}
