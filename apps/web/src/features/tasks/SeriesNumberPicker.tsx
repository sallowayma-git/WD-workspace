import { Modal, Tag, Typography } from "antd";
import { useState } from "react";
import type { SeriesNumberCandidate } from "../../domain/task/seriesTitle";

export interface SeriesNumberPickerProps {
  open: boolean;
  title: string;
  candidates: readonly SeriesNumberCandidate[];
  onCancel: () => void;
  onConfirm: (numberIndex: number) => void;
}

/**
 * Chooses which numeric fragment in a title is the series counter.
 *
 * A title such as “2025真题1+生词” has two plausible counters.  Keeping the
 * chooser independent from TaskCard makes the same interaction reusable for
 * “继续这个系列” and “设为长期任务…”.
 */
export function SeriesNumberPicker({
  open,
  title,
  candidates,
  onCancel,
  onConfirm,
}: SeriesNumberPickerProps) {
  const [selected, setSelected] = useState<number | null>(
    candidates[candidates.length - 1]?.numberIndex ?? null,
  );

  const selectedCandidate = candidates.find(
    (candidate) => candidate.numberIndex === selected,
  );
  const titleSegments: Array<{ text: string; numberIndex?: number }> = [];
  let cursor = 0;
  for (const match of title.matchAll(/\d+/g)) {
    const start = match.index ?? cursor;
    if (start > cursor)
      titleSegments.push({ text: title.slice(cursor, start) });
    titleSegments.push({
      text: match[0],
      numberIndex: Number(
        candidates.find(
          (candidate) =>
            candidate.digits === match[0] &&
            candidate.prefix === title.slice(0, start),
        )?.numberIndex ??
          titleSegments.filter((segment) => segment.numberIndex != null).length,
      ),
    });
    cursor = start + match[0].length;
  }
  if (cursor < title.length) titleSegments.push({ text: title.slice(cursor) });

  return (
    <Modal
      open={open}
      title="选择系列序号"
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: selected == null }}
      onCancel={onCancel}
      onOk={() => {
        if (selected != null) onConfirm(selected);
      }}
    >
      <Typography.Paragraph style={{ wordBreak: "break-all" }}>
        {titleSegments.map((segment, index) =>
          segment.numberIndex == null ? (
            <span key={`text-${index}`}>{segment.text}</span>
          ) : (
            <Tag
              key={`number-${segment.numberIndex}`}
              color={segment.numberIndex === selected ? "blue" : undefined}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(segment.numberIndex!)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelected(segment.numberIndex!);
                }
              }}
              style={{ cursor: "pointer", userSelect: "none" }}
              aria-label={`序号 ${segment.text}`}
              aria-pressed={segment.numberIndex === selected}
            >
              {segment.text}
            </Tag>
          ),
        )}
      </Typography.Paragraph>
      <Typography.Text type="secondary">请选择要递增的数字：</Typography.Text>
      {selectedCandidate ? (
        <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
          下一项：
          {selectedCandidate.prefix}
          <strong>
            {String(selectedCandidate.number + 1).padStart(
              selectedCandidate.digits.length,
              "0",
            )}
          </strong>
          {selectedCandidate.suffix}
        </Typography.Paragraph>
      ) : null}
    </Modal>
  );
}

export default SeriesNumberPicker;
