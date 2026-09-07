import {
  ArrowLeftOutlined,
  DeleteOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
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
import { ApiError } from "../../lib/api/ApiError";
import { useBusinessDate } from "../foundation/useBusinessDate";
import { WeeklyPatternEditor } from "./WeeklyPatternEditor";
import { mondayOf, WeekPlanEditor } from "./WeekPlanEditor";
import {
  getWeekPlan,
  getWeeklyPattern,
  type WeekPlan,
  type WeeklyPattern,
} from "./availabilityApi";
import { MountTrackModal } from "../planning/MountTrackModal";
import { MountLongTaskModal } from "../longtasks/MountLongTaskModal";
import {
  listStudentTracks,
  resumeSequenceTrack,
  type Track,
} from "../planning/trackApi";
import { TrackProgressPanel } from "../planning/TrackProgressPanel";
import {
  deleteStudent,
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
  const { message } = App.useApp();
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
  const [longTaskMountOpen, setLongTaskMountOpen] = useState(false);
  const businessDate = useBusinessDate();

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

  const deleteMutation = useMutation({
    mutationFn: () => deleteStudent(studentId as string),
    onSuccess: async () => {
      void message.success("学生已删除");
      await queryClient.invalidateQueries({ queryKey: ["students"] });
      void navigate("/students");
    },
    onError: (error) => {
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "删除学生失败，请稍后重试",
      );
    },
  });

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
              : "请检查本地数据文件后重试。"
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
          <Popconfirm
            title="删除该学生？"
            description="将同时删除其常规周、排期、任务、轨道与生词记录，且不可恢复。"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => deleteMutation.mutate()}
          >
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={deleteMutation.isPending}
              style={{ marginLeft: "auto" }}
            >
              删除学生
            </Button>
          </Popconfirm>
        </Space>

        {conflict ? (
          <Alert
            type="warning"
            showIcon
            message="资料状态已变化"
            description={
              <>
                <Typography.Paragraph style={{ marginBottom: 8 }}>
                  {conflict.currentVersion !== null
                    ? `${conflict.message}（本地数据当前版本 v${conflict.currentVersion}）。已为您重新加载最新资料，您的修改仍保留在表单中。`
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

        <Form<StudentFormValues>
          form={form}
          layout="vertical"
          onFinish={(values) => updateMutation.mutate(values)}
        >
          <Card title="基本信息">
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
            <Form.Item name="note" label="备注">
              <Input.TextArea rows={3} maxLength={2000} />
            </Form.Item>
            <Form.Item name="tags" hidden>
              <Input />
            </Form.Item>
            <Form.Item label="标签" style={{ marginBottom: 0 }}>
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
          </Card>

          {/* FR-PROFILE-006：学科倾向的 Form.List 必须位于同一个 <Form> 内，
              否则表单收集不到它的值，编辑后保存会静默丢失。 */}
          <Card title="学科倾向" style={{ marginTop: 16 }}>
            <SubjectPreferencesEditor
              submitPending={updateMutation.isPending}
            />
            <Space style={{ marginTop: 16 }}>
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
          </Card>
        </Form>

        <Card title="学习条件摘要">
          <StudyConditionSummary
            studentId={student.id}
            devicePolicy={student.defaultDevicePolicy}
          />
        </Card>

        <Card title="常规周学习模式">
          <WeeklyPatternEditor studentId={student.id} />
        </Card>

        <Card title="本周计划">
          <WeekPlanEditor studentId={student.id} />
        </Card>

        <Card
          title="长期任务"
          extra={
            <Space>
              <Button type="primary" onClick={() => setLongTaskMountOpen(true)}>
                挂载长期任务
              </Button>
              <Button onClick={() => setMountOpen(true)}>挂载课程模板</Button>
            </Space>
          }
        >
          <TrackSection studentId={student.id} />
        </Card>
      </Space>
      <MountLongTaskModal
        studentId={student.id}
        anchorDate={businessDate}
        open={longTaskMountOpen}
        onClose={() => setLongTaskMountOpen(false)}
      />
      <MountTrackModal
        studentId={student.id}
        open={mountOpen}
        onClose={() => setMountOpen(false)}
      />
    </Spin>
  );
}

function TrackSection({ studentId }: { studentId: string }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const tracksQuery = useQuery({
    queryKey: ["student-tracks", studentId],
    queryFn: () => listStudentTracks(studentId, "ACTIVE"),
    retry: false,
  });
  const resumeMutation = useMutation({
    mutationFn: (track: Track) => resumeSequenceTrack(track.id, track.version),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["student-tracks", studentId],
      });
      void message.success("长期任务已重新接排");
    },
    onError: (error: Error) => void message.error(error.message),
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
        暂无活跃任务。点击“挂载长期任务”为学生持续布置系列任务，或在任务上右键
        「设为长期任务」。
      </Typography.Text>
    );
  }

  return (
    <TrackProgressPanel
      tracks={tracksQuery.data}
      onResumeSequenceTrack={(track) => resumeMutation.mutate(track)}
    />
  );
}

const DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function dayOfWeekOf(businessDate: string): number {
  return ((new Date(`${businessDate}T00:00:00`).getDay() + 6) % 7) + 1;
}

// A week-plan day counts as an exception when it deviates from the base
// pattern on any field the BASE_PATTERN generation copies verbatim, so a
// freshly generated plan yields zero exceptions.
function exceptionDayNames(pattern: WeeklyPattern, plan: WeekPlan): string[] {
  const baseByDay = new Map(pattern.days.map((day) => [day.dayOfWeek, day]));
  return plan.days
    .map((day) => ({
      name: DAY_NAMES[dayOfWeekOf(day.businessDate) - 1],
      base: baseByDay.get(dayOfWeekOf(day.businessDate)),
      day,
    }))
    .filter(
      ({ day, base }) =>
        base !== undefined &&
        (day.available !== base.available ||
          day.availableMinutes !== base.availableMinutes ||
          day.devicePolicyOverride !== base.devicePolicyOverride),
    )
    .map(({ name }) => name);
}

// AVL-012: compact read-only digest of the learning conditions configured in
// the cards below. Both queries reuse the exact keys mounted by
// WeeklyPatternEditor / WeekPlanEditor so react-query deduplicates observers
// and the summary never issues a request of its own.
function StudyConditionSummary({
  studentId,
  devicePolicy,
}: {
  studentId: string;
  devicePolicy: DevicePolicy;
}) {
  const businessDate = useBusinessDate();
  const patternQuery = useQuery({
    queryKey: ["weekly-pattern", studentId],
    queryFn: () => getWeeklyPattern(studentId),
    retry: false,
  });
  const weekStart = mondayOf(businessDate);
  const weekPlanQuery = useQuery({
    queryKey: ["week-plan", studentId, weekStart],
    queryFn: () => getWeekPlan(studentId, weekStart),
    retry: false,
  });

  if (patternQuery.isPending) {
    return <Skeleton active paragraph={{ rows: 2 }} />;
  }

  const pattern = patternQuery.data;
  const openDays = pattern ? pattern.days.filter((day) => day.available) : [];
  const totalMinutes = openDays.reduce(
    (sum, day) => sum + day.availableMinutes,
    0,
  );
  const dayDigest = openDays
    .map((day) => `${DAY_NAMES[day.dayOfWeek - 1]} ${day.availableMinutes}′`)
    .join(" · ");

  let exceptionText: string;
  if (weekPlanQuery.isPending) {
    exceptionText = "加载中…";
  } else if (weekPlanQuery.isError) {
    // 404 means the week has no date overrides yet; anything else is a real
    // read failure and must not be reported as "无".
    exceptionText =
      weekPlanQuery.error instanceof ApiError &&
      weekPlanQuery.error.status === 404
        ? "无"
        : "暂不可用";
  } else if (!pattern) {
    exceptionText = "—";
  } else {
    const names = exceptionDayNames(pattern, weekPlanQuery.data);
    exceptionText =
      names.length > 0 ? `${names.length} 处（${names.join("、")}）` : "无";
  }

  return (
    <Space direction="vertical" size="small" style={{ width: "100%" }}>
      {pattern ? (
        <Space wrap align="baseline" size="small">
          <Typography.Text type="secondary">默认周</Typography.Text>
          <Typography.Text>
            每周 {openDays.length} 天 · 共 {totalMinutes} 分钟
          </Typography.Text>
          {dayDigest ? (
            <Typography.Text type="secondary">{dayDigest}</Typography.Text>
          ) : null}
        </Space>
      ) : (
        <Typography.Text type="secondary">
          尚未设置常规周，请先在下方“常规周学习模式”卡片中配置学习日与时长。
        </Typography.Text>
      )}
      <Space wrap align="baseline" size="small">
        <Typography.Text type="secondary">设备策略</Typography.Text>
        <Tag>{devicePolicyLabel[devicePolicy]}</Tag>
      </Space>
      <Space wrap align="baseline" size="small">
        <Typography.Text type="secondary">本周例外</Typography.Text>
        <Typography.Text>{exceptionText}</Typography.Text>
      </Space>
    </Space>
  );
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
