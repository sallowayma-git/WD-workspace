import {
  App as AntdApp,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Typography,
} from "antd";
import { DownOutlined, RightOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { ApiError } from "../../lib/api/ApiError";
import {
  buildPlainTitlePattern,
  buildSeriesTitlePattern,
  describeSeriesProgression,
  parseSeriesTitle,
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
 * 新建长期任务。默认只要求一个输入：第一项的完整标题（如「一天一句长难句
 * Day 1」）——系统据此解析标题模板与起始序号。起止序号收进「高级设置」，
 * 归一化键、原始 {n} 模板等实现细节一律不出现在界面上。前端解析只做预览，
 * 最终以适配器写入的模板为准。
 */
export function CreateLongTaskModal({
  open,
  onClose,
  onCreated,
}: CreateLongTaskModalProps) {
  const [form] = Form.useForm<CreateLongTaskValues>();
  const queryClient = useQueryClient();
  const { message } = AntdApp.useApp();
  const [submitting, setSubmitting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  const sampleTitle = Form.useWatch("sampleTitle", form) ?? "";
  const startOrdinal = Form.useWatch("startOrdinal", form);
  const endOrdinal = Form.useWatch("endOrdinal", form);

  // 预览：与适配器同一套解析规则（尾部数字，允许“第N天”）。
  const preview = useMemo(() => {
    const trimmed = sampleTitle.trim();
    if (!trimmed) return null;
    const parsed = parseSeriesTitle(trimmed);
    const pattern = parsed
      ? buildSeriesTitlePattern(parsed)
      : buildPlainTitlePattern(trimmed);
    return describeSeriesProgression({
      titlePattern: pattern,
      startOrdinal: startOrdinal ?? parsed?.number ?? 1,
      endOrdinal: endOrdinal ?? null,
      includePrefix: true,
    });
  }, [sampleTitle, startOrdinal, endOrdinal]);

  async function handleSubmit(): Promise<void> {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const created = await createLongTask({
        sampleTitle: values.sampleTitle,
        startOrdinal: values.startOrdinal,
        endOrdinal: values.endOrdinal ?? null,
        idempotencyKey: idempotencyKey.current,
      });
      await queryClient.invalidateQueries({ queryKey: ["long-tasks"] });
      void message.success(`已创建长期任务「${created.name}」`);
      onCreated?.(created.id);
      form.resetFields();
      idempotencyKey.current = crypto.randomUUID();
      setAdvancedOpen(false);
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
        idempotencyKey.current = crypto.randomUUID();
        setAdvancedOpen(false);
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
        {preview ? (
          <Form.Item label="系统预览">
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
            extra="留空时自动取标题里的数字，没有数字则从 1 开始"
          >
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="endOrdinal" label="结束到第几项">
            <InputNumber
              min={1}
              precision={0}
              style={{ width: "100%" }}
              placeholder="留空表示不限，完成一项自动接排下一项"
            />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}

export default CreateLongTaskModal;
