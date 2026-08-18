import { ImportOutlined, SearchOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Skeleton,
  Space,
  Table,
  Tag,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../lib/api/http";
import { listTemplates, type TaskTemplate } from "./templateApi";

export function TemplateListPage() {
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const templatesQuery = useQuery({
    queryKey: ["templates", search],
    queryFn: () => listTemplates(search),
    retry: false,
  });

  if (templatesQuery.isPending) {
    return (
      <Card title="任务模板">
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }
  if (templatesQuery.isError) {
    const error = templatesQuery.error;
    return (
      <Card title="任务模板">
        <Alert
          type="error"
          title="模板列表暂不可用"
          showIcon
          description={
            error instanceof ApiError
              ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
              : "请确认 API 已启动并登录。"
          }
        />
      </Card>
    );
  }

  const data = templatesQuery.data;
  return (
    <Card
      title="任务模板"
      extra={
        <Link to="/imports">
          <Button icon={<ImportOutlined />}>Excel 导入</Button>
        </Link>
      }
    >
      <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        <Space.Compact style={{ width: "min(100%, 420px)" }}>
          <Input
            aria-label="搜索模板"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onPressEnter={() => setSearch(searchInput)}
            placeholder="模板名称或编码"
            prefix={<SearchOutlined />}
          />
          <Button onClick={() => setSearch(searchInput)}>搜索</Button>
        </Space.Compact>
        {data.items.length === 0 ? (
          <Empty description="当前组织没有模板" />
        ) : (
          <Table<TaskTemplate>
            rowKey="id"
            dataSource={data.items}
            pagination={false}
            columns={[
              {
                title: "模板",
                dataIndex: "name",
                key: "name",
                render: (value: string, template) => (
                  <Link to={`/templates/${template.id}`}>{value}</Link>
                ),
              },
              {
                title: "编码",
                dataIndex: "templateCode",
                key: "templateCode",
              },
              { title: "学科", dataIndex: "subjectCode", key: "subjectCode" },
              {
                title: "状态",
                dataIndex: "status",
                key: "status",
                render: (status: TaskTemplate["status"]) => (
                  <Tag color={status === "ACTIVE" ? "green" : "blue"}>
                    {status}
                  </Tag>
                ),
              },
              {
                title: "发布版本",
                key: "publishedVersion",
                render: (_value, template) =>
                  template.currentPublishedVersionNumber
                    ? `v${template.currentPublishedVersionNumber}（${template.currentItemCount ?? 0} 单元）`
                    : "尚未发布",
              },
            ]}
          />
        )}
      </Space>
    </Card>
  );
}
