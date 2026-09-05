import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../lib/api/ApiError";
import { createStudent, listStudents, type Student } from "./studentApi";
import "./StudentListPage.css";

type StudentForm = {
  studentCode: string;
  name: string;
  classType?: string;
  defaultDevicePolicy: "ALLOWED" | "NOT_ALLOWED" | "CONFIRM";
};

const statusLabels: Record<Student["status"], string> = {
  ACTIVE: "正常",
  PAUSED: "暂停",
  ARCHIVED: "已归档",
};

export function StudentListPage() {
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<StudentForm>();
  const queryClient = useQueryClient();
  const studentsQuery = useQuery({
    queryKey: ["students", search],
    queryFn: () => listStudents(search),
    retry: false,
  });
  const createMutation = useMutation({
    mutationFn: createStudent,
    onSuccess: async () => {
      setCreateOpen(false);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["students"] });
    },
  });

  if (studentsQuery.isPending) {
    return (
      <Card title="学生工作台">
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }
  if (studentsQuery.isError) {
    const error = studentsQuery.error;
    return (
      <Card title="学生工作台">
        <Alert
          type="error"
          title="学生列表暂不可用"
          description={
            error instanceof ApiError
              ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
              : "请检查本地数据文件后重试。"
          }
          showIcon
          action={
            <Button type="link" onClick={() => void studentsQuery.refetch()}>
              重试
            </Button>
          }
        />
      </Card>
    );
  }

  const data = studentsQuery.data;
  return (
    <Card
      title="学生工作台"
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateOpen(true)}
        >
          新增学生
        </Button>
      }
    >
      <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        <Space.Compact style={{ width: "min(100%, 420px)" }}>
          <Input
            aria-label="搜索学生"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onPressEnter={() => setSearch(searchInput)}
            placeholder="姓名、别名或学生编号"
            prefix={<SearchOutlined />}
          />
          <Button onClick={() => setSearch(searchInput)}>搜索</Button>
        </Space.Compact>
        {data.items.length === 0 ? (
          <Empty description="没有匹配的学生" />
        ) : (
          <div className="student-card-grid">
            {data.items.map((student) => (
              <Card key={student.id} size="small" hoverable>
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  <Space
                    align="center"
                    style={{ width: "100%", justifyContent: "space-between" }}
                  >
                    <Link
                      to={`/students/${student.id}/profile`}
                      className="student-card-name"
                    >
                      {student.name}
                    </Link>
                    <Tag
                      color={student.status === "ACTIVE" ? "green" : "default"}
                    >
                      {statusLabels[student.status]}
                    </Tag>
                  </Space>
                  <Space size={8} wrap>
                    <Typography.Text type="secondary">
                      {student.studentCode}
                    </Typography.Text>
                    {student.classType ? (
                      <Typography.Text type="secondary">
                        {student.classType}
                      </Typography.Text>
                    ) : null}
                    {student.tags.length > 0 ? (
                      <Space size={4} wrap>
                        {student.tags.slice(0, 3).map((tag) => (
                          <Tag key={tag.code}>{tag.name}</Tag>
                        ))}
                      </Space>
                    ) : null}
                  </Space>
                  <Space size="small" className="student-card-links">
                    <Link
                      to={`/students/${student.id}/profile`}
                      aria-label={`打开 ${student.name} 资料`}
                    >
                      资料
                    </Link>
                    <Link
                      to={`/students/${student.id}/vocabulary`}
                      aria-label={`${student.name} 生词本`}
                    >
                      生词本
                    </Link>
                    <Link
                      to={`/students/${student.id}/schedule`}
                      aria-label={`${student.name} 排期`}
                    >
                      排期
                    </Link>
                  </Space>
                </Space>
              </Card>
            ))}
          </div>
        )}
      </Space>
      <Modal
        title="新增学生"
        open={createOpen}
        okText="创建"
        cancelText="取消"
        confirmLoading={createMutation.isPending}
        onCancel={() => setCreateOpen(false)}
        onOk={() => {
          void form
            .validateFields()
            .then((values) => createMutation.mutate(values));
        }}
      >
        {createMutation.isError ? (
          <Alert
            type="error"
            title="创建失败"
            description={createMutation.error.message}
            showIcon
          />
        ) : null}
        <Form<StudentForm> form={form} layout="vertical">
          <Form.Item name="studentCode" label="学生编号" extra="留空将自动生成">
            <Input maxLength={50} placeholder="可不填" />
          </Form.Item>
          <Form.Item
            name="name"
            label="姓名"
            rules={[{ required: true, message: "请输入姓名" }]}
          >
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="classType" label="班型">
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item
            name="defaultDevicePolicy"
            label="默认设备条件"
            initialValue="CONFIRM"
          >
            <Select
              options={[
                { value: "CONFIRM", label: "需确认" },
                { value: "ALLOWED", label: "允许设备" },
                { value: "NOT_ALLOWED", label: "不允许设备" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
