import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Empty,
  Popconfirm,
  Skeleton,
  Space,
  Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../../lib/api/ApiError";
import { useBusinessDate } from "../foundation/useBusinessDate";
import { AvailabilityDayRow } from "./AvailabilityDayRow";
import {
  getWeekPlan,
  saveWeekPlan,
  type DayAvailability,
  type WeekPlan,
} from "./availabilityApi";

// Calendar math below must stay on plain local-getter year/month/day
// arithmetic: round-tripping a local date through toISOString() re-encodes it
// as UTC, which shifts zones ahead of UTC (e.g. UTC+8) back to the previous
// calendar day and silently corrupts "YYYY-MM-DD" week keys.
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseLocalDate(dateValue: string): Date {
  const match = ISO_DATE_PATTERN.exec(dateValue);
  if (!match) throw new ApiError(422, "日期格式无效", "INVALID_DATE");
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatLocalDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Monday of the ISO week containing `dateValue`. */
function mondayOf(dateValue: string): string {
  const date = parseLocalDate(dateValue);
  const weekday = date.getDay();
  date.setDate(date.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  return formatLocalDate(date);
}

function shiftWeek(weekStart: string, amount: number): string {
  const date = parseLocalDate(weekStart);
  date.setDate(date.getDate() + amount * 7);
  return formatLocalDate(date);
}

// Pure date helpers with no React state, shared with StudentProfilePage and
// the unit tests so the week-plan query key has a single source of truth.
// eslint-disable-next-line react-refresh/only-export-components
export { mondayOf, shiftWeek };

export function WeekPlanEditor({ studentId }: { studentId: string }) {
  const businessDate = useBusinessDate();
  const [weekStart, setWeekStart] = useState(() => mondayOf(businessDate));
  const query = useQuery({
    queryKey: ["week-plan", studentId, weekStart],
    queryFn: () => getWeekPlan(studentId, weekStart),
    retry: false,
  });

  return (
    <div className="availability-editor">
      <Space wrap>
        <Button
          aria-label="上一周"
          icon={<LeftOutlined />}
          onClick={() => setWeekStart((value) => shiftWeek(value, -1))}
        />
        <Typography.Text strong>{weekStart} 起</Typography.Text>
        <Button
          aria-label="下一周"
          icon={<RightOutlined />}
          onClick={() => setWeekStart((value) => shiftWeek(value, 1))}
        />
        {weekStart !== mondayOf(businessDate) ? (
          <Button onClick={() => setWeekStart(mondayOf(businessDate))}>
            回到本周
          </Button>
        ) : null}
      </Space>
      {query.isPending ? <Skeleton active paragraph={{ rows: 4 }} /> : null}
      {query.isError &&
      query.error instanceof ApiError &&
      query.error.status === 404 ? (
        <CreateWeekPlan studentId={studentId} weekStart={weekStart} />
      ) : null}
      {query.isError &&
      !(query.error instanceof ApiError && query.error.status === 404) ? (
        <Alert
          type="error"
          showIcon
          title="日期覆盖读取失败"
          description={query.error.message}
        />
      ) : null}
      {query.data ? (
        <WeekPlanForm
          key={query.data.updatedAt}
          studentId={studentId}
          plan={query.data}
        />
      ) : null}
    </div>
  );
}

function CreateWeekPlan({
  studentId,
  weekStart,
}: {
  studentId: string;
  weekStart: string;
}) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const mutation = useMutation({
    mutationFn: (sourceType: "BASE_PATTERN" | "PREVIOUS_WEEK") =>
      saveWeekPlan(studentId, weekStart, {
        sourceType,
        replaceDraft: false,
      }),
    onSuccess: async (_data, sourceType) => {
      await queryClient.invalidateQueries({
        queryKey: ["week-plan", studentId, weekStart],
      });
      void message.success(
        sourceType === "PREVIOUS_WEEK"
          ? "已复制上周计划"
          : "已从常规周生成本周计划",
      );
    },
    onError: (error) =>
      void message.error(
        error instanceof ApiError ? error.message : "本周计划生成失败",
      ),
  });

  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="本周还没有日期覆盖"
    >
      <Space>
        <Button
          type="primary"
          loading={mutation.isPending && mutation.variables === "BASE_PATTERN"}
          onClick={() => mutation.mutate("BASE_PATTERN")}
        >
          从常规周生成
        </Button>
        <Button
          loading={mutation.isPending && mutation.variables === "PREVIOUS_WEEK"}
          onClick={() => mutation.mutate("PREVIOUS_WEEK")}
        >
          复制上周
        </Button>
      </Space>
    </Empty>
  );
}

function WeekPlanForm({
  studentId,
  plan,
}: {
  studentId: string;
  plan: WeekPlan;
}) {
  const [days, setDays] = useState(() => [...plan.days]);
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const mutation = useMutation({
    mutationFn: () =>
      saveWeekPlan(studentId, plan.weekStartDate, {
        sourceType: "MANUAL",
        replaceDraft: true,
        days: days.map(
          ({
            businessDate,
            available,
            availableMinutes,
            devicePolicyOverride,
            note,
          }) => ({
            businessDate,
            available,
            availableMinutes,
            devicePolicyOverride,
            note,
          }),
        ),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["week-plan", studentId, plan.weekStartDate],
      });
      await queryClient.invalidateQueries({
        queryKey: ["schedule", studentId],
      });
      void message.success("日期覆盖已保存");
    },
    onError: (error) =>
      void message.error(
        error instanceof ApiError ? error.message : "日期覆盖保存失败",
      ),
  });

  const updateDay = (index: number, next: DayAvailability) => {
    setDays((current) =>
      current.map((day, dayIndex) => (dayIndex === index ? next : day)),
    );
  };

  // AVL-011: an existing plan must still be re-derivable from last week — the
  // same PREVIOUS_WEEK channel the empty state uses, guarded by a confirm
  // because it overwrites every unsaved edit in this editor.
  const resetMutation = useMutation({
    mutationFn: () =>
      saveWeekPlan(studentId, plan.weekStartDate, {
        sourceType: "PREVIOUS_WEEK",
        replaceDraft: false,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["week-plan", studentId, plan.weekStartDate],
      });
      await queryClient.invalidateQueries({
        queryKey: ["schedule", studentId],
      });
      void message.success("已重置为上周计划");
    },
    onError: (error) =>
      void message.error(
        error instanceof ApiError ? error.message : "重置为上周计划失败",
      ),
  });

  return (
    <>
      {days.map((day, index) => (
        <AvailabilityDayRow
          key={day.businessDate}
          label={day.businessDate}
          value={day}
          showNote
          onChange={(next) => updateDay(index, next as DayAvailability)}
        />
      ))}
      <div className="availability-editor-actions">
        <Typography.Text type="secondary">
          保存后，这 7 天会优先于常规周参与顺延计算。
        </Typography.Text>
        <Space>
          <Popconfirm
            title="重置为上周计划？"
            description="将用上一周的计划覆盖本周 7 天，未保存的修改会丢失。"
            okText="重置"
            cancelText="取消"
            onConfirm={() => resetMutation.mutate()}
          >
            <Button loading={resetMutation.isPending}>重置为上周</Button>
          </Popconfirm>
          <Button
            type="primary"
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            保存日期覆盖
          </Button>
        </Space>
      </div>
    </>
  );
}
