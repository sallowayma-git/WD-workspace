import {
  ArrowLeftOutlined,
  CopyOutlined,
  DownloadOutlined,
  EditOutlined,
  ImportOutlined,
  LeftOutlined,
  RightOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  message,
  Modal,
  Select,
  Skeleton,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../lib/api/http";
import { useBusinessDate } from "../foundation/useBusinessDate";
import {
  listVocabulary,
  previewVocabularyBatch,
  saveVocabularyBatch,
  updateVocabularyEntry,
  VOCABULARY_ENTRY_STATUSES,
  type PreviewEntry,
  type VocabularyEntry,
  type VocabularyEntryStatus,
} from "./vocabularyApi";

const { TextArea } = Input;

const statusColor: Record<string, string> = {
  ACTIVE: "blue",
  MASTERED: "green",
  ARCHIVED: "default",
};

const statusLabel: Record<string, string> = {
  ACTIVE: "学习中",
  MASTERED: "已掌握",
  ARCHIVED: "已归档",
};

// PRD FR-VOCAB-004 / SDD §11.8 科目过滤选项。"ALL" 表示不过滤。
const SUBJECT_OPTIONS = [
  { value: "ALL", label: "全部科目" },
  { value: "LISTENING", label: "听力" },
  { value: "READING", label: "阅读" },
  { value: "WRITING", label: "写作" },
  { value: "SPEAKING", label: "口语" },
  { value: "VOCABULARY", label: "词汇" },
];

export function VocabularyPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // AC-001: 业务日期由服务端按组织时区计算,优先使用后端 businessDate。
  const today = useBusinessDate();
  const thisWeekStart = getWeekStart(today);
  const [weekStart, setWeekStart] = useState(thisWeekStart);
  const [subject, setSubject] = useState<string>("ALL");
  const [batchOpen, setBatchOpen] = useState(false);
  const [rawText, setRawText] = useState("");
  const [preview, setPreview] = useState<PreviewEntry[] | null>(null);
  const [editing, setEditing] = useState<VocabularyEntry | null>(null);
  const [editStatus, setEditStatus] = useState<VocabularyEntryStatus>("ACTIVE");
  const [editNote, setEditNote] = useState("");

  const vocabQuery = useQuery({
    queryKey: ["vocabulary", studentId, weekStart, subject],
    queryFn: () =>
      listVocabulary(
        studentId as string,
        weekStart,
        getWeekEnd(weekStart),
        subject !== "ALL" ? subject : undefined,
      ),
    enabled: Boolean(studentId),
    retry: false,
  });

  const previewMutation = useMutation({
    mutationFn: (text: string) =>
      previewVocabularyBatch(studentId as string, text),
    onSuccess: (data) => {
      setPreview(data.entries);
    },
  });

  const saveMutation = useMutation({
    mutationFn: (input: { rawText: string; terms: string[] }) =>
      saveVocabularyBatch(studentId as string, input),
    onSuccess: async () => {
      setBatchOpen(false);
      setRawText("");
      setPreview(null);
      await queryClient.invalidateQueries({
        queryKey: ["vocabulary", studentId],
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: {
      entryId: string;
      status: VocabularyEntryStatus;
      note: string;
      expectedVersion: number;
    }) => updateVocabularyEntry(input.entryId, input),
    onSuccess: async () => {
      void message.success("已更新生词条目");
      setEditing(null);
      await queryClient.invalidateQueries({
        queryKey: ["vocabulary", studentId],
      });
    },
    onError: (error) => {
      const text =
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : error.message;
      void message.error(`更新失败：${text}`);
      // On 409 conflict the underlying query is refetched so the edit form reflects
      // the latest server snapshot; the user can re-open and re-apply.
    },
  });

  const handlePreview = () => {
    if (!rawText.trim()) return;
    previewMutation.mutate(rawText);
  };

  const handleSave = () => {
    const terms = (preview ?? []).map((e) => e.termOriginal);
    saveMutation.mutate({ rawText, terms });
  };

  const openEdit = (entry: VocabularyEntry) => {
    setEditing(entry);
    setEditStatus((entry.status as VocabularyEntryStatus) ?? "ACTIVE");
    setEditNote(entry.note ?? "");
  };

  const handleEditSubmit = () => {
    if (!editing) return;
    updateMutation.mutate({
      entryId: editing.id,
      status: editStatus,
      note: editNote,
      expectedVersion: editing.version,
    });
  };

  const shiftWeek = (weeks: number) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + weeks * 7);
    setWeekStart(date.toISOString().slice(0, 10));
  };

  const handleCopy = () => {
    const text = data.entries
      .map((e) => e.termNormalized)
      .filter((t) => t.length > 0)
      .join("\n");
    if (text.length === 0) {
      void message.warning("本周暂无可复制的规范词条");
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        void message.success(`已复制 ${data.entries.length} 个规范词条`);
      })
      .catch(() => {
        void message.error("复制失败，浏览器可能不支持剪贴板");
      });
  };

  const handleExport = () => {
    const rows = data.entries.map((e) => [
      e.termOriginal,
      e.termNormalized,
      e.status,
    ]);
    const csv = ["原始词条,规范词条,状态", ...rows.map(escapeCsvRow)].join(
      "\n",
    );
    const blob = new Blob([CSV_BOM + csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vocabulary_${studentId}_${weekStart}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (vocabQuery.isPending) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }

  if (vocabQuery.isError) {
    const error = vocabQuery.error;
    return (
      <Card>
        <Alert
          type="error"
          title="生词本暂不可用"
          showIcon
          description={
            error instanceof ApiError
              ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
              : "请确认 API 已启动并登录。"
          }
          action={
            <Button type="link" onClick={() => void vocabQuery.refetch()}>
              重试
            </Button>
          }
        />
      </Card>
    );
  }

  const data = vocabQuery.data;

  return (
    <Spin spinning={saveMutation.isPending}>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Space>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => void navigate(-1)}
          >
            返回
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>
            生词本
          </Typography.Title>
          <Typography.Text type="secondary">
            {weekStart} 本周 {data.total} 词
          </Typography.Text>
          <Button
            type="primary"
            icon={<ImportOutlined />}
            onClick={() => setBatchOpen(true)}
          >
            批量录入
          </Button>
        </Space>

        <Space>
          <Button icon={<LeftOutlined />} onClick={() => shiftWeek(-1)}>
            上一周
          </Button>
          <Typography.Text strong>{weekStart}</Typography.Text>
          <Button onClick={() => shiftWeek(1)}>
            下一周
            <RightOutlined />
          </Button>
          {weekStart !== thisWeekStart ? (
            <Button type="link" onClick={() => setWeekStart(thisWeekStart)}>
              回到本周
            </Button>
          ) : null}
          <Select
            value={subject}
            onChange={(v: string) => setSubject(v)}
            style={{ width: 140 }}
            options={SUBJECT_OPTIONS}
          />
          <Button
            icon={<CopyOutlined />}
            disabled={data.entries.length === 0}
            onClick={handleCopy}
          >
            复制规范词条
          </Button>
          <Button
            icon={<DownloadOutlined />}
            disabled={data.entries.length === 0}
            onClick={handleExport}
          >
            导出 CSV
          </Button>
        </Space>

        {data.entries.length === 0 ? (
          <Empty description="该周暂无生词" />
        ) : (
          <Table<VocabularyEntry>
            rowKey="id"
            dataSource={data.entries}
            pagination={{ pageSize: 50 }}
            size="small"
            columns={[
              {
                title: "词条",
                dataIndex: "termOriginal",
                key: "termOriginal",
              },
              {
                title: "规范词条",
                dataIndex: "termNormalized",
                key: "termNormalized",
              },
              {
                title: "状态",
                dataIndex: "status",
                key: "status",
                render: (status: string) => (
                  <Tag color={statusColor[status] ?? "default"}>
                    {statusLabel[status] ?? status}
                  </Tag>
                ),
              },
              {
                title: "备注",
                dataIndex: "note",
                key: "note",
                ellipsis: true,
                render: (note: string | null) =>
                  note && note.length > 0 ? note : <Typography.Text type="secondary">—</Typography.Text>,
              },
              {
                title: "录入时间",
                dataIndex: "createdAt",
                key: "createdAt",
                render: (v: string) => new Date(v).toLocaleDateString("zh-CN"),
              },
              {
                title: "操作",
                key: "actions",
                render: (_: unknown, record: VocabularyEntry) => (
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => openEdit(record)}
                  >
                    编辑
                  </Button>
                ),
              },
            ]}
          />
        )}

        <Modal
          title="批量录入生词"
          open={batchOpen}
          onCancel={() => {
            setBatchOpen(false);
            setPreview(null);
          }}
          width={600}
          footer={
            preview ? (
              <Space>
                <Button
                  onClick={() => {
                    setPreview(null);
                  }}
                >
                  返回编辑
                </Button>
                <Button
                  type="primary"
                  loading={saveMutation.isPending}
                  onClick={handleSave}
                >
                  保存批次
                </Button>
              </Space>
            ) : (
              <Space>
                <Button onClick={() => setBatchOpen(false)}>取消</Button>
                <Button
                  type="primary"
                  loading={previewMutation.isPending}
                  onClick={handlePreview}
                >
                  预览
                </Button>
              </Space>
            )
          }
        >
          {preview ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text strong>
                共 {preview.length} 个词条，其中{" "}
                {preview.filter((e) => e.isDuplicate).length} 个重复
              </Typography.Text>
              <Table<PreviewEntry>
                rowKey="termOriginal"
                dataSource={preview}
                pagination={false}
                size="small"
                scroll={{ y: 300 }}
                columns={[
                  {
                    title: "原始",
                    dataIndex: "termOriginal",
                    key: "termOriginal",
                  },
                  {
                    title: "规范",
                    dataIndex: "termNormalized",
                    key: "termNormalized",
                  },
                  {
                    title: "重复",
                    dataIndex: "isDuplicate",
                    key: "isDuplicate",
                    render: (v: boolean) =>
                      v ? <Tag color="orange">重复</Tag> : null,
                  },
                ]}
              />
            </Space>
          ) : (
            <TextArea
              rows={10}
              placeholder="每行一个生词，或用逗号分隔"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
            />
          )}
          {previewMutation.isError ? (
            <Alert
              type="error"
              title="预览失败"
              showIcon
              description={previewMutation.error.message}
              style={{ marginTop: 8 }}
            />
          ) : null}
        </Modal>

        <Modal
          title="编辑生词条目"
          open={editing !== null}
          onCancel={() => setEditing(null)}
          width={480}
          footer={
            <Space>
              <Button onClick={() => setEditing(null)}>取消</Button>
              <Button
                type="primary"
                loading={updateMutation.isPending}
                onClick={handleEditSubmit}
              >
                保存
              </Button>
            </Space>
          }
        >
          {editing ? (
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              <div>
                <Typography.Text type="secondary">词条</Typography.Text>
                <div>
                  <Typography.Text strong>{editing.termOriginal}</Typography.Text>
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  规范：{editing.termNormalized}
                </Typography.Text>
              </div>
              <div>
                <Typography.Text type="secondary">状态</Typography.Text>
                <Select
                  value={editStatus}
                  onChange={(v: VocabularyEntryStatus) => setEditStatus(v)}
                  style={{ width: "100%", marginTop: 4 }}
                  options={VOCABULARY_ENTRY_STATUSES.map((s) => ({
                    value: s,
                    label: statusLabel[s] ?? s,
                  }))}
                />
              </div>
              <div>
                <Typography.Text type="secondary">备注</Typography.Text>
                <TextArea
                  rows={4}
                  maxLength={1000}
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="可补充释义、例句或掌握情况"
                  style={{ marginTop: 4 }}
                />
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                版本 {editing.version}
              </Typography.Text>
            </Space>
          ) : null}
        </Modal>
      </Space>
    </Spin>
  );
}

function getWeekStart(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date.toISOString().slice(0, 10);
}

function getWeekEnd(weekStart: string): string {
  const date = new Date(weekStart);
  date.setDate(date.getDate() + 6);
  return date.toISOString().slice(0, 10);
}

const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

function escapeCsvRow(fields: string[]): string {
  return fields
    .map((field) => {
      const safe = sanitizeFormula(field);
      const escaped = safe.replace(/"/g, '""');
      return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
    })
    .join(",");
}

/**
 * CSV formula-injection guard (SDD §18.4). If a value starts with one of the
 * trigger characters = + - @ <TAB> <CR>, prefix a single quote so spreadsheet
 * applications interpret the cell as text. Mirrors the backend
 * ExportService.sanitizeFormula in apps/api.
 */
function sanitizeFormula(value: string): string {
  if (value.length === 0) return "";
  return CSV_FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

// UTF-8 BOM so Excel opens the exported CSV with correct encoding.
const CSV_BOM = "﻿";
