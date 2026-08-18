import { ExclamationCircleOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Input,
  Modal,
  Space,
  Statistic,
  Tag,
  Typography,
  message,
} from "antd";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ApiError } from "../../lib/api/http";
import { useBusinessDate } from "../foundation/useBusinessDate";
import { triggerDayClose, type DayCloseRunSummary } from "./dayCloseApi";

// AC-006 / SDD §9.7: manual day-close trigger for administrators.
// @PreAuthorize on the backend restricts POST /api/v1/admin/day-close to the
// ADMIN role; a 403 surfaces here as a forbidden Alert.
export function DayClosePage() {
  const businessDate = useBusinessDate();
  const [selectedDate, setSelectedDate] = useState<string>(businessDate);
  const [summary, setSummary] = useState<DayCloseRunSummary | null>(null);

  const runMutation = useMutation({
    mutationFn: (date: string) => triggerDayClose(date),
    onSuccess: (data) => {
      setSummary(data);
      void message.success("日结已执行");
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 403) {
        setSummary(null);
        return;
      }
      void message.error(
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : "日结执行失败，请稍后重试",
      );
    },
  });

  const handleRun = () => {
    void runMutation.mutateAsync(selectedDate);
  };

  const confirmAndRun = () => {
    void Modal.confirm({
      title: "执行日结",
      icon: <ExclamationCircleOutlined />,
      content: `将对业务日期 ${selectedDate} 执行日结顺延扫描，确认继续吗？`,
      okText: "执行日结",
      okType: "primary",
      cancelText: "取消",
      onOk: () => handleRun(),
    });
  };

  const isForbidden =
    runMutation.isError &&
    runMutation.error instanceof ApiError &&
    runMutation.error.status === 403;

  return (
    <Card title="日结管理">
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Paragraph type="secondary">
          手动触发当日日结，将扫描调度日期不晚于业务日期的 PENDING 任务并按规则顺延至下一可用日。正常情况下由定时任务自动执行，此处仅供管理员手动补跑或重跑。
        </Typography.Paragraph>

        <Space direction="horizontal" size="middle" align="center" wrap>
          <Input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            style={{ width: 180 }}
            aria-label="业务日期"
          />
          <Button
            type="primary"
            loading={runMutation.isPending}
            onClick={confirmAndRun}
          >
            执行日结
          </Button>
        </Space>

        {isForbidden ? (
          <Alert
            type="error"
            showIcon
            message="无访问权限"
            description="仅管理员（ADMIN）可手动触发日结。"
          />
        ) : null}

        {runMutation.isError && !isForbidden ? (
          <Alert
            type="error"
            showIcon
            message="日结执行失败"
            description={
              runMutation.error instanceof ApiError
                ? `${runMutation.error.message}${runMutation.error.requestId ? `（requestId: ${runMutation.error.requestId}）` : ""}`
                : "请稍后重试。"
            }
          />
        ) : null}

        {summary ? <RunSummaryView summary={summary} /> : null}
      </Space>
    </Card>
  );
}

function RunSummaryView({ summary }: { summary: DayCloseRunSummary }) {
  const statusColor = statusTagColor(summary.status);
  return (
    <Card type="inner" title="运行摘要">
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Descriptions
          size="small"
          column={1}
          bordered
          items={[
            {
              key: "runId",
              label: "运行 ID",
              children: (
                <Typography.Text copyable style={{ fontSize: 12 }}>
                  {summary.runId}
                </Typography.Text>
              ),
            },
            {
              key: "status",
              label: "状态",
              children: <Tag color={statusColor}>{summary.status}</Tag>,
            },
            {
              key: "businessDate",
              label: "业务日期",
              children: summary.businessDate,
            },
            {
              key: "startedAt",
              label: "开始时间",
              children: formatInstant(summary.startedAt),
            },
            {
              key: "finishedAt",
              label: "结束时间",
              children: summary.finishedAt
                ? formatInstant(summary.finishedAt)
                : "—",
            },
          ]}
        />

        <Space size="large" wrap>
          <Statistic title="扫描" value={summary.scanned} />
          <Statistic title="顺延" value={summary.carried} />
          <Statistic title="阻断" value={summary.blocked} />
          <Statistic title="跳过" value={summary.skipped} />
          <Statistic
            title="失败"
            value={summary.failed}
            valueStyle={summary.failed > 0 ? { color: "#cf1322" } : undefined}
          />
        </Space>

        {summary.errorSummary ? (
          <Alert
            type={summary.failed > 0 ? "warning" : "info"}
            showIcon
            message="错误摘要"
            description={summary.errorSummary}
          />
        ) : null}
      </Space>
    </Card>
  );
}

function statusTagColor(status: string): string {
  switch (status) {
    case "SUCCEEDED":
      return "green";
    case "PARTIAL":
      return "orange";
    case "FAILED":
      return "red";
    case "RUNNING":
      return "blue";
    default:
      return "default";
  }
}

function formatInstant(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}
