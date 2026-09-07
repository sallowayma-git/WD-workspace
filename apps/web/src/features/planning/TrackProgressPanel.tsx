import { Button, Progress, Space, Tag, Typography } from "antd";
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

export function TrackProgressPanel({
  tracks,
  onResumeSequenceTrack,
}: {
  tracks: Track[];
  onResumeSequenceTrack?: (track: Track) => void;
}) {
  if (tracks.length === 0) {
    return <Typography.Text type="secondary">暂无活跃轨道</Typography.Text>;
  }

  return (
    <Space orientation="vertical" size="small" style={{ width: "100%" }}>
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
        return (
          <Space
            key={track.id}
            orientation="vertical"
            size={0}
            style={{ width: "100%" }}
          >
            <Space wrap>
              <Tag color={statusColor[track.status]}>
                {statusLabel[track.status]}
              </Tag>
              <Typography.Text strong>
                {sequence ? (track.definitionName ?? label) : label}
              </Typography.Text>
              {sequence ? (
                <Typography.Text type="secondary">{label}</Typography.Text>
              ) : null}
              {track.warnings.length > 0 ? (
                <Typography.Text type="warning">
                  {track.warnings.join("；")}
                </Typography.Text>
              ) : null}
              {sequence &&
              track.warnings.includes("没有待完成任务，下一项未排期") &&
              onResumeSequenceTrack ? (
                <Button
                  size="small"
                  onClick={() => onResumeSequenceTrack(track)}
                >
                  重新接排
                </Button>
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
