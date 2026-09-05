import {
  App as AntdApp,
  Form,
  Input,
  InputNumber,
  Modal,
  Typography,
} from "antd";
import { useMemo, useState } from "react";
import { ApiError } from "../../lib/api/ApiError";
import {
  parseSeriesTitle,
  renderSeriesTitlePattern,
  seriesNormalizedKey,
} from "../../domain/task/seriesTitle";
import { createLongTask } from "./longTaskApi";

interface CreateLongTaskModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (longTaskId: string) => void;
}

interface CreateLongTaskValues {
  sampleTitle: string;
  startOrdinal?: number;
  endOrdinal?: number | null;
}

/**
 * 新建长期任务。输入一个示例标题（如「一天一句长难句 Day 1」），系统解析出
 * 标题模板与起始序号；结束序号留空即持续任务。前端解析只做预览，最终以
 * 适配器写入的模板为准。
 */
export function CreateLongTaskModal({
  open,
  onClose,
  onCreated,
}: CreateLongTaskModalProps) {
  const [form] = Form.useForm<CreateLongTaskValues>();
  const { message } = AntdApp.useApp();
  const [submitting, setSubmitting] = useState(false);

  const sampleTitle = Form.useWatch("sampleTitle", form) ?? "";
  const startOrdinal = Form.useWatch("startOrdinal", form);

  // 预览：与适配器同一套解析规则（尾部数字，允许“第N天”）。
  const preview = useMemo(() => {
    const trimmed = sampleTitle.trim();
    if (!trimmed) return null;
    const parsed = parseSeriesTitle(trimmed);
    const pattern = parsed
      ? `${parsed.prefix}{n}${parsed.suffix}`
      : `${trimmed} {n}`;
    const base = startOrdinal ?? parsed?.number ?? 1;
    return [0, 1, 2].map((offset) =>
      renderSeriesTitlePattern(pattern, base + offset),
    );
  }, [sampleTitle, startOrdinal]);

  async function handleSubmit(): Promise<void> {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const created = await createLongTask({
        sampleTitle: values.sampleTitle,
        startOrdinal: values.startOrdinal,
        endOrdinal: values.endOrdinal ?? null,
      });
      void message.success(`已创建长期任务「${created.name}」`);
      onCreated?.(created.id);
      form.resetFields();
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        void message.error(
          `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`,
        );
      } else if (
        error instanceof Error &&
        error.message !== "Validation failed"
      ) {
        void message.error("创建失败，请稍后重试");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="新建长期任务"
      open={open}
      onOk={() => void handleSubmit()}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      okText="创建"
      confirmLoading={submitting}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="sampleTitle"
          label="任务名称（填第一项的完整标题）"
          rules={[{ required: true, message: "请填写任务名称" }]}
          extra="标题以数字结尾时自动识别序号，如「一天一句长难句 Day 1」「密卷1」"
        >
          <Input placeholder="一天一句长难句 Day 1" maxLength={200} />
        </Form.Item>
        <Form.Item
          name="startOrdinal"
          label="起始序号"
          extra="留空时自动取标题里的数字，没有数字则从 1 开始"
        >
          <InputNumber min={1} precision={0} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="endOrdinal" label="结束序号（可选）">
          <InputNumber
            min={1}
            precision={0}
            style={{ width: "100%" }}
            placeholder="留空表示不限，完成一项自动接排下一项"
          />
        </Form.Item>
        {preview ? (
          <Form.Item label="预览">
            <Typography.Text code>
              {preview.join("、")}
              {" …"}
            </Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              归一化键：{seriesNormalizedKey(sampleTitle.trim())}
            </Typography.Paragraph>
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  );
}

export default CreateLongTaskModal;
