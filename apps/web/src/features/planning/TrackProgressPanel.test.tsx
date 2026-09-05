import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Track } from "./trackApi";
import { TrackProgressPanel } from "./TrackProgressPanel";

const track: Track = {
  id: "40000000-0000-4000-8000-000000000001",
  studentId: "10000000-0000-4000-8000-000000000001",
  templateId: "50000000-0000-4000-8000-000000000001",
  templateVersionId: "60000000-0000-4000-8000-000000000001",
  generationMode: "ITEMIZED",
  definitionName: null,
  titlePatternSnapshot: null,
  status: "ACTIVE",
  startOrdinal: 1,
  currentOrdinal: 8,
  endOrdinal: 20,
  defaultUnitsPerSession: 1,
  startDate: "2026-08-01",
  nextCandidateDate: "2026-08-21",
  priority: 0,
  allowParallelItems: false,
  schedulingPolicy: "SEQUENTIAL",
  durationOverrideMinutes: null,
  devicePolicyOverride: null,
  note: null,
  completedAt: null,
  version: 3,
  updatedAt: "2026-08-20T00:00:00Z",
  progress: {
    currentOrdinal: 8,
    endOrdinal: 20,
    completedUnits: 7,
    totalUnits: 20,
    percent: 35,
  },
  warnings: [],
};

const sequenceTrack: Track = {
  ...track,
  templateVersionId: null,
  generationMode: "SEQUENCE",
  definitionName: "一天一句长难句 Day",
  titlePatternSnapshot: "一天一句长难句 Day {n}",
  endOrdinal: null,
  progress: {
    currentOrdinal: 8,
    endOrdinal: null,
    completedUnits: 7,
    totalUnits: null,
    percent: null,
  },
};

describe("TrackProgressPanel", () => {
  it("shows the track's current ordinal against its end ordinal", () => {
    render(<TrackProgressPanel tracks={[track]} />);

    // ACC-022: the assistant must be able to see where the track currently
    // points without opening the database.
    expect(screen.getByText("8/20")).toBeVisible();
    expect(screen.getByText("进行中")).toBeVisible();
  });

  it("falls back to the track columns when no progress projection is present", () => {
    render(<TrackProgressPanel tracks={[{ ...track, progress: null }]} />);
    expect(screen.getByText("8/20")).toBeVisible();
  });

  it("says so plainly when a student has no active track", () => {
    render(<TrackProgressPanel tracks={[]} />);
    expect(screen.getByText("暂无活跃轨道")).toBeVisible();
  });

  it("renders an open-ended sequence track by definition name and progress count", () => {
    render(<TrackProgressPanel tracks={[sequenceTrack]} />);

    // 开放型长期任务：显示定义名与“当前第 N 项 · 已完成 M 次”，不显示
    // 百分比，也不暴露模板版本 UUID（AC-LT-014）。
    expect(screen.getByText("一天一句长难句 Day")).toBeVisible();
    expect(screen.getByText("当前第 8 项 · 已完成 7 次")).toBeVisible();
    expect(screen.queryByText("8/20")).not.toBeInTheDocument();
    expect(screen.queryByText(/绑定版本/)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
