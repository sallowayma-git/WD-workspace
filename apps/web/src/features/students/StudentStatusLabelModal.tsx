import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  ColorPicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
} from "antd";
import { useEffect, useState } from "react";
import type { StudentStatusLabel } from "./studentApi";
import { serializeStatusLabelColor } from "./studentStatusLabelColor";

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
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      void Promise.resolve().then(() => setDeleteError(null));
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
        void form.validateFields().then((values) =>
          onSubmit(
            values.labels.map((label) => ({
              ...label,
              color: serializeStatusLabelColor(label.color),
            })),
          ),
        );
      }}
      destroyOnHidden
    >
      {deleteError ? (
        <Alert
          type="error"
          showIcon
          closable
          message={deleteError}
          onClose={() => setDeleteError(null)}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Form form={form} layout="vertical" initialValues={{ labels: [] }}>
        <Form.List name="labels">
          {(fields, { add, remove }) => {
            const removeById = (id: string) => {
              const currentRows = form.getFieldValue("labels") as
                StudentStatusLabelDraft[] | undefined;
              const currentIndex = currentRows?.findIndex(
                (row) => row.id === id,
              );
              if (currentIndex != null && currentIndex >= 0) {
                remove(currentIndex);
              }
            };
            return (
              <Space direction="vertical" style={{ width: "100%" }}>
                {fields.map((field, index) => {
                  // `field.name` is the current list index and changes after a
                  // deletion. Resolve the persisted id from the form store so a
                  // second quick deletion cannot target the old labels[index].
                  const fieldDraft = form.getFieldValue([
                    "labels",
                    field.name,
                  ]) as StudentStatusLabelDraft | undefined;
                  const current = fieldDraft?.id
                    ? (labels.find((label) => label.id === fieldDraft.id) ??
                      (fieldDraft as StudentStatusLabel))
                    : undefined;
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
                      <Form.Item {...field} name={[field.name, "id"]} hidden>
                        <Input />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, "color"]}
                        style={{ marginBottom: 8 }}
                        getValueFromEvent={(color: unknown) =>
                          serializeStatusLabelColor(color)
                        }
                        getValueProps={(color: unknown) => ({
                          value: serializeStatusLabelColor(color),
                        })}
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
                        loading={current?.id === deletingId}
                        disabled={deletingId !== null}
                        onClick={() => {
                          if (!current || !onDelete) {
                            remove(field.name);
                            return;
                          }
                          setDeleteError(null);
                          setDeletingId(current.id);
                          void Promise.resolve(onDelete(current))
                            .then(() => removeById(current.id))
                            .catch((error: unknown) => {
                              setDeleteError(
                                error instanceof Error
                                  ? error.message
                                  : "删除状态失败，请稍后重试",
                              );
                            })
                            .finally(() => setDeletingId(null));
                        }}
                      />
                    </Space>
                  );
                })}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() =>
                    add({
                      label: "",
                      color: null,
                      sortOrder: fields.length + 1,
                    })
                  }
                >
                  添加状态
                </Button>
              </Space>
            );
          }}
        </Form.List>
      </Form>
    </Modal>
  );
}
