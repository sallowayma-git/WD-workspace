import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import {
  Button,
  ColorPicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
} from "antd";
import { useEffect } from "react";
import type { StudentStatusLabel } from "./studentApi";

export type StudentStatusLabelDraft = {
  id?: string;
  label: string;
  color: string | null;
  sortOrder: number;
};

export type StudentStatusLabelModalProps = {
  open: boolean;
  labels: StudentStatusLabel[];
  confirmLoading?: boolean;
  onCancel: () => void;
  onSubmit: (labels: StudentStatusLabelDraft[]) => void | Promise<void>;
  onDelete?: (label: StudentStatusLabel) => void | Promise<void>;
};

/** Dynamic urgency-label editor shared by the list, profile and workbench. */
export function StudentStatusLabelModal({
  open,
  labels,
  confirmLoading = false,
  onCancel,
  onSubmit,
  onDelete,
}: StudentStatusLabelModalProps) {
  const [form] = Form.useForm<{ labels: StudentStatusLabelDraft[] }>();

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        labels: labels.map((label) => ({
          id: label.id,
          label: label.label,
          color: label.color,
          sortOrder: label.sortOrder,
        })),
      });
    }
  }, [form, labels, open]);

  return (
    <Modal
      title="管理学生状态"
      open={open}
      okText="保存"
      cancelText="取消"
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={() => {
        void form.validateFields().then((values) => onSubmit(values.labels));
      }}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" initialValues={{ labels: [] }}>
        <Form.List name="labels">
          {(fields, { add, remove }) => (
            <Space direction="vertical" style={{ width: "100%" }}>
              {fields.map((field, index) => {
                const current = labels[index];
                return (
                  <Space
                    key={field.key}
                    align="start"
                    style={{ width: "100%" }}
                  >
                    <Form.Item
                      {...field}
                      name={[field.name, "label"]}
                      rules={[
                        {
                          required: true,
                          whitespace: true,
                          message: "请输入名称",
                        },
                      ]}
                      style={{ flex: 1, marginBottom: 8 }}
                    >
                      <Input
                        aria-label={`状态名称 ${index + 1}`}
                        maxLength={30}
                      />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      name={[field.name, "color"]}
                      style={{ marginBottom: 8 }}
                    >
                      <ColorPicker format="hex" allowClear />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      name={[field.name, "sortOrder"]}
                      style={{ marginBottom: 8 }}
                    >
                      <InputNumber
                        aria-label={`状态排序 ${index + 1}`}
                        min={0}
                        precision={0}
                        style={{ width: 72 }}
                      />
                    </Form.Item>
                    <Button
                      danger
                      type="text"
                      icon={<DeleteOutlined />}
                      aria-label={`删除状态 ${index + 1}`}
                      onClick={() => {
                        if (current && onDelete) void onDelete(current);
                        remove(field.name);
                      }}
                    />
                  </Space>
                );
              })}
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() =>
                  add({ label: "", color: null, sortOrder: fields.length + 1 })
                }
              >
                添加状态
              </Button>
            </Space>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}
