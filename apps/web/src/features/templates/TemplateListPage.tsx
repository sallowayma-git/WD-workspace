import {
  ImportOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../lib/api/ApiError";
import {
  createTemplate,
  listTemplates,
  type TaskTemplate,
} from "./templateApi";

interface CreateTemplateValues {
  name: string;
  unitLabel: string;
  defaultDurationMinutes?: number;
  defaultRequiresDevice: boolean;
}

export function TemplateListPage() {
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<CreateTemplateValues>();
  const queryClient = useQueryClient();
  const templatesQuery = useQuery({
    queryKey: ["templates", search],
    queryFn: () => listTemplates(search),
    retry: false,
  });
  const createMutation = useMutation({
    mutationFn: createTemplate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      form.resetFields();
      setCreateOpen(false);
    },
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
              : "请检查本地数据文件后重试。"
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
        <Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
          >
            新建模板
          </Button>
          <Link to="/imports">
            <Button icon={<ImportOutlined />}>Excel 导入</Button>
          </Link>
        </Space>
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
          <Empty description="尚无模板" />
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
      <Modal
        title="新建任务模板"
        open={createOpen}
        okText="创建"
        confirmLoading={createMutation.isPending}
        onCancel={() => setCreateOpen(false)}
        onOk={() =>
          void form.validateFields().then((values) =>
            createMutation.mutate({
              ...values,
              defaultDurationMinutes: values.defaultDurationMinutes ?? null,
              defaultRequiresDevice: values.defaultRequiresDevice ?? false,
            }),
          )
        }
      >
        <Form<CreateTemplateValues>
          form={form}
          layout="vertical"
          initialValues={{ unitLabel: "项", defaultRequiresDevice: false }}
        >
          <Typography.Text type="secondary">
            编码与学科无需填写，系统会自动识别生成。
          </Typography.Text>
          <Form.Item
            name="name"
            label="模板名称"
            rules={[{ required: true, message: "请输入模板名称" }]}
          >
            <Input maxLength={200} />
          </Form.Item>
          <Space align="start">
            <Form.Item
              name="unitLabel"
              label="单元称呼"
              rules={[{ required: true }]}
            >
              <Input maxLength={20} />
            </Form.Item>
            <Form.Item name="defaultDurationMinutes" label="默认分钟">
              <InputNumber min={1} max={1440} />
            </Form.Item>
            <Form.Item
              name="defaultRequiresDevice"
              label="需要设备"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Space>
        </Form>
        {createMutation.isError ? (
          <Alert
            type="error"
            showIcon
            title="模板创建失败"
            description={createMutation.error.message}
          />
        ) : null}
      </Modal>
    </Card>
  );
}
