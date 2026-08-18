import {
  getTemplateItemUsage,
  getTemplateUsage,
  type TemplateItemUsage,
  type TemplateUsage,
} from "./templateApi";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Drawer,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { TableProps } from "antd";
import { useMemo, useState } from "react";

/**
 * Usage Drawer (SDD §15.9 / PRD AC-012). Opens when a TEMPLATE or TEMPLATE_ITEM result is clicked
 * in GlobalSearchDialog. For templates it lists mounted students with current/end ordinal, track
 * status and next candidate date; for items it lists per-student task status + scheduled date.
 */
export type UsageTarget =
  | { kind: "TEMPLATE"; id: string; title?: string }
  | { kind: "TEMPLATE_ITEM"; id: string; title?: string };

const trackStatusColors: Record<string, string> = {
  NOT_STARTED: "default",
  ACTIVE: "processing",
  PAUSED: "warning",
  COMPLETED: "success",
  CANCELLED: "error",
};

const taskStatusColors: Record<string, string> = {
  PENDING: "blue",
  COMPLETED: "green",
  CARRIED_OVER: "orange",
  CANCELLED: "default",
  SKIPPED: "default",
};

const trackStatusLabels: Record<string, string> = {
  NOT_STARTED: "未开始",
  ACTIVE: "进行中",
  PAUSED: "已暂停",
  COMPLETED: "已完成",
  CANCELLED: "已终止",
};

const taskStatusLabels: Record<string, string> = {
  PENDING: "待完成",
  COMPLETED: "已完成",
  CARRIED_OVER: "已顺延",
  CANCELLED: "已取消",
  SKIPPED: "已跳过",
};

/**
 * AC-012 grouping buckets for template-item usage rows. Each row is classified
 * into one of three reverse-query groups:
 *  - COMPLETED: task status is COMPLETED
 *  - SCHEDULED: PENDING and has a scheduledDate (安排待执行)
 *  - PENDING:   PENDING and not yet scheduled
 * Rows that don't match (CANCELLED/SKIPPED/CARRIED_OVER) fall into OTHER so they
 * remain visible without being forced into an AC bucket.
 */
type ItemUsageBucket = "COMPLETED" | "SCHEDULED" | "PENDING" | "OTHER";

const bucketLabels: Record<ItemUsageBucket, string> = {
  COMPLETED: "已完成",
  SCHEDULED: "已安排",
  PENDING: "待完成",
  OTHER: "其他",
};

const bucketColors: Record<ItemUsageBucket, string> = {
  COMPLETED: "green",
  SCHEDULED: "blue",
  PENDING: "gold",
  OTHER: "default",
};

function classifyItemUsage(row: TemplateItemUsage): ItemUsageBucket {
  if (row.status === "COMPLETED") return "COMPLETED";
  if (row.status === "PENDING") {
    return row.scheduledDate ? "SCHEDULED" : "PENDING";
  }
  return "OTHER";
}

const ALL_BUCKETS: ItemUsageBucket[] = [
  "COMPLETED",
  "SCHEDULED",
  "PENDING",
  "OTHER",
];

export function TaskUsageDrawer({
  target,
  onClose,
}: {
  target: UsageTarget | null;
  onClose: () => void;
}) {
  const open = target !== null;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        target
          ? target.kind === "TEMPLATE"
            ? `任务使用情况${target.title ? ` · ${target.title}` : ""}`
            : `单元使用情况${target.title ? ` · ${target.title}` : ""}`
          : ""
      }
      width={680}
      destroyOnClose
    >
      {target ? <UsageBody target={target} /> : null}
    </Drawer>
  );
}

function UsageBody({ target }: { target: UsageTarget }) {
  if (target.kind === "TEMPLATE") {
    return <TemplateUsageBody templateId={target.id} />;
  }
  return <TemplateItemUsageBody itemId={target.id} />;
}

function TemplateUsageBody({ templateId }: { templateId: string }) {
  const query = useQuery({
    queryKey: ["template-usage", templateId],
    queryFn: () => getTemplateUsage(templateId),
    enabled: !!templateId,
    retry: false,
  });

  if (query.isPending) {
    return (
      <div style={{ textAlign: "center", padding: 32 }}>
        <Spin />
      </div>
    );
  }
  if (query.error) {
    return (
      <Alert
        type="error"
        showIcon
        message="加载使用情况失败"
        description={
          query.error instanceof Error ? query.error.message : "请稍后重试"
        }
      />
    );
  }
  const rows = query.data ?? [];
  if (rows.length === 0) {
    return <EmptyState text="暂无学生挂载该任务模板" />;
  }
  const columns: TableProps<TemplateUsage>["columns"] = [
    {
      title: "学生",
      dataIndex: "name",
      key: "name",
      render: (_value, row) => (
        <span>
          {row.name}
          <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
            {row.studentCode}
          </Typography.Text>
        </span>
      ),
    },
    {
      title: "进度",
      key: "progress",
      width: 110,
      render: (_value, row) => `${row.currentOrdinal} / ${row.endOrdinal}`,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 110,
      render: (status: string) => (
        <Tag color={trackStatusColors[status] ?? "default"}>
          {trackStatusLabels[status] ?? status}
        </Tag>
      ),
    },
    {
      title: "下一安排日期",
      dataIndex: "nextCandidateDate",
      key: "nextCandidateDate",
      width: 140,
      render: (value: string | null) =>
        value ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
  ];
  return (
    <Table<TemplateUsage>
      rowKey="trackId"
      columns={columns}
      dataSource={rows}
      pagination={false}
      size="small"
    />
  );
}

function TemplateItemUsageBody({ itemId }: { itemId: string }) {
  const query = useQuery({
    queryKey: ["template-item-usage", itemId],
    queryFn: () => getTemplateItemUsage(itemId),
    enabled: !!itemId,
    retry: false,
  });

  if (query.isPending) {
    return (
      <div style={{ textAlign: "center", padding: 32 }}>
        <Spin />
      </div>
    );
  }
  if (query.error) {
    return (
      <Alert
        type="error"
        showIcon
        message="加载使用情况失败"
        description={
          query.error instanceof Error ? query.error.message : "请稍后重试"
        }
      />
    );
  }
  const rows = query.data ?? [];
  if (rows.length === 0) {
    return <EmptyState text="暂无学生安排该单元" />;
  }
  const columns: TableProps<TemplateItemUsage>["columns"] = [
    {
      title: "学生",
      dataIndex: "name",
      key: "name",
      render: (_value, row) => (
        <span>
          {row.name}
          <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
            {row.studentCode}
          </Typography.Text>
        </span>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 110,
      render: (status: string) => (
        <Tag color={taskStatusColors[status] ?? "default"}>
          {taskStatusLabels[status] ?? status}
        </Tag>
      ),
    },
    {
      title: "安排日期",
      dataIndex: "scheduledDate",
      key: "scheduledDate",
      width: 140,
      render: (value: string | null) =>
        value ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
  ];
  return <ItemUsageGroupedTable rows={rows} columns={columns} />;
}

/**
 * AC-012 reverse-query view: bucket item-usage rows into 已完成 / 已安排 / 待完成
 * groups rendered as Tabs with per-bucket counts, and a "全部" tab to view every row.
 * The underlying table columns are provided by the caller so this component stays
 * presentation-only.
 */
function ItemUsageGroupedTable({
  rows,
  columns,
}: {
  rows: TemplateItemUsage[];
  columns: NonNullable<TableProps<TemplateItemUsage>["columns"]>;
}) {
  const [activeBucket, setActiveBucket] =
    useState<ItemUsageBucket | "ALL">("ALL");

  const counts = useMemo(() => {
    const init: Record<ItemUsageBucket, number> = {
      COMPLETED: 0,
      SCHEDULED: 0,
      PENDING: 0,
      OTHER: 0,
    };
    for (const row of rows) {
      init[classifyItemUsage(row)] += 1;
    }
    return init;
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (activeBucket === "ALL") return rows;
    return rows.filter((row) => classifyItemUsage(row) === activeBucket);
  }, [rows, activeBucket]);

  const tabItems = [
    {
      key: "ALL" as const,
      label: (
        <span>
          全部
          <Badge
            count={rows.length}
            color="#8c8c8c"
            style={{ marginLeft: 6 }}
            overflowCount={9999}
          />
        </span>
      ),
    },
    ...ALL_BUCKETS.filter((bucket) => counts[bucket] > 0).map((bucket) => ({
      key: bucket,
      label: (
        <span>
          {bucketLabels[bucket]}
          <Badge
            count={counts[bucket]}
            color={bucketColors[bucket]}
            style={{ marginLeft: 6 }}
            overflowCount={9999}
          />
        </span>
      ),
    })),
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Tabs
        activeKey={activeBucket}
        onChange={(key) =>
          setActiveBucket(key as ItemUsageBucket | "ALL")
        }
        items={tabItems}
        size="small"
      />
      <Table<TemplateItemUsage>
        rowKey="taskId"
        columns={columns}
        dataSource={visibleRows}
        pagination={false}
        size="small"
      />
    </Space>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ textAlign: "center", padding: "32px 0", color: "#8c8c8c" }}>
      {text}
    </div>
  );
}
