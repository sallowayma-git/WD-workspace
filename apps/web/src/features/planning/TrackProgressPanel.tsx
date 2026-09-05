import { Progress, Space, Tag, Tooltip, Typography } from "antd";
import type { Track } from "./trackApi";

const statusColor: Record<string, string> = {
  NOT_STARTED: "default",
  ACTIVE: "blue",
  PAUSED: "orange",
  COMPLETED: "green",
  CANCELLED: "default",
};

const statusLabel: Record<string, string> = {
  NOT_STARTED: "未开始",
  ACTIVE: "进行中",
  PAUSED: "已暂停",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

export function TrackProgressPanel({ tracks }: { tracks: Track[] }) {
  if (tracks.length === 0) {
    return <Typography.Text type="secondary">暂无活跃轨道</Typography.Text>;
  }

  return (
    <Space direction="vertical" size="small" style={{ width: "100%" }}>
      {tracks.map((track) => {
        const progress = track.progress;
        const sequence = track.generationMode === "SEQUENCE";
        // 开放型长期任务没有总数/百分比：只报“当前第 N 项 · 已完成 M 次”。
        const percent = progress ? progress.percent : null;
        const label = sequence
          ? `当前第 ${track.currentOrdinal} 项 · 已完成 ${
              progress
                ? progress.completedUnits
                : Math.max(0, track.currentOrdinal - track.startOrdinal)
            } 次`
          : progress
            ? `${progress.currentOrdinal}/${progress.endOrdinal}`
            : `${track.currentOrdinal}/${track.endOrdinal}`;
        // AC-LT-014：普通用户不暴露模板版本 UUID；版本绑定是 ITEMIZED 轨道的
        // 内部事实，SEQUENCE 轨道显示自己的身份标签。
        const versionShortId = track.templateVersionId?.slice(0, 8);
        // AC-005: surface out-of-order progression as a distinct red Tag rather
        // than only as warning text, so the visual signal matches the severity.
        const outOfOrderWarning = track.warnings.find((w) =>
          w.includes("顺序异常"),
        );
        const otherWarnings = track.warnings.filter(
          (w) => !w.includes("顺序异常"),
        );
        return (
          <Space
            key={track.id}
            direction="vertical"
            size={0}
            style={{ width: "100%" }}
          >
            <Space>
              <Tag color={statusColor[track.status]}>
                {statusLabel[track.status]}
              </Tag>
              <Typography.Text strong>
                {sequence ? (track.definitionName ?? label) : label}
              </Typography.Text>
              {sequence ? (
                <Typography.Text type="secondary">{label}</Typography.Text>
              ) : null}
              {versionShortId ? (
                <Tooltip
                  title={`轨道已绑定模板版本，不会自动迁移到新版本。templateVersionId=${track.templateVersionId}`}
                >
                  <Tag color="purple" bordered={false}>
                    绑定版本 v{versionShortId}
                  </Tag>
                </Tooltip>
              ) : null}
              {outOfOrderWarning ? (
                <Tag color="red">{outOfOrderWarning}</Tag>
              ) : null}
              {otherWarnings.length > 0 ? (
                <Typography.Text type="warning">
                  {otherWarnings.join("；")}
                </Typography.Text>
              ) : null}
            </Space>
            {percent != null ? (
              <Progress percent={percent} size="small" />
            ) : null}
          </Space>
        );
      })}
    </Space>
  );
}
