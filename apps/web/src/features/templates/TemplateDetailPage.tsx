import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Popconfirm,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../lib/api/http";
import {
  createTemplateDraft,
  getTemplateDetail,
  listVersionItems,
  publishVersion,
  replaceVersionItems,
  type TemplateItem,
} from "./templateApi";

const statusColor: Record<string, string> = {
  DRAFT: "blue",
  PUBLISHED: "green",
  RETIRED: "default",
  ACTIVE: "green",
  ARCHIVED: "default",
};

const statusLabel: Record<string, string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  RETIRED: "已停用",
  ACTIVE: "活跃",
  ARCHIVED: "已归档",
};

export function TemplateDetailPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ["template", templateId],
    queryFn: () => getTemplateDetail(templateId as string),
    enabled: Boolean(templateId),
    retry: false,
  });

  const draftVersion = detailQuery.data?.versions.find(
    (v) => v.status === "DRAFT",
  );
  const publishedVersion = detailQuery.data?.versions.find(
    (v) => v.status === "PUBLISHED",
  );

  const itemsQuery = useQuery({
    queryKey: ["template-version-items", draftVersion?.id],
    queryFn: () => listVersionItems(draftVersion!.id),
    enabled: Boolean(draftVersion?.id),
    retry: false,
  });

  const publishMutation = useMutation({
    mutationFn: (versionId: string) => publishVersion(versionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["template", templateId],
      });
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });

  const draftMutation = useMutation({
    mutationFn: (tid: string) => createTemplateDraft(tid),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["template", templateId],
      });
    },
  });

  const saveItemsMutation = useMutation({
    mutationFn: (params: { versionId: string; items: TemplateItem[] }) =>
      replaceVersionItems(params.versionId, {
        items: params.items.map((it) => ({
          ordinal: it.ordinal,
          itemCode: it.itemCode,
          title: it.title,
          shortTitle: it.shortTitle,
          durationMinutes: it.durationMinutes,
          requiresDevice: it.requiresDevice ?? false,
          contentRef: it.contentRef,
          instructions: it.instructions,
          active: it.active,
        })),
        changeNote: null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["template-version-items", draftVersion?.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["template", templateId],
      });
    },
  });

  if (detailQuery.isPending) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 10 }} />
      </Card>
    );
  }

  if (detailQuery.isError) {
    const error = detailQuery.error;
    return (
      <Card>
        <Alert
          type="error"
          title="模板详情暂不可用"
          showIcon
          description={
            error instanceof ApiError
              ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
              : "请确认 API 已启动并登录。"
          }
          action={
            <Button type="link" onClick={() => void detailQuery.refetch()}>
              重试
            </Button>
          }
        />
      </Card>
    );
  }

  const template = detailQuery.data;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space>
        <Button icon={<ArrowLeftOutlined />} onClick={() => void navigate(-1)}>
          返回
        </Button>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {template.name}
        </Typography.Title>
        <Tag color={statusColor[template.status]}>
          {statusLabel[template.status]}
        </Tag>
        <Typography.Text type="secondary">
          {template.templateCode}
        </Typography.Text>
      </Space>

      <Card title="模板信息">
        <Space direction="vertical" size="small">
          <Typography.Text>
            <strong>学科：</strong>
            {template.subjectCode}
          </Typography.Text>
          <Typography.Text>
            <strong>单位标签：</strong>
            {template.unitLabel}
          </Typography.Text>
          <Typography.Text>
            <strong>默认时长：</strong>
            {template.defaultDurationMinutes
              ? `${template.defaultDurationMinutes} 分钟`
              : "未设置"}
          </Typography.Text>
          <Typography.Text>
            <strong>默认需要设备：</strong>
            {template.defaultRequiresDevice ? "是" : "否"}
          </Typography.Text>
          {template.currentPublishedVersionNumber ? (
            <Typography.Text>
              <strong>当前发布版本：</strong>v
              {template.currentPublishedVersionNumber}（
              {template.currentItemCount ?? 0} 单元）
            </Typography.Text>
          ) : null}
        </Space>
      </Card>

      <Card
        title="版本列表"
        extra={
          publishedVersion && !draftVersion ? (
            <Button
              icon={<PlusOutlined />}
              loading={draftMutation.isPending}
              onClick={() => draftMutation.mutate(template.id)}
            >
              创建新草稿
            </Button>
          ) : null
        }
      >
        <Table
          rowKey="id"
          dataSource={template.versions}
          pagination={false}
          columns={[
            {
              title: "版本",
              dataIndex: "versionNumber",
              key: "versionNumber",
              render: (v: number) => `v${v}`,
            },
            {
              title: "状态",
              dataIndex: "status",
              key: "status",
              render: (s: string) => (
                <Tag color={statusColor[s]}>{statusLabel[s]}</Tag>
              ),
            },
            {
              title: "单元数",
              dataIndex: "itemCount",
              key: "itemCount",
            },
            {
              title: "发布时间",
              dataIndex: "publishedAt",
              key: "publishedAt",
              render: (v: string | null) => v ?? "-",
            },
            {
              title: "操作",
              key: "actions",
              render: (_v: unknown, version) =>
                version.status === "DRAFT" ? (
                  <Popconfirm
                    title="确认发布此版本？"
                    description="发布后版本不可修改。"
                    onConfirm={() => publishMutation.mutate(version.id)}
                  >
                    <Button
                      type="primary"
                      size="small"
                      loading={publishMutation.isPending}
                    >
                      发布
                    </Button>
                  </Popconfirm>
                ) : null,
            },
          ]}
        />
      </Card>

      {draftVersion ? (
        <DraftItemEditor
          versionId={draftVersion.id}
          items={itemsQuery.data ?? []}
          loading={itemsQuery.isPending}
          saving={saveItemsMutation.isPending}
          error={saveItemsMutation.isError ? saveItemsMutation.error : null}
          onSave={(items) =>
            saveItemsMutation.mutate({
              versionId: draftVersion.id,
              items,
            })
          }
        />
      ) : null}
    </Space>
  );
}

function DraftItemEditor({
  versionId,
  items,
  loading,
  saving,
  error,
  onSave,
}: {
  versionId: string;
  items: TemplateItem[];
  loading: boolean;
  saving: boolean;
  error: Error | null;
  onSave: (items: TemplateItem[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TemplateItem[]>(items);

  if (loading) {
    return (
      <Card title="草稿单元编辑">
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }

  const startEdit = () => {
    setDraft(items);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const save = () => {
    const renumbered = draft.map((item, index) => ({
      ...item,
      ordinal: index + 1,
    }));
    onSave(renumbered);
    setEditing(false);
  };

  const addItem = () => {
    const nextOrdinal = draft.length + 1;
    setDraft([
      ...draft,
      {
        id: `new-${nextOrdinal}`,
        ordinal: nextOrdinal,
        itemCode: null,
        title: "",
        shortTitle: null,
        durationMinutes: null,
        requiresDevice: null,
        contentRef: null,
        instructions: null,
        active: true,
      },
    ]);
  };

  const removeItem = (index: number) => {
    setDraft(draft.filter((_, i) => i !== index));
  };

  const updateItem = (
    index: number,
    field: keyof TemplateItem,
    value: unknown,
  ) => {
    setDraft(
      draft.map((item, i) =>
        i === index ? { ...item, [field]: value } : item,
      ),
    );
  };

  return (
    <Card
      title={`草稿单元编辑（${versionId.slice(0, 8)}…）`}
      extra={
        editing ? (
          <Space>
            <Button onClick={cancelEdit}>取消</Button>
            <Button type="primary" loading={saving} onClick={save}>
              保存
            </Button>
          </Space>
        ) : (
          <Button onClick={startEdit}>编辑</Button>
        )
      }
    >
      {error ? (
        <Alert
          type="error"
          title="保存失败"
          showIcon
          description={error.message}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {editing ? (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Table<TemplateItem>
            rowKey="id"
            dataSource={draft}
            pagination={false}
            size="small"
            columns={[
              {
                title: "#",
                key: "ordinal",
                width: 40,
                render: (_v: unknown, _row, index) => index + 1,
              },
              {
                title: "标题",
                key: "title",
                render: (_v: unknown, _row, index) => (
                  <Input
                    value={draft[index]?.title ?? ""}
                    onChange={(e) => updateItem(index, "title", e.target.value)}
                    size="small"
                  />
                ),
              },
              {
                title: "简称",
                key: "shortTitle",
                width: 120,
                render: (_v: unknown, _row, index) => (
                  <Input
                    value={draft[index]?.shortTitle ?? ""}
                    onChange={(e) =>
                      updateItem(index, "shortTitle", e.target.value || null)
                    }
                    size="small"
                  />
                ),
              },
              {
                title: "时长",
                key: "durationMinutes",
                width: 80,
                render: (_v: unknown, _row, index) => (
                  <InputNumber
                    value={draft[index]?.durationMinutes ?? undefined}
                    onChange={(v) =>
                      updateItem(index, "durationMinutes", v ?? null)
                    }
                    size="small"
                    min={1}
                    max={1440}
                    placeholder="默认"
                  />
                ),
              },
              {
                title: "设备",
                key: "requiresDevice",
                width: 60,
                render: (_v: unknown, _row, index) => (
                  <Switch
                    size="small"
                    checked={draft[index]?.requiresDevice ?? false}
                    onChange={(v) => updateItem(index, "requiresDevice", v)}
                  />
                ),
              },
              {
                title: "",
                key: "actions",
                width: 40,
                render: (_v: unknown, _row, index) => (
                  <Button size="small" danger onClick={() => removeItem(index)}>
                    删除
                  </Button>
                ),
              },
            ]}
          />
          <Button icon={<PlusOutlined />} onClick={addItem}>
            添加单元
          </Button>
        </Space>
      ) : items.length === 0 ? (
        <Empty description="草稿暂无单元">
          <Button type="primary" onClick={startEdit}>
            开始编辑
          </Button>
        </Empty>
      ) : (
        <Table<TemplateItem>
          rowKey="id"
          dataSource={items}
          pagination={false}
          size="small"
          columns={[
            {
              title: "#",
              dataIndex: "ordinal",
              key: "ordinal",
              width: 40,
            },
            {
              title: "编码",
              dataIndex: "itemCode",
              key: "itemCode",
              width: 120,
              render: (v: string | null) => v ?? "-",
            },
            {
              title: "标题",
              dataIndex: "title",
              key: "title",
            },
            {
              title: "简称",
              dataIndex: "shortTitle",
              key: "shortTitle",
              width: 120,
              render: (v: string | null) => v ?? "-",
            },
            {
              title: "时长",
              dataIndex: "durationMinutes",
              key: "durationMinutes",
              width: 80,
              render: (v: number | null) => (v ? `${v}分钟` : "-"),
            },
            {
              title: "设备",
              dataIndex: "requiresDevice",
              key: "requiresDevice",
              width: 60,
              render: (v: boolean | null) =>
                v === true ? "是" : v === false ? "否" : "-",
            },
          ]}
        />
      )}
    </Card>
  );
}
