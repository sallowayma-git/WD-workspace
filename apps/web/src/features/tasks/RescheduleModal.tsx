import { Form, Input, Modal } from "antd";
import { useState } from "react";
import { ApiError } from "../../lib/api/http";
import { rescheduleTask } from "../schedule/scheduleApi";

export interface RescheduleModalProps {
  open: boolean;
  taskId: string;
  taskVersion: number;
  /** Initial date shown in the picker (ISO yyyy-mm-dd). */
  initialDate?: string | null;
  onCancel: () => void;
  /** Called with the committed target date after a successful reschedule. */
  onSuccess: (targetDate: string) => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "改期失败，请重试";
}

/**
 * AC-007 / BR-009: custom-date reschedule dialog. Calls the existing
 * rescheduleTask endpoint (POST /tasks/{id}/reschedule) and surfaces an
 * optional override reason for manual date overrides.
 *
 * Uses a native <input type="date"> rather than antd DatePicker — this
 * project does not depend on dayjs, which antd 6's DatePicker requires.
 *
 * The form is reset declaratively via the `key` on the inner Form whenever
 * `open` flips true (Modal uses destroyOnHidden so each open is a fresh
 * mount), avoiding setState-in-effect.
 */
export function RescheduleModal({
  open,
  taskId,
  taskVersion,
  initialDate,
  onCancel,
  onSuccess,
}: RescheduleModalProps) {
  const [form] = Form.useForm<{ date: string; reason: string }>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOk(): void {
    void (async () => {
      try {
        const values = await form.validateFields();
        setSubmitting(true);
        setError(null);
        await rescheduleTask(
          taskId,
          taskVersion,
          values.date,
          values.reason?.trim() ? values.reason.trim() : undefined,
        );
        onSuccess(values.date);
      } catch (err) {
        setError(describeError(err));
      } finally {
        setSubmitting(false);
      }
    })();
  }

  return (
    <Modal
      title="改期"
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={submitting}
      okText="确定改期"
      cancelText="取消"
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          date: initialDate ?? todayIso(),
          reason: "",
        }}
      >
        <Form.Item
          name="date"
          label="目标日期"
          rules={[{ required: true, message: "请选择日期" }]}
        >
          <Input type="date" />
        </Form.Item>
        <Form.Item name="reason" label="覆盖原因（可选）">
          <Input.TextArea
            rows={2}
            placeholder="如：学生临时请假"
            maxLength={200}
          />
        </Form.Item>
        {error ? (
          <div style={{ color: "#ff4d4f", marginTop: 8 }}>{error}</div>
        ) : null}
      </Form>
    </Modal>
  );
}

export default RescheduleModal;
