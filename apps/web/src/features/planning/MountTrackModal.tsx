import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Form, Input, InputNumber, Modal, Select, Space } from "antd";
import { useEffect, useState } from "react";
import { ApiError } from "../../lib/api/http";
import { mountTrack } from "./trackApi";
import {
  getTemplateDetail,
  listTemplates,
  listVersionItems,
} from "../templates/templateApi";

type MountFormValues = {
  templateId: string;
  templateVersionId: string;
  startOrdinal: number;
  endOrdinal: number;
  startDate: string;
  defaultUnitsPerSession: number;
  priority: number;
  note: string | undefined;
};

export function MountTrackModal({
  studentId,
  open,
  onClose,
}: {
  studentId: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<MountFormValues>();
  const [override, setOverride] = useState<{
    open: boolean;
    message: string;
  }>({ open: false, message: "" });

  const templatesQuery = useQuery({
    queryKey: ["templates-for-mount"],
    queryFn: () => listTemplates(),
    enabled: open,
    retry: false,
  });

  const templateId = Form.useWatch("templateId", form);

  const detailQuery = useQuery({
    queryKey: ["template-detail", templateId],
    queryFn: () => getTemplateDetail(templateId),
    enabled: Boolean(templateId),
    retry: false,
  });

  const publishedVersion = detailQuery.data?.versions.find(
    (version) => version.status === "PUBLISHED",
  );

  const versionId = Form.useWatch("templateVersionId", form);

  const itemsQuery = useQuery({
    queryKey: ["version-items", versionId],
    queryFn: () => listVersionItems(versionId),
    enabled: Boolean(versionId),
    retry: false,
  });

  const maxOrdinal = itemsQuery.data
    ? itemsQuery.data.reduce((max, item) => Math.max(max, item.ordinal), 0)
    : 0;

  // When template detail loads, auto-select the published version.
  useEffect(() => {
    if (publishedVersion && templateId) {
      const current: unknown = form.getFieldValue("templateVersionId");
      if (current !== publishedVersion.id) {
        form.setFieldValue("templateVersionId", publishedVersion.id);
      }
    }
  }, [form, publishedVersion, templateId]);

  // When version items load, default start=1, end=maxOrdinal.
  useEffect(() => {
    if (itemsQuery.data && itemsQuery.data.length > 0 && templateId) {
      const currentStart: unknown = form.getFieldValue("startOrdinal");
      if (currentStart === undefined) {
        form.setFieldValue("startOrdinal", 1);
        form.setFieldValue("endOrdinal", maxOrdinal);
      }
    }
  }, [form, itemsQuery.data, templateId, maxOrdinal]);

  const mountMutation = useMutation({
    mutationFn: (values: MountFormValues) =>
      mountTrack({
        studentId,
        templateId: values.templateId,
        templateVersionId: values.templateVersionId,
        startOrdinal: values.startOrdinal,
        endOrdinal: values.endOrdinal,
        startDate: values.startDate,
        defaultUnitsPerSession: values.defaultUnitsPerSession,
        priority: values.priority,
        note: values.note && values.note.length > 0 ? values.note : undefined,
        createFirstInstance: false,
        confirmOverride: override.open,
      }),
    onSuccess: async (track) => {
      // The backend signals "needs override confirmation" by returning 200 OK
      // with a track preview carrying warnings and no persisted id. Detect this
      // structurally (id absent + warnings present) rather than by message text.
      if (
        track &&
        track.id == null &&
        Array.isArray(track.warnings) &&
        track.warnings.length > 0
      ) {
        setOverride({
          open: true,
          message: track.warnings.join("；"),
        });
        return;
      }
      setOverride({ open: false, message: "" });
      await queryClient.invalidateQueries({
        queryKey: ["student-tracks", studentId],
      });
      form.resetFields();
      onClose();
    },
    onError: (error) => {
      // Override/conflict detection is based on ApiError.code and status, not
      // on the localized message text. Codes that indicate a retry-with-override
      // situation are the 409 conflict family and the 422 validation family
      // returned by TrackService.mountTrack (see TrackService.java).
      const OVERRIDE_CODES = new Set([
        "TEMPLATE_VERSION_NOT_PUBLISHED",
        "TRACK_VERSION_CONFLICT",
        "TRACK_ORDINAL_INVALID",
        "TRACK_ORDINAL_RANGE_INVALID",
        "TRACK_START_ORDINAL_MISSING",
        "TRACK_PRIORITY_INVALID",
        "TRACK_POLICY_INVALID",
        "TRACK_DEVICE_POLICY_INVALID",
      ]);
      if (
        error instanceof ApiError &&
        (error.status === 409 || error.status === 422) &&
        (error.code != null && OVERRIDE_CODES.has(error.code))
      ) {
        setOverride({ open: true, message: error.message });
      }
    },
  });

  function handleTemplateChange(value: string) {
    form.setFieldValue("templateId", value);
    form.setFieldValue("templateVersionId", undefined);
    form.setFieldValue("startOrdinal", undefined);
    form.setFieldValue("endOrdinal", undefined);
    setOverride({ open: false, message: "" });
  }

  function handleVersionChange(value: string) {
    form.setFieldValue("templateVersionId", value);
    form.setFieldValue("startOrdinal", undefined);
    form.setFieldValue("endOrdinal", undefined);
    setOverride({ open: false, message: "" });
  }

  function handleSubmit() {
    void form.validateFields().then((values) => {
      mountMutation.mutate(values);
    });
  }

  return (
    <Modal
      title="挂载任务轨道"
      open={open}
      onCancel={() => {
        form.resetFields();
        setOverride({ open: false, message: "" });
        onClose();
      }}
      onOk={handleSubmit}
      okText={override.open ? "确认 override 并挂载" : "挂载"}
      confirmLoading={mountMutation.isPending}
      okButtonProps={{ disabled: !templateId || !versionId }}
      destroyOnHidden
    >
      <Form<MountFormValues>
        form={form}
        layout="vertical"
        initialValues={{
          defaultUnitsPerSession: 1,
          priority: 50,
        }}
      >
        <Form.Item
          name="templateId"
          label="任务模板"
          rules={[{ required: true, message: "请选择模板" }]}
        >
          <Select
            placeholder="选择已发布模板"
            showSearch
            optionFilterProp="label"
            loading={templatesQuery.isPending}
            onChange={handleTemplateChange}
            options={(templatesQuery.data?.items ?? [])
              .filter((template) => template.currentPublishedVersionId)
              .map((template) => ({
                value: template.id,
                label: `${template.name}（${template.templateCode}）`,
              }))}
          />
        </Form.Item>
        <Form.Item
          name="templateVersionId"
          label="模板版本"
          rules={[{ required: true, message: "请选择版本" }]}
        >
          <Select
            placeholder="选择已发布版本"
            loading={detailQuery.isPending}
            disabled={!templateId}
            onChange={handleVersionChange}
            options={(detailQuery.data?.versions ?? [])
              .filter((version) => version.status === "PUBLISHED")
              .map((version) => ({
                value: version.id,
                label: `v${version.versionNumber}（${version.itemCount} 单元）`,
              }))}
          />
        </Form.Item>
        <Space style={{ display: "flex" }} align="start">
          <Form.Item
            name="startOrdinal"
            label="起始单元"
            rules={[{ required: true, message: "请输入起始单元" }]}
          >
            <InputNumber
              min={1}
              max={maxOrdinal || undefined}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="endOrdinal"
            label="结束单元"
            rules={[{ required: true, message: "请输入结束单元" }]}
          >
            <InputNumber
              min={1}
              max={maxOrdinal || undefined}
              style={{ width: "100%" }}
            />
          </Form.Item>
        </Space>
        {maxOrdinal > 0 ? (
          <Alert
            type="info"
            showIcon
            message={`该版本共 ${maxOrdinal} 个单元`}
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <Form.Item
          name="startDate"
          label="开始日期"
          rules={[{ required: true, message: "请选择开始日期" }]}
        >
          <Input type="date" />
        </Form.Item>
        <Space style={{ display: "flex" }} align="start">
          <Form.Item
            name="defaultUnitsPerSession"
            label="每次默认单元数"
            rules={[{ required: true }]}
          >
            <InputNumber min={1} max={10} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="priority"
            label="优先级"
            rules={[{ required: true }]}
          >
            <InputNumber min={1} max={100} style={{ width: "100%" }} />
          </Form.Item>
        </Space>
        <Form.Item name="note" label="备注">
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
      </Form>
      {override.open ? (
        <Alert
          type="warning"
          showIcon
          message="需要 override 确认"
          description={`${override.message} 点击“确认 override 并挂载”将以 override 方式挂载。`}
          style={{ marginTop: 8 }}
        />
      ) : null}
      {mountMutation.isError && !override.open ? (
        <Alert
          type="error"
          showIcon
          message="挂载失败"
          description={mountMutation.error?.message ?? "未知错误"}
          style={{ marginTop: 8 }}
        />
      ) : null}
    </Modal>
  );
}
