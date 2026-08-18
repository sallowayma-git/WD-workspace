import { Alert, Card, Descriptions, Skeleton, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../lib/api/http";
import { getContext } from "./contextApi";

export function ApiContextStatus() {
  const contextQuery = useQuery({
    queryKey: ["context"],
    queryFn: getContext,
    retry: false,
  });

  if (contextQuery.isPending) {
    return (
      <Card title="API Context">
        <Skeleton active paragraph={{ rows: 2 }} />
      </Card>
    );
  }

  if (contextQuery.isError) {
    const error = contextQuery.error;
    const isUnauthorized = error instanceof ApiError && error.status === 401;
    return (
      <Card title="API Context">
        <Alert
          type={isUnauthorized ? "warning" : "error"}
          showIcon
          title={
            isUnauthorized
              ? "API 已响应，但当前浏览器尚未登录"
              : "API Context 暂不可用"
          }
          description={
            error instanceof ApiError
              ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
              : "请检查 API 地址和网络连接。"
          }
          action={
            <button
              type="button"
              onClick={() => {
                void contextQuery.refetch();
              }}
            >
              重试
            </button>
          }
        />
      </Card>
    );
  }

  const context = contextQuery.data;
  return (
    <Card title="API Context" extra={<Tag color="green">已连接</Tag>}>
      <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label="组织">
          {context.organization.name}（{context.organization.code}）
        </Descriptions.Item>
        <Descriptions.Item label="用户">
          {context.user.displayName}
        </Descriptions.Item>
        <Descriptions.Item label="业务日期">
          {context.businessDate}
        </Descriptions.Item>
        <Descriptions.Item label="时区">{context.timezone}</Descriptions.Item>
        <Descriptions.Item label="日结时间">
          {context.dayCloseTime}
        </Descriptions.Item>
        <Descriptions.Item label="角色">
          {context.user.roles.join("、") || "未分配"}
        </Descriptions.Item>
      </Descriptions>
      <Typography.Text type="secondary">
        该日期来自服务端，不使用浏览器本地时区推断。
      </Typography.Text>
    </Card>
  );
}
