import { Input, InputNumber, Select, Space, Switch, Typography } from "antd";
import { useRef } from "react";
import type {
  DayAvailability,
  DevicePolicyOverride,
  WeeklyPatternDay,
} from "./availabilityApi";

const DEVICE_OPTIONS = [
  { value: "INHERIT", label: "沿用学生默认" },
  { value: "ALLOWED", label: "允许设备" },
  { value: "NOT_ALLOWED", label: "不允许设备" },
  { value: "CONFIRM", label: "需确认" },
];

interface AvailabilityDayRowProps {
  label: string;
  value: WeeklyPatternDay | DayAvailability;
  showNote?: boolean;
  onChange: (next: WeeklyPatternDay | DayAvailability) => void;
}

export function AvailabilityDayRow({
  label,
  value,
  showNote = false,
  onChange,
}: AvailabilityDayRowProps) {
  const lastPositiveMinutes = useRef(
    value.availableMinutes > 0 ? value.availableMinutes : 0,
  );
  const update = (patch: Partial<WeeklyPatternDay | DayAvailability>) =>
    onChange({ ...value, ...patch });

  const toggleAvailability = (available: boolean) => {
    if (!available) {
      if (value.availableMinutes > 0) {
        lastPositiveMinutes.current = value.availableMinutes;
      }
      update({ available: false, availableMinutes: 0 });
      return;
    }
    update({
      available: true,
      availableMinutes:
        value.availableMinutes > 0
          ? value.availableMinutes
          : lastPositiveMinutes.current,
    });
  };

  return (
    <div
      className={`availability-row${showNote ? "" : " availability-row-weekly"}`}
    >
      <Typography.Text strong>{label}</Typography.Text>
      <Space size="small">
        <Switch
          checked={value.available}
          aria-label={`${label}可学习`}
          onChange={toggleAvailability}
        />
        <Typography.Text type="secondary">
          {value.available ? "可学习" : "休息"}
        </Typography.Text>
      </Space>
      <InputNumber
        min={0}
        max={1440}
        step={15}
        addonAfter="分钟"
        value={value.availableMinutes}
        disabled={!value.available}
        aria-label={`${label}可用分钟`}
        style={{ width: "100%" }}
        onChange={(minutes) => update({ availableMinutes: minutes ?? 0 })}
      />
      <Select
        value={value.devicePolicyOverride ?? "INHERIT"}
        options={DEVICE_OPTIONS}
        aria-label={`${label}设备策略`}
        onChange={(policy) =>
          update({
            devicePolicyOverride:
              policy === "INHERIT" ? null : (policy as DevicePolicyOverride),
          })
        }
      />
      {showNote && "note" in value ? (
        <Input
          value={value.note ?? ""}
          maxLength={500}
          placeholder="当天备注"
          aria-label={`${label}备注`}
          onChange={(event) => update({ note: event.target.value || null })}
        />
      ) : null}
      {value.available && value.availableMinutes <= 0 ? (
        <Typography.Text type="danger">请填写可用分钟</Typography.Text>
      ) : null}
    </div>
  );
}
