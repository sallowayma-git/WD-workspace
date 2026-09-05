import { Alert, App, Button, Empty, Skeleton, Space, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../../lib/api/ApiError";
import { useBusinessDate } from "../foundation/useBusinessDate";
import { AvailabilityDayRow } from "./AvailabilityDayRow";
import {
  getWeeklyPattern,
  saveWeeklyPattern,
  type WeeklyPattern,
  type WeeklyPatternDay,
} from "./availabilityApi";
import "./availability.css";

const DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function WeeklyPatternEditor({ studentId }: { studentId: string }) {
  const query = useQuery({
    queryKey: ["weekly-pattern", studentId],
    queryFn: () => getWeeklyPattern(studentId),
    retry: false,
  });

  if (query.isPending) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (query.isError) {
    // 404 表示该学生还没有常规周，是一条可以手动创建的空状态，而不是读取故障。
    if (query.error instanceof ApiError && query.error.status === 404) {
      return <CreateWeeklyPattern studentId={studentId} />;
    }
    return (
      <Alert
        type="error"
        showIcon
        title="常规周读取失败"
        description={query.error.message}
      />
    );
  }
  return (
    <WeeklyPatternForm
      key={query.data.updatedAt}
      studentId={studentId}
      pattern={query.data}
    />
  );
}

// WBS FR-PROFILE-003：新学生默认 7 天全部可学习、分钟为 0，由助教逐日
// 填写时长。创建入口复用同一默认草稿，避免替用户偷偷设置分钟数（AVL-005）。
function defaultPatternDraft(): WeeklyPatternDay[] {
  return Array.from({ length: 7 }, (_, index) => ({
    dayOfWeek: index + 1,
    available: true,
    availableMinutes: 0,
    devicePolicyOverride: null,
  }));
}

function allDaysPattern(minutes: number): WeeklyPatternDay[] {
  return Array.from({ length: 7 }, (_, index) => ({
    dayOfWeek: index + 1,
    available: true,
    availableMinutes: minutes,
    devicePolicyOverride: null,
  }));
}

/**
 * 创建常规周的预设模板："每天N分钟"全班可用；"间隔N天"按 学1天休N天
 * 循环；"工作日"周一到周五学习、周末休息。预设只负责填充草稿，逐日
 * 微调仍在下方天数行里完成。
 */
const PATTERN_PRESETS: Array<{
  key: string;
  label: string;
  build: () => WeeklyPatternDay[];
}> = [
  { key: "daily-60", label: "每天60分钟", build: () => allDaysPattern(60) },
  { key: "daily-90", label: "每天90分钟", build: () => allDaysPattern(90) },
  { key: "daily-120", label: "每天120分钟", build: () => allDaysPattern(120) },
  {
    key: "weekday",
    label: "工作日学习",
    build: () =>
      Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: index < 5,
        availableMinutes: index < 5 ? 120 : 0,
        devicePolicyOverride: null,
      })),
  },
  {
    key: "interval-1",
    label: "间隔1天（学一休一）",
    build: () =>
      Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: index % 2 === 0,
        availableMinutes: index % 2 === 0 ? 120 : 0,
        devicePolicyOverride: null,
      })),
  },
  {
    key: "interval-2",
    label: "间隔2天（学一休二）",
    build: () =>
      Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: index % 3 === 0,
        availableMinutes: index % 3 === 0 ? 120 : 0,
        devicePolicyOverride: null,
      })),
  },
];

function CreateWeeklyPattern({ studentId }: { studentId: string }) {
  const businessDate = useBusinessDate();
  const [days, setDays] = useState<WeeklyPatternDay[] | null>(null);
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const mutation = useMutation({
    mutationFn: () =>
      saveWeeklyPattern(studentId, {
        effectiveFrom: businessDate,
        days: days ?? [],
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["weekly-pattern", studentId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["schedule", studentId],
      });
      void message.success("常规周已创建");
    },
    onError: (error) =>
      void message.error(
        error instanceof ApiError ? error.message : "常规周创建失败",
      ),
  });

  // 第一阶段：只有创建入口，不铺开 7 行编辑界面，保持资料页安静。
  if (!days) {
    return (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未创建常规周">
        <Button type="primary" onClick={() => setDays(defaultPatternDraft())}>
          创建常规周
        </Button>
      </Empty>
    );
  }

  const updateDay = (index: number, next: WeeklyPatternDay) => {
    setDays((current) =>
      (current ?? []).map((day, dayIndex) => (dayIndex === index ? next : day)),
    );
  };

  // 可学习日时长为 0 的常规周排不出任何任务，保存前先按行内提示补齐。
  const missingMinutes = days.some(
    (day) => day.available && day.availableMinutes <= 0,
  );

  return (
    <div className="availability-editor">
      <Space wrap align="center" style={{ marginBottom: 4 }}>
        <Typography.Text type="secondary">预设模板：</Typography.Text>
        {PATTERN_PRESETS.map((preset) => (
          <Button
            key={preset.key}
            size="small"
            onClick={() => setDays(preset.build())}
          >
            {preset.label}
          </Button>
        ))}
      </Space>
      {days.map((day, index) => (
        <AvailabilityDayRow
          key={day.dayOfWeek}
          label={DAY_NAMES[day.dayOfWeek - 1]}
          value={day}
          onChange={(next) => updateDay(index, next as WeeklyPatternDay)}
        />
      ))}
      <div className="availability-editor-actions">
        <Typography.Text type="secondary">
          保存后即成为该学生的常规周；日期覆盖优先于此设置。
        </Typography.Text>
        <Space>
          <Button onClick={() => setDays(null)}>取消</Button>
          <Button
            type="primary"
            loading={mutation.isPending}
            disabled={missingMinutes}
            onClick={() => mutation.mutate()}
          >
            保存常规周
          </Button>
        </Space>
      </div>
    </div>
  );
}

function WeeklyPatternForm({
  studentId,
  pattern,
}: {
  studentId: string;
  pattern: WeeklyPattern;
}) {
  const businessDate = useBusinessDate();
  const [days, setDays] = useState(() => [...pattern.days]);
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const mutation = useMutation({
    mutationFn: () =>
      saveWeeklyPattern(studentId, {
        effectiveFrom: businessDate,
        days,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["weekly-pattern", studentId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["schedule", studentId],
      });
      void message.success("常规周已保存");
    },
    onError: (error) =>
      void message.error(
        error instanceof ApiError ? error.message : "常规周保存失败",
      ),
  });

  const updateDay = (index: number, next: WeeklyPatternDay) => {
    setDays((current) =>
      current.map((day, dayIndex) => (dayIndex === index ? next : day)),
    );
  };

  return (
    <div className="availability-editor">
      {days.map((day, index) => (
        <AvailabilityDayRow
          key={day.dayOfWeek}
          label={DAY_NAMES[day.dayOfWeek - 1]}
          value={day}
          onChange={(next) => updateDay(index, next as WeeklyPatternDay)}
        />
      ))}
      <div className="availability-editor-actions">
        <Typography.Text type="secondary">
          日期覆盖优先于此常规周设置。
        </Typography.Text>
        <Button
          type="primary"
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          保存常规周
        </Button>
      </div>
    </div>
  );
}
