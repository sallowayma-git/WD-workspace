import { LoadingOutlined } from "@ant-design/icons";
import { Alert, AutoComplete, Space } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError } from "../../lib/api/http";
import { MountTrackModal } from "../planning/MountTrackModal";
import { listTemplates, type TaskTemplate } from "../templates/templateApi";
import { createAdHocTask } from "./taskApi";

export interface InlineTaskComposerProps {
  studentId: string;
  scheduledDate: string;
}

type ComposerOption = {
  value: string;
  label: string;
  kind: "ad-hoc" | "template";
  template?: TaskTemplate;
};

export function InlineTaskComposer({
  studentId,
  scheduledDate,
}: InlineTaskComposerProps) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mountTemplate, setMountTemplate] = useState<TaskTemplate | null>(null);

  // Debounced template search. Empty query returns nothing to avoid noise.
  const [searchQuery, setSearchQuery] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => setSearchQuery(value.trim()), 200);
    return () => clearTimeout(handle);
  }, [value]);

  const templatesQuery = useQuery({
    queryKey: ["templates-for-composer", searchQuery],
    queryFn: () => listTemplates(searchQuery),
    enabled: searchQuery.length > 0,
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (title: string) =>
      createAdHocTask({
        studentId,
        scheduledDate,
        title,
      }),
    onSuccess: async () => {
      setValue("");
      setErrorMessage(null);
      await queryClient.invalidateQueries({
        queryKey: ["today", scheduledDate],
      });
    },
    onError: (error: unknown) => {
      const message =
        error instanceof ApiError
          ? `${error.message}${error.requestId ? `（requestId: ${error.requestId}）` : ""}`
          : error instanceof Error
            ? error.message
            : "创建临时任务失败";
      setErrorMessage(message);
    },
  });

  const saving = createMutation.isPending;

  const options: ComposerOption[] = [];
  if (value.trim().length > 0) {
    options.push({
      value: `__adhoc__:${value.trim()}`,
      label: `创建临时任务："${value.trim()}"`,
      kind: "ad-hoc",
    });
  }
  for (const template of templatesQuery.data?.items ?? []) {
    if (template.currentPublishedVersionId) {
      options.push({
        value: `__template__:${template.id}`,
        label: `挂载模板：${template.name}（${template.templateCode}）`,
        kind: "template",
        template,
      });
    }
  }

  const submitAdHoc = (title: string) => {
    const trimmed = title.trim();
    if (!trimmed || saving) {
      return;
    }
    createMutation.mutate(trimmed);
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="small">
      <AutoComplete
        style={{ width: "100%" }}
        value={value}
        options={options}
        placeholder="输入临时任务回车创建，或搜索模板挂载"
        onChange={(next) => {
          setValue(next);
          if (errorMessage) {
            setErrorMessage(null);
          }
        }}
        onSelect={(selected, option) => {
          if (option.kind === "template" && option.template) {
            setMountTemplate(option.template);
            setValue("");
          } else if (option.kind === "ad-hoc") {
            const idx = selected.indexOf(":");
            submitAdHoc(idx >= 0 ? selected.slice(idx + 1) : value);
            setValue("");
          }
        }}
        filterOption={false}
        notFoundContent={templatesQuery.isPending ? "搜索模板中…" : null}
        disabled={saving}
        prefix={saving ? <LoadingOutlined /> : undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // Enter with no highlighted option -> create ad-hoc task.
            submitAdHoc(value);
            setValue("");
          }
        }}
      />
      {errorMessage ? (
        <Alert
          type="error"
          showIcon
          message={errorMessage}
          closable
          onClose={() => setErrorMessage(null)}
        />
      ) : null}
      <MountTrackModal
        studentId={studentId}
        open={mountTemplate !== null}
        onClose={() => setMountTemplate(null)}
      />
    </Space>
  );
}
