import { Alert, Button, Space, Spin, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../lib/api/http";
import { useAuth } from "../auth/AuthProvider";
import { getContext } from "./contextApi";

const clientVersion = "0.1.0";

export function ContextGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const contextQuery = useQuery({
    queryKey: ["context"],
    queryFn: getContext,
    retry: false,
  });

  if (contextQuery.isPending) {
    return (
      <div className="auth-loading" role="status">
        <Spin />
        <Typography.Text>正在加载组织与业务日期…</Typography.Text>
      </div>
    );
  }
  if (contextQuery.isError) {
    const error = contextQuery.error;
    return (
      <main className="auth-page">
        <Alert
          type="error"
          title="无法加载工作台上下文"
          description={
            error instanceof ApiError
              ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
              : "请检查 API 连接。"
          }
          showIcon
          action={
            <Space>
              <Button onClick={() => void contextQuery.refetch()}>重试</Button>
              <Button onClick={() => void auth.logout()}>退出登录</Button>
            </Space>
          }
        />
      </main>
    );
  }

  const minimumVersion = contextQuery.data.clientMinCompatibleVersion;
  if (compareVersions(clientVersion, minimumVersion) < 0) {
    return (
      <main className="auth-page">
        <Alert
          type="warning"
          title="客户端需要升级"
          description={`当前版本 ${clientVersion}，服务端要求至少 ${minimumVersion}。`}
          showIcon
        />
      </main>
    );
  }

  return children;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
