import {
  ArrowLeftOutlined,
  DownOutlined,
  RightOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../lib/api/ApiError";
import {
  buildPlainTitlePattern,
  buildSeriesTitlePattern,
  describeSeriesProgression,
  parseSeriesTitle,
  trySeriesTitlePattern,
} from "../../domain/task/seriesTitle";
import {
  deleteLongTask,
  getLongTask,
  updateLongTask,
  type LongTask,
} from "./longTaskApi";

interface LongTaskFormValues {
  sampleTitle: string;
  startOrdinal?: number;
  endOrdinal?: number | null;
  defaultDurationMinutes?: number | null;
}

/** 编辑页初值：用标题模板 + 起始序号反推出"第一项的完整标题"。 */
function firstItemTitle(longTask: LongTask): string {
  return (
    trySeriesTitlePattern(
      longTask.titlePattern,
      longTask.defaultStartOrdinal,
    ) ?? longTask.name
  );
}

/**
 * 长期任务详情 / 编辑页。列表页点任务名进到这里：改名、改接排区间、改默认
 * 时长，或者删除它。已挂载学生的轨道持有快照，这里的编辑只影响后续新挂载，
 * 不会回写历史任务——所以可以放心改，不需要"重建"。
 */
export function LongTaskDetailPage() {
  const { longTaskId } = useParams<{ longTaskId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message, modal } = AntdApp.useApp();
  const [form] = Form.useForm<LongTaskFormValues>();
  const [advancedOpen, setAdvancedOpen] = useState(true);
  // 用户手动改过"从第几项开始"之后，就不再让标题里的数字覆盖它。
  const [ordinalTouched, setOrdinalTouched] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["long-task", longTaskId],
    queryFn: () => getLongTask(longTaskId as string),
    enabled: Boolean(longTaskId),
    retry: false,
  });

  const sampleTitle = Form.useWatch("sampleTitle", form) ?? "";
  const startOrdinal = Form.useWatch("startOrdinal", form);
  const endOrdinal = Form.useWatch("endOrdinal", form);

  // 与新建弹窗同一套语义：标题里的尾部数字就是起始序号。编辑页默认把序号
  // 显示出来，所以这里在标题变化时同步它——否则把「Day 1」改成「Day 7」会
  // 因为序号仍是 1 而看不出任何变化，用户会以为没保存成功。
  useEffect(() => {
    if (ordinalTouched) return;
    const parsed = parseSeriesTitle(sampleTitle.trim());
    if (parsed) form.setFieldValue("startOrdinal", parsed.number);
  }, [sampleTitle, ordinalTouched, form]);

  const saveMutation = useMutation({
    mutationFn: (values: LongTaskFormValues) =>
      updateLongTask(longTaskId as string, {
        sampleTitle: values.sampleTitle,
        startOrdinal: values.startOrdinal,
        endOrdinal: values.endOrdinal ?? null,
        defaultDurationMinutes: values.defaultDurationMinutes ?? null,
      }),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: ["long-tasks"] });
      await queryClient.invalidateQueries({
        queryKey: ["long-task", longTaskId],
      });
      void message.success(`已保存「${updated.name}」`);
    },
    onError: (error) => {
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "保存失败，请稍后重试",
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteLongTask(longTaskId as string),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["long-tasks"] });
      void message.success(
        result.mode === "ARCHIVED"
          ? `已归档：${result.trackCount} 名学生的历史任务保持完整`
          : "已删除长期任务",
      );
      void navigate("/long-tasks");
    },
    onError: (error) => {
      void message.error(
        error instanceof ApiError ? error.message : "删除失败，请稍后重试",
      );
    },
  });

  if (detailQuery.isPending) {
    return (
      <Card title="长期任务">
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    const error = detailQuery.error;
    return (
      <Card
        title="长期任务"
        extra={
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => void navigate("/long-tasks")}
          >
            返回列表
          </Button>
        }
      >
        <Alert
          type="error"
          showIcon
          message="长期任务暂不可用"
          description={
            error instanceof ApiError
              ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
              : "该长期任务可能已被删除，或本地数据文件不可读。"
          }
        />
      </Card>
    );
  }

  const longTask = detailQuery.data;

  // 预览：与适配器同一套解析规则，用户改标题就能看到接排结果怎么变。
  const trimmedTitle = sampleTitle.trim();
  const preview = trimmedTitle
    ? (() => {
        const parsed = parseSeriesTitle(trimmedTitle);
        const pattern = parsed
          ? buildSeriesTitlePattern(parsed)
          : buildPlainTitlePattern(trimmedTitle);
        return describeSeriesProgression({
          titlePattern: pattern,
          startOrdinal: startOrdinal ?? parsed?.number ?? 1,
          endOrdinal: endOrdinal ?? null,
          includePrefix: true,
        });
      })()
    : null;

  function confirmDelete() {
    modal.confirm({
      title: `删除长期任务「${longTask.name}」？`,
      content:
        longTask.activeTrackCount > 0 ? (
          <Space orientation="vertical" size={4}>
            <Typography.Text>
              当前有 {longTask.activeTrackCount} 名学生在使用它。
            </Typography.Text>
            <Typography.Text type="secondary">
              为免连带删除学生的历史任务，系统会把它归档——列表里不再出现，
              已经排过的任务保持完整。
            </Typography.Text>
          </Space>
        ) : (
          <Typography.Text>删除后不会再出现在长期任务列表里。</Typography.Text>
        ),
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await deleteMutation.mutateAsync();
        } catch {
          // 失败提示已在 onError 里给出，这里只负责不让弹窗卡住。
        }
      },
    });
  }

  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Card
        title={
          <Space size="small">
            <span>{longTask.name}</span>
            {longTask.status === "ACTIVE" ? (
              <Tag color="green">使用中</Tag>
            ) : (
              <Tag>
                {longTask.status === "RETIRED" ? "已停用" : longTask.status}
              </Tag>
            )}
          </Space>
        }
        extra={
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => void navigate("/long-tasks")}
          >
            返回列表
          </Button>
        }
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            sampleTitle: firstItemTitle(longTask),
            startOrdinal: longTask.defaultStartOrdinal,
            endOrdinal: longTask.endOrdinal ?? undefined,
            defaultDurationMinutes:
              longTask.defaultDurationMinutes ?? undefined,
          }}
          onFinish={(values) => saveMutation.mutate(values)}
        >
          <Form.Item
            name="sampleTitle"
            label="任务名称（填第一项的完整标题）"
            rules={[{ required: true, message: "请填写任务名称" }]}
            extra="标题以数字结尾时自动识别序号，如「一天一句长难句 Day 1」「密卷1」"
          >
            <Input placeholder="一天一句长难句 Day 1" maxLength={200} />
          </Form.Item>
          {preview ? (
            <Form.Item label="接排预览">
              <Typography.Text code>{preview}</Typography.Text>
            </Form.Item>
          ) : null}
          <Button
            type="link"
            size="small"
            style={{ paddingInline: 0 }}
            icon={advancedOpen ? <DownOutlined /> : <RightOutlined />}
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            高级设置
          </Button>
          <div hidden={!advancedOpen} style={{ paddingTop: 8 }}>
            <Form.Item
              name="startOrdinal"
              label="从第几项开始"
              extra="默认跟随标题里的数字；手动改过之后就以这里的值为准"
            >
              <InputNumber
                min={1}
                precision={0}
                style={{ width: "100%" }}
                onChange={() => setOrdinalTouched(true)}
              />
            </Form.Item>
            <Form.Item
              name="endOrdinal"
              label="结束到第几项"
              extra="留空表示不限，完成一项自动接排下一项"
            >
              <InputNumber
                min={1}
                precision={0}
                style={{ width: "100%" }}
                placeholder="留空表示不限"
              />
            </Form.Item>
            <Form.Item
              name="defaultDurationMinutes"
              label="默认时长（分钟）"
              extra="留空表示不预设时长"
            >
              <InputNumber
                min={1}
                max={1440}
                precision={0}
                style={{ width: "100%" }}
                placeholder="留空表示不预设"
              />
            </Form.Item>
          </div>
          <Space>
            <Button
              type="primary"
              htmlType="submit"
              loading={saveMutation.isPending}
            >
              保存
            </Button>
            <Button
              onClick={() => {
                form.resetFields();
                setOrdinalTouched(false);
              }}
            >
              还原
            </Button>
          </Space>
        </Form>
      </Card>

      <Card title="删除长期任务" className="danger-zone-card">
        <Space orientation="vertical" size="small" style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            {longTask.activeTrackCount > 0
              ? `当前有 ${longTask.activeTrackCount} 名学生在使用。删除会归档该定义，学生的历史任务不受影响。`
              : "还没有学生挂载过它，删除会彻底移除这个定义。"}
          </Typography.Text>
          <Button
            danger
            onClick={confirmDelete}
            loading={deleteMutation.isPending}
          >
            删除这个长期任务
          </Button>
        </Space>
      </Card>
    </Space>
  );
}

export default LongTaskDetailPage;
