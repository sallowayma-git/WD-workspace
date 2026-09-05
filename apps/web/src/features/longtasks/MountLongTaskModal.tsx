import {
  App as AntdApp,
  Form,
  InputNumber,
  Modal,
  Select,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../lib/api/ApiError";
import { listLongTasks, mountLongTask, type LongTask } from "./longTaskApi";
import { renderSeriesTitlePattern } from "../../domain/task/seriesTitle";

interface MountLongTaskModalProps {
  studentId: string;
  /** 挂载锚点日：从某日 cell 发起时是该 cell 的日期，资料页是业务日。 */
  anchorDate: string;
  open: boolean;
  onClose: () => void;
  onMounted?: (trackId: string) => void;
}

/**
 * 挂载长期任务（SEQUENCE 轨道）。用户只需要选择哪个长期任务、从第几项开始：
 * 结束序号来自定义，锚点日期由调用位置带入，不暴露版本/排期策略等内部概念。
 */
export function MountLongTaskModal({
  studentId,
  anchorDate,
  open,
  onClose,
  onMounted,
}: MountLongTaskModalProps) {
  const [form] = Form.useForm<{ longTaskId: string; currentOrdinal: number }>();
  const { message } = AntdApp.useApp();
  const [submitting, setSubmitting] = useState(false);
  const longTasksQuery = useQuery({
    queryKey: ["long-tasks"],
    queryFn: () => listLongTasks(),
    enabled: open,
  });
  const longTasks: LongTask[] = useMemo(
    () => longTasksQuery.data ?? [],
    [longTasksQuery.data],
  );

  const selectedId = Form.useWatch("longTaskId", form);
  const currentOrdinal = Form.useWatch("currentOrdinal", form);
  const selected = longTasks.find((task) => task.id === selectedId);

  useEffect(() => {
    if (!open) return;
    const first = longTasks[0];
    form.setFieldsValue({
      longTaskId: first?.id ?? undefined,
      currentOrdinal: first?.defaultStartOrdinal ?? 1,
    });
  }, [open, longTasks, form]);

  // 序号变化时同步预览：今天这一项长什么样。
  const preview =
    selected != null && currentOrdinal != null
      ? renderSeriesTitlePattern(selected.titlePattern, currentOrdinal)
      : null;

  async function handleSubmit(): Promise<void> {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const track = await mountLongTask({
        studentId,
        longTaskId: values.longTaskId,
        currentOrdinal: values.currentOrdinal,
        anchorDate,
      });
      void message.success(
        `已挂载，第一项「${renderSeriesTitlePattern(
          track.titlePatternSnapshot ?? "",
          track.currentOrdinal,
        )}」已排在 ${track.nextCandidateDate ?? anchorDate}`,
      );
      onMounted?.(track.id);
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
        void message.error("挂载失败，请稍后重试");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="挂载长期任务"
      open={open}
      onOk={() => void handleSubmit()}
      onCancel={onClose}
      okText="挂载"
      confirmLoading={submitting}
      destroyOnHidden
    >
      {longTasks.length === 0 && !longTasksQuery.isLoading ? (
        <Typography.Text type="secondary">
          还没有长期任务。可以在「长期任务」页新建，或把学生的一个普通任务右键
          「设为长期任务」。
        </Typography.Text>
      ) : (
        <Form form={form} layout="vertical">
          <Form.Item
            name="longTaskId"
            label="长期任务"
            rules={[{ required: true, message: "请选择长期任务" }]}
          >
            <Select
              placeholder="选择长期任务"
              options={longTasks.map((task) => ({
                value: task.id,
                label: `${task.name}${task.endOrdinal != null ? `（${task.defaultStartOrdinal}–${task.endOrdinal}）` : "（持续）"}`,
              }))}
              onChange={(value: string) => {
                const next = longTasks.find((task) => task.id === value);
                if (next) {
                  form.setFieldValue(
                    "currentOrdinal",
                    next.defaultStartOrdinal,
                  );
                }
              }}
            />
          </Form.Item>
          <Form.Item
            name="currentOrdinal"
            label="从第几项开始"
            rules={[{ required: true, message: "请填写起始序号" }]}
          >
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          {selected && preview ? (
            <Typography.Text type="secondary">
              首项：{preview}
              {selected.endOrdinal != null
                ? ` · 最后一项：${renderSeriesTitlePattern(selected.titlePattern, selected.endOrdinal)}`
                : " · 之后完成一项自动接排下一项"}
            </Typography.Text>
          ) : null}
        </Form>
      )}
    </Modal>
  );
}

export default MountLongTaskModal;
