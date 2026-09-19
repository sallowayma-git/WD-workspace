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
import { Link, useSearchParams } from "react-router-dom";
import { ApiError } from "../../lib/api/ApiError";
import {
  createStudent,
  createStudentStatusLabel,
  deleteStudentStatusLabel,
  listStudents,
  listStudentStatusLabels,
  updateStudentStatusLabel,
  type StudentStatusLabel,
} from "./studentApi";
import { StudentStatusLabelModal } from "./StudentStatusLabelModal";
import "./StudentListPage.css";

type StudentForm = {
  studentCode: string;
  name: string;
  classType?: string;
  defaultDevicePolicy: "ALLOWED" | "NOT_ALLOWED" | "CONFIRM";
};

export function StudentListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [searchInput, setSearchInput] = useState(
    searchParams.get("search") ?? "",
  );
  const [statusFilter, setStatusFilter] = useState<
    "CURRENT" | "ARCHIVED" | "ALL"
  >(searchParams.get("status") === "ARCHIVED" ? "ARCHIVED" : "CURRENT");
  const [createOpen, setCreateOpen] = useState(false);
  const [statusLabelsOpen, setStatusLabelsOpen] = useState(false);
  const [form] = Form.useForm<StudentForm>();
  const queryClient = useQueryClient();
  const studentsQuery = useQuery({
    queryKey: ["students", search],
    queryFn: () => listStudents(search),
    retry: false,
  });
  const statusLabelsQuery = useQuery({
    queryKey: ["student-status-labels"],
    queryFn: listStudentStatusLabels,
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
  const statusLabelsMutation = useMutation({
    mutationFn: async (
      drafts: Array<{
        id?: string;
        label: string;
        color: string | null;
        sortOrder: number;
      }>,
    ) => {
      return Promise.all(
        drafts.map((draft) =>
          draft.id
            ? updateStudentStatusLabel(draft.id, draft)
            : createStudentStatusLabel(draft),
        ),
      );
    },
    onSuccess: async () => {
      setStatusLabelsOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ["student-status-labels"],
      });
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
  const visibleStudents = data.items.filter((student) =>
    statusFilter === "ALL"
      ? true
      : statusFilter === "ARCHIVED"
        ? student.status === "ARCHIVED"
        : student.status !== "ARCHIVED",
  );
  const statusLabels = statusLabelsQuery.data ?? [];
  const defaultLabel =
    statusLabels.find((label) => label.label === "不紧急") ?? statusLabels[0];
  return (
    <Card
      title="学生工作台"
      extra={
        <Space>
          <Button onClick={() => setStatusLabelsOpen(true)}>状态标签</Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
          >
            新增学生
          </Button>
        </Space>
      }
    >
      <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        <Space.Compact style={{ width: "min(100%, 560px)" }}>
          <Input
            aria-label="搜索学生"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onPressEnter={() => {
              setSearch(searchInput);
              setSearchParams({ search: searchInput, status: statusFilter });
            }}
            placeholder="姓名、别名或学生编号"
            prefix={<SearchOutlined />}
          />
          <Button
            onClick={() => {
              setSearch(searchInput);
              setSearchParams({ search: searchInput, status: statusFilter });
            }}
          >
            搜索
          </Button>
          <Select
            aria-label="学生状态筛选"
            value={statusFilter}
            style={{ width: 120 }}
            options={[
              { value: "CURRENT", label: "未归档" },
              { value: "ARCHIVED", label: "已归档" },
              { value: "ALL", label: "全部" },
            ]}
            onChange={(value) => {
              setStatusFilter(value);
              setSearchParams({ search, status: value });
            }}
          />
        </Space.Compact>
        {visibleStudents.length === 0 ? (
          <Empty description="没有匹配的学生" />
        ) : (
          <div className="student-card-grid">
            {visibleStudents.map((student) => (
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
                    <Tag color={student.statusLabel?.color ?? undefined}>
                      {student.statusLabel?.label ??
                        defaultLabel?.label ??
                        "不紧急"}
                    </Tag>
                    {student.status === "ARCHIVED" ? <Tag>已归档</Tag> : null}
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
          <Form.Item name="classType" label="班级/班型">
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
      <StudentStatusLabelModal
        open={statusLabelsOpen}
        labels={statusLabels}
        confirmLoading={statusLabelsMutation.isPending}
        onCancel={() => setStatusLabelsOpen(false)}
        onSubmit={(labels) => statusLabelsMutation.mutate(labels)}
        onDelete={async (label: StudentStatusLabel) => {
          await deleteStudentStatusLabel(label.id);
          await queryClient.invalidateQueries({
            queryKey: ["student-status-labels"],
          });
          await queryClient.invalidateQueries({ queryKey: ["students"] });
        }}
      />
    </Card>
  );
}
