import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
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
  Typography,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../lib/api/ApiError";
import { listLongTasks, type LongTask } from "./longTaskApi";
import { CreateLongTaskModal } from "./CreateLongTaskModal";

/**
 * 长期任务列表。用户视角只有：名称、标题规则、多少学生在用、范围（持续还是
 * 起止序号）——模板编码/版本/发布状态是课程模板（ITEMIZED）的内部概念，
 * 不在这里出现。
 */
export function LongTaskListPage() {
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const longTasksQuery = useQuery({
    queryKey: ["long-tasks", search],
    queryFn: () => listLongTasks(search),
    retry: false,
  });

  if (longTasksQuery.isPending) {
    return (
      <Card title="长期任务">
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }
  if (longTasksQuery.isError) {
    const error = longTasksQuery.error;
    return (
      <Card title="长期任务">
        <Alert
          type="error"
          showIcon
          message="长期任务列表暂不可用"
          description={
            error instanceof ApiError
              ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
              : "请检查本地数据文件后重试。"
          }
        />
      </Card>
    );
  }

  const items = longTasksQuery.data;
  return (
    <Card
      title="长期任务"
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateOpen(true)}
        >
          新建长期任务
        </Button>
      }
    >
      <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Text type="secondary">
          长期任务按「标题 + 序号」自动接排：学生完成一项，下一项出现在下一个
          可学习日。给某个学生挂载入口在学生资料页；逐项定义的课程（Excel
          导入）仍在 <Link to="/templates">课程模板</Link> 管理。
        </Typography.Text>
        <Space.Compact style={{ width: "min(100%, 420px)" }}>
          <Input
            aria-label="搜索长期任务"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onPressEnter={() => setSearch(searchInput)}
            placeholder="任务名称"
            prefix={<SearchOutlined />}
          />
          <Button onClick={() => setSearch(searchInput)}>搜索</Button>
        </Space.Compact>
        {items.length === 0 ? (
          <Empty
            description={
              search
                ? "没有匹配的长期任务"
                : "还没有长期任务：新建一个，或把学生的普通任务右键「设为长期任务」"
            }
          />
        ) : (
          <Table<LongTask>
            rowKey="id"
            dataSource={items}
            pagination={false}
            columns={[
              {
                title: "长期任务",
                dataIndex: "name",
                render: (name: string) => (
                  <Typography.Text strong>{name}</Typography.Text>
                ),
              },
              {
                title: "任务规则",
                dataIndex: "titlePattern",
              },
              {
                title: "当前使用",
                dataIndex: "activeTrackCount",
                width: 120,
                render: (count: number) => `${count} 名学生`,
              },
              {
                title: "范围",
                width: 140,
                render: (_: unknown, record: LongTask) =>
                  record.endOrdinal != null
                    ? `${record.defaultStartOrdinal}–${record.endOrdinal}`
                    : "持续",
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 100,
                render: (status: string) =>
                  status === "ACTIVE" ? (
                    <Tag color="green">使用中</Tag>
                  ) : (
                    <Tag>{status === "RETIRED" ? "已停用" : status}</Tag>
                  ),
              },
            ]}
          />
        )}
      </Space>
      <CreateLongTaskModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </Card>
  );
}

export default LongTaskListPage;
