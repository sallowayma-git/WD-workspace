import { SearchOutlined } from "@ant-design/icons";
import { Empty, Input, Modal, Spin, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  TaskUsageDrawer,
  type UsageTarget,
} from "../templates/TaskUsageDrawer";
import { searchGlobal, type SearchResultItem } from "./searchApi";

const groupLabels: Record<string, string> = {
  STUDENT: "学生",
  TEMPLATE: "任务模板",
  TEMPLATE_ITEM: "模板单元",
  TASK_INSTANCE: "每日任务",
  DATE: "日期",
};

const statusColors: Record<string, string> = {
  PENDING: "blue",
  COMPLETED: "green",
  CARRIED_OVER: "orange",
  ACTIVE: "green",
};

export function GlobalSearchDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [usageTarget, setUsageTarget] = useState<UsageTarget | null>(null);
  if (!open && usageTarget === null) return null;
  return (
    <>
      {open ? (
        <SearchDialogBody onClose={onClose} onUsageOpen={setUsageTarget} />
      ) : null}
      <TaskUsageDrawer
        target={usageTarget}
        onClose={() => setUsageTarget(null)}
      />
    </>
  );
}

function SearchDialogBody({
  onClose,
  onUsageOpen,
}: {
  onClose: () => void;
  onUsageOpen: (target: UsageTarget) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(focusTimer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const searchQuery = useQuery({
    queryKey: ["search", debouncedQuery],
    queryFn: () => searchGlobal(debouncedQuery),
    enabled: debouncedQuery.length > 0,
    retry: false,
  });

  // Flatten all result items into a single ordered list so we can navigate
  // them with ArrowUp / ArrowDown as a single virtual listbox.
  const flatItems = useMemo<SearchResultItem[]>(() => {
    const items: SearchResultItem[] = [];
    for (const group of searchQuery.data?.groups ?? []) {
      for (const item of group.items) {
        items.push(item);
      }
    }
    return items;
  }, [searchQuery.data]);

  const totalItems = flatItems.length;

  // Clamp activeIndex during render so it always points at a valid item (or 0
  // when the list is empty). Doing this in an effect triggers cascading
  // renders; deriving it here keeps things synchronous and lint-clean.
  const safeActiveIndex =
    totalItems === 0 ? 0 : Math.min(activeIndex, totalItems - 1);

  const handleItemClick = (item: {
    id: string;
    type: string;
    title: string;
  }) => {
    if (item.type === "STUDENT") {
      void navigate(`/students/${item.id}/profile`);
      onClose();
    } else if (item.type === "TEMPLATE") {
      onUsageOpen({ kind: "TEMPLATE", id: item.id, title: item.title });
      onClose();
    } else if (item.type === "TEMPLATE_ITEM") {
      onUsageOpen({ kind: "TEMPLATE_ITEM", id: item.id, title: item.title });
      onClose();
    } else {
      // TASK_INSTANCE / DATE results: no default navigation today; just close.
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (totalItems === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((idx) => (idx + 1) % totalItems);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((idx) => (idx - 1 + totalItems) % totalItems);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = flatItems[safeActiveIndex];
      if (target) handleItemClick(target);
    }
  };

  // Build a stable id for each option so aria-activedescendant can target it.
  const optionId = (index: number) => `search-option-${index}`;

  let runningIndex = 0;

  return (
    <Modal
      open
      onCancel={onClose}
      footer={null}
      width={600}
      title="全局搜索"
      styles={{ body: { maxHeight: "60vh", overflow: "auto" } }}
    >
      <Input
        ref={inputRef as never}
        size="large"
        prefix={<SearchOutlined />}
        placeholder="搜索学生、模板、任务或日期（如 8月18日、今天）"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={totalItems > 0}
        aria-controls="global-search-listbox"
        aria-autocomplete="list"
        aria-activedescendant={
          totalItems > 0 ? optionId(safeActiveIndex) : undefined
        }
      />

      {searchQuery.data?.parsedDateHint ? (
        <Typography.Text
          type="secondary"
          style={{ marginTop: 8, display: "block" }}
        >
          {searchQuery.data.parsedDateHint}
        </Typography.Text>
      ) : null}

      {searchQuery.isPending && debouncedQuery ? (
        <div style={{ textAlign: "center", padding: 24 }}>
          <Spin />
        </div>
      ) : null}

      {!searchQuery.isPending && totalItems === 0 && debouncedQuery ? (
        <Empty description="未找到匹配结果" style={{ marginTop: 24 }} />
      ) : null}

      <div
        id="global-search-listbox"
        role="listbox"
        aria-label="全局搜索结果"
      >
        {searchQuery.data?.groups.map((group) => {
          if (group.items.length === 0) return null;
          const groupStartIndex = runningIndex;
          runningIndex += group.items.length;
          return (
            <div key={group.type} style={{ marginTop: 16 }}>
              <Typography.Text strong type="secondary">
                {groupLabels[group.type] ?? group.type}
              </Typography.Text>
              {group.items.map((item, i) => {
                const flatIndex = groupStartIndex + i;
                const isActive = flatIndex === safeActiveIndex;
                return (
                  <div
                    key={item.id}
                    id={optionId(flatIndex)}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => handleItemClick(item)}
                    style={{
                      padding: "8px 12px",
                      cursor: "pointer",
                      borderRadius: 6,
                      marginTop: 4,
                      transition: "background 0.2s",
                      background: isActive ? "#e6f4ff" : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#f5f5f5";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isActive
                        ? "#e6f4ff"
                        : "transparent";
                    }}
                  >
                    <Typography.Text>{item.title}</Typography.Text>
                    {item.subtitle ? (
                      <Typography.Text
                        type="secondary"
                        style={{ marginLeft: 8 }}
                      >
                        {item.subtitle}
                      </Typography.Text>
                    ) : null}
                    {item.status ? (
                      <Tag
                        color={statusColors[item.status] ?? "default"}
                        style={{ marginLeft: 8 }}
                      >
                        {item.status}
                      </Tag>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
