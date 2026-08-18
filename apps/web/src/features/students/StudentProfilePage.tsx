import { ArrowLeftOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Select,
  Skeleton,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../lib/api/http";
import { MountTrackModal } from "../planning/MountTrackModal";
import { listStudentTracks } from "../planning/trackApi";
import { TrackProgressPanel } from "../planning/TrackProgressPanel";
import {
  getStudent,
  updateStudent,
  type Student,
  type SubjectPreferenceInput,
} from "./studentApi";

type DevicePolicy = "ALLOWED" | "NOT_ALLOWED" | "CONFIRM";
type StudentStatus = Student["status"];

const statusOptions: Array<{ value: StudentStatus; label: string }> = [
  { value: "ACTIVE", label: "正常" },
  { value: "PAUSED", label: "暂停" },
  { value: "ARCHIVED", label: "已归档" },
];

const devicePolicyOptions: Array<{ value: DevicePolicy; label: string }> = [
  { value: "ALLOWED", label: "允许设备" },
  { value: "NOT_ALLOWED", label: "不允许设备" },
  { value: "CONFIRM", label: "需确认" },
];

const statusColor: Record<StudentStatus, string> = {
  ACTIVE: "green",
  PAUSED: "orange",
  ARCHIVED: "default",
};

const devicePolicyLabel: Record<DevicePolicy, string> = {
  ALLOWED: "允许设备",
  NOT_ALLOWED: "不允许设备",
  CONFIRM: "需确认",
};

type TagDraft = { code: string; name: string };

type StudentFormValues = {
  name: string;
  alias: string | null;
  status: StudentStatus;
  defaultDevicePolicy: DevicePolicy;
  primaryAssistantId: string | null;
  classType: string | null;
  enrollmentDate: unknown;
  note: string | null;
  tags: TagDraft[];
  // FR-PROFILE-006: replace-semantics subject preference list. Draft rows
  // omit id/version/updatedAt (server-managed) when sent to the backend.
  subjectPreferences: SubjectPreferenceDraft[];
};

type SubjectPreferenceDraft = {
  subjectCode: string;
  priority: number;
  targetRatio: number;
  note: string;
};

const SUBJECT_OPTIONS = [
  { value: "LISTENING", label: "听力" },
  { value: "READING", label: "阅读" },
  { value: "WRITING", label: "写作" },
  { value: "SPEAKING", label: "口语" },
  { value: "VOCABULARY", label: "词汇" },
];

const PRIORITY_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({
  value: n,
  label: `${n}`,
}));

function toFormValues(student: Student): StudentFormValues {
  return {
    name: student.name,
    alias: student.alias ?? "",
    status: student.status,
    defaultDevicePolicy: student.defaultDevicePolicy,
    primaryAssistantId: student.primaryAssistantId ?? "",
    classType: student.classType ?? "",
    enrollmentDate: student.enrollmentDate ? student.enrollmentDate : null,
    note: student.note ?? "",
    tags: student.tags.map((tag) => ({ code: tag.code, name: tag.name })),
    subjectPreferences: student.subjectPreferences.map((pref) => ({
      subjectCode: pref.subjectCode,
      priority: pref.priority,
      targetRatio: pref.targetRatio,
      note: pref.note ?? "",
    })),
  };
}

function parseTagsInput(value: string): TagDraft[] {
  return value
    .split(/[,，;；\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => ({ code: part, name: part }));
}

function formatTags(tags: TagDraft[]): string {
  return tags.map((tag) => tag.name).join(", ");
}

export function StudentProfilePage() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<StudentFormValues>();
  // D8 / AC-013: on a 409 version conflict we must preserve the user's
  // unsubmitted edits and let them choose to "overwrite with my version"
  // (re-submit using the server's latest version) or "discard changes"
  // (roll the form back to the server state).
  const [conflict, setConflict] = useState<{
    message: string;
    currentVersion: number | null;
    pendingValues: StudentFormValues | null;
  } | null>(null);
  const [mountOpen, setMountOpen] = useState(false);

  const studentQuery = useQuery({
    queryKey: ["student", studentId],
    queryFn: () => getStudent(studentId as string),
    enabled: Boolean(studentId),
    retry: false,
  });

  useEffect(() => {
    if (studentQuery.data) {
      form.setFieldsValue(toFormValues(studentQuery.data));
    }
  }, [form, studentQuery.data]);

  const updateMutation = useMutation({
    mutationFn: (values: StudentFormValues) =>
      updateStudent(studentId as string, {
        name: values.name,
        alias: values.alias && values.alias.length > 0 ? values.alias : null,
        status: values.status,
        defaultDevicePolicy: values.defaultDevicePolicy,
        primaryAssistantId:
          values.primaryAssistantId && values.primaryAssistantId.length > 0
            ? values.primaryAssistantId
            : null,
        classType:
          values.classType && values.classType.length > 0
            ? values.classType
            : null,
        enrollmentDate:
          typeof values.enrollmentDate === "string" &&
          values.enrollmentDate.length > 0
            ? values.enrollmentDate
            : null,
        note: values.note && values.note.length > 0 ? values.note : null,
        tags: values.tags ?? [],
        // FR-PROFILE-006: backend replaces the whole list, so normalize
        // empty note -> null and drop rows missing a subjectCode.
        subjectPreferences: (values.subjectPreferences ?? [])
          .filter((pref) => pref.subjectCode.trim().length > 0)
          .map<SubjectPreferenceInput>((pref) => ({
            subjectCode: pref.subjectCode.trim(),
            priority: pref.priority,
            targetRatio: pref.targetRatio,
            note: pref.note && pref.note.length > 0 ? pref.note : null,
          })),
        expectedVersion: studentQuery.data?.version ?? 0,
      }),
    onSuccess: async () => {
      setConflict(null);
      await queryClient.invalidateQueries({ queryKey: ["student", studentId] });
      await queryClient.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (error, values) => {
      if (error instanceof ApiError && error.status === 409) {
        const currentVersion =
          typeof error.current.version === "number"
            ? error.current.version
            : null;
        // Preserve the user's unsubmitted input so they can choose to
        // overwrite or discard (AC-013). The form is intentionally NOT
        // reset here.
        setConflict({
          message: error.message,
          currentVersion,
          pendingValues: values,
        });
      } else {
        setConflict(null);
      }
    },
    onSettled: () => {
      // Refresh the server snapshot so a subsequent "overwrite" retry
      // uses the latest version (AC-013).
      void queryClient.invalidateQueries({ queryKey: ["student", studentId] });
    },
  });

  // AC-013: "overwrite with my version" — re-submit the user's pending
  // edits against the server's latest version (already reloaded into
  // studentQuery.data via the 409 invalidation below).
  const handleOverwrite = () => {
    if (!conflict?.pendingValues) return;
    updateMutation.mutate(conflict.pendingValues);
  };

  // AC-013: "discard changes" — roll the form back to the server state.
  const handleDiscard = () => {
    if (studentQuery.data) {
      form.setFieldsValue(toFormValues(studentQuery.data));
    }
    setConflict(null);
  };

  if (studentQuery.isPending) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 8 }} />
      </Card>
    );
  }

  if (studentQuery.isError) {
    const error = studentQuery.error;
    return (
      <Card>
        <Alert
          type="error"
          title="学生资料暂不可用"
          showIcon
          description={
            error instanceof ApiError
              ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
              : "请确认 API 已启动并登录。"
          }
          action={
            <Button type="link" onClick={() => void studentQuery.refetch()}>
              重试
            </Button>
          }
        />
      </Card>
    );
  }

  const student = studentQuery.data;

  return (
    <Spin spinning={updateMutation.isPending}>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Space>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => void navigate(-1)}
          >
            返回
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>
            学生资料
          </Typography.Title>
          <Tag color={statusColor[student.status]}>
            {
              statusOptions.find((option) => option.value === student.status)
                ?.label
            }
          </Tag>
          <Tag>{devicePolicyLabel[student.defaultDevicePolicy]}</Tag>
        </Space>

        {conflict ? (
          <Alert
            type="warning"
            showIcon
            message="资料已被其他用户修改"
            description={
              <>
                <Typography.Paragraph style={{ marginBottom: 8 }}>
                  {conflict.currentVersion !== null
                    ? `${conflict.message}（服务器当前版本 v${conflict.currentVersion}）。已为您重新加载最新资料，您的修改仍保留在表单中。`
                    : conflict.message}
                </Typography.Paragraph>
                <Space>
                  <Button
                    type="primary"
                    loading={updateMutation.isPending}
                    onClick={handleOverwrite}
                  >
                    用我的版本覆盖
                  </Button>
                  <Button onClick={handleDiscard}>放弃修改</Button>
                </Space>
              </>
            }
          />
        ) : null}

        {updateMutation.isError && !conflict ? (
          <Alert
            type="error"
            title="保存失败"
            showIcon
            description={updateMutation.error.message}
          />
        ) : null}

        <Card title="基本信息">
          <Form<StudentFormValues>
            form={form}
            layout="vertical"
            onFinish={(values) => updateMutation.mutate(values)}
          >
            <Form.Item
              name="name"
              label="姓名"
              rules={[{ required: true, message: "请输入姓名" }]}
            >
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item name="alias" label="别名">
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select options={statusOptions} />
            </Form.Item>
            <Form.Item name="classType" label="班型/阶段">
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item name="enrollmentDate" label="报名时间">
              <Input type="date" />
            </Form.Item>
            <Form.Item name="defaultDevicePolicy" label="默认设备条件">
              <Select options={devicePolicyOptions} />
            </Form.Item>
            <Form.Item name="primaryAssistantId" label="负责助教 ID">
              <Input placeholder="UUID（可选）" />
            </Form.Item>
            <Form.Item name="note" label="备注">
              <Input.TextArea rows={3} maxLength={2000} />
            </Form.Item>
            <Form.Item name="tags" hidden>
              <Input />
            </Form.Item>
            <Form.Item label="标签">
              <TagsEditor
                value={formatTags(
                  (form.getFieldValue("tags") as TagDraft[] | undefined) ?? [],
                )}
                onChange={(text) => {
                  const parsed = parseTagsInput(text);
                  form.setFieldValue("tags", parsed);
                }}
              />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={updateMutation.isPending}
                >
                  保存
                </Button>
                <Button
                  onClick={() => {
                    if (studentQuery.data) {
                      form.setFieldsValue(toFormValues(studentQuery.data));
                    }
                  }}
                >
                  重置
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>

        <Card title="学科倾向" style={{ marginTop: 16 }}>
          <SubjectPreferencesEditor submitPending={updateMutation.isPending} />
        </Card>

        <Card title="常规周学习模式">
          <Alert
            type="info"
            showIcon
            title="即将上线"
            description="常规周学习模式（周一至周日默认可学习状态与分钟数）将在此处配置。"
          />
        </Card>

        <Card title="本周计划">
          <Alert
            type="info"
            showIcon
            title="即将上线"
            description="本周计划覆盖（从常规周或上周复制并进行日期级覆盖）将在此处配置。"
          />
        </Card>

        <Card
          title="任务轨道"
          extra={<Button onClick={() => setMountOpen(true)}>挂载轨道</Button>}
        >
          <TrackSection studentId={student.id} />
        </Card>
      </Space>
      <MountTrackModal
        studentId={student.id}
        open={mountOpen}
        onClose={() => setMountOpen(false)}
      />
    </Spin>
  );
}

function TrackSection({ studentId }: { studentId: string }) {
  const tracksQuery = useQuery({
    queryKey: ["student-tracks", studentId],
    queryFn: () => listStudentTracks(studentId, "ACTIVE"),
    retry: false,
  });

  if (tracksQuery.isPending) {
    return <Skeleton active paragraph={{ rows: 3 }} />;
  }

  if (tracksQuery.isError) {
    return <Typography.Text type="secondary">轨道信息暂不可用</Typography.Text>;
  }

  if (tracksQuery.data.length === 0) {
    return (
      <Typography.Text type="secondary">
        暂无活跃轨道，点击“挂载轨道”为学生挂载一个长期任务模板。
      </Typography.Text>
    );
  }

  return <TrackProgressPanel tracks={tracksQuery.data} />;
}

function TagsEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string) => void;
}) {
  return (
    <Input
      aria-label="学生标签"
      defaultValue={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      placeholder="多个标签用逗号分隔"
    />
  );
}

// FR-PROFILE-006: dynamic editor for the replace-semantics subject preference
// list. Uses Form.List so every row's values flow through the parent form and
// are submitted alongside the rest of the profile. subjectCode is backed by a
// Select with allowClear so teachers can pick a preset OR type a custom subject.
function SubjectPreferencesEditor({
  submitPending,
}: {
  submitPending: boolean;
}) {
  return (
    <Form.List name="subjectPreferences">
      {(fields, { add, remove }) => {
        if (fields.length === 0) {
          return (
            <>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无学科倾向"
                style={{ marginBottom: 16 }}
              />
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() =>
                  add({
                    subjectCode: "",
                    priority: 3,
                    targetRatio: 0,
                    note: "",
                  })
                }
                disabled={submitPending}
              >
                添加学科倾向
              </Button>
            </>
          );
        }
        return (
          <Space direction="vertical" style={{ width: "100%" }} size="small">
            {fields.map((field) => (
              <Space
                key={field.key}
                align="baseline"
                wrap
                style={{ width: "100%" }}
              >
                <Form.Item
                  {...field}
                  name={[field.name, "subjectCode"]}
                  rules={[{ required: true, message: "请选择或输入科目" }]}
                  style={{ marginBottom: 0, minWidth: 160 }}
                >
                  <Select
                    showSearch
                    allowClear
                    placeholder="科目"
                    options={SUBJECT_OPTIONS}
                    disabled={submitPending}
                  />
                </Form.Item>
                <Form.Item
                  {...field}
                  name={[field.name, "priority"]}
                  rules={[{ required: true, message: "必填" }]}
                  style={{ marginBottom: 0, minWidth: 96 }}
                >
                  <Select
                    placeholder="优先级"
                    options={PRIORITY_OPTIONS}
                    disabled={submitPending}
                  />
                </Form.Item>
                <Form.Item
                  {...field}
                  name={[field.name, "targetRatio"]}
                  rules={[{ required: true, message: "必填" }]}
                  style={{ marginBottom: 0, minWidth: 120 }}
                >
                  <InputNumber
                    min={0}
                    max={100}
                    addonAfter="%"
                    placeholder="目标比例"
                    disabled={submitPending}
                    style={{ width: "100%" }}
                  />
                </Form.Item>
                <Form.Item
                  {...field}
                  name={[field.name, "note"]}
                  style={{ marginBottom: 0, minWidth: 200 }}
                >
                  <Input
                    placeholder="备注（可选）"
                    maxLength={200}
                    disabled={submitPending}
                  />
                </Form.Item>
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => remove(field.name)}
                  disabled={submitPending}
                  aria-label="删除该学科倾向"
                />
              </Space>
            ))}
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() =>
                add({
                  subjectCode: "",
                  priority: 3,
                  targetRatio: 0,
                  note: "",
                })
              }
              disabled={submitPending}
              style={{ marginTop: 8 }}
            >
              添加学科倾向
            </Button>
          </Space>
        );
      }}
    </Form.List>
  );
}
