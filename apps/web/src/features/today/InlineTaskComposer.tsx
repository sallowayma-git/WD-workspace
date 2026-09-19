import { LoadingOutlined } from "@ant-design/icons";
import { Alert, AutoComplete, Space } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FocusEvent } from "react";
import { MountTrackModal } from "../planning/MountTrackModal";
import { useSeriesSuggestion } from "../tasks/useSeriesSuggestion";
import { listTemplates, type TaskTemplate } from "../templates/templateApi";
import { createAdHocTask } from "./taskApi";

export interface InlineTaskComposerProps {
  studentId: string;
  /** Used only to give each student's composer a distinct accessible name. */
  studentName?: string;
  scheduledDate: string;
  onCreated?: () => void | Promise<void>;
  /** Commit the current ad-hoc title when the workbench cell loses focus. */
  commitOnBlur?: boolean;
  /** Called when the editor loses focus without a title to create. */
  onCancel?: () => void;
}

type ComposerOption = {
  value: string;
  label: string;
  kind: "ad-hoc" | "template";
  template?: TaskTemplate;
};

export function InlineTaskComposer({
  studentId,
  studentName,
  scheduledDate,
  onCreated,
  onCancel,
  commitOnBlur = false,
}: InlineTaskComposerProps) {
  const queryClient = useQueryClient();
  const { offerSeriesSuggestion } = useSeriesSuggestion();
  const [value, setValue] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mountTemplate, setMountTemplate] = useState<TaskTemplate | null>(null);
  const mountTemplateRef = useRef<TaskTemplate | null>(null);
  const submissionRef = useRef(false);
  const valueRef = useRef("");
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced template search. Empty query returns nothing to avoid noise.
  const [searchQuery, setSearchQuery] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => setSearchQuery(value.trim()), 200);
    return () => clearTimeout(handle);
  }, [value]);
  useEffect(
    () => () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    },
    [],
  );

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
      valueRef.current = "";
      setValue("");
      setErrorMessage(null);
      await queryClient.invalidateQueries({
        queryKey: ["today", scheduledDate],
      });
      await onCreated?.();
      await offerSeriesSuggestion(studentId);
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "创建临时任务失败";
      setErrorMessage(message);
    },
    onSettled: () => {
      submissionRef.current = false;
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
        label: `挂载任务模板：${template.name}`,
        kind: "template",
        template,
      });
    }
  }

  const submitAdHoc = (title: string) => {
    const trimmed = title.trim();
    if (!trimmed || submissionRef.current) {
      return;
    }
    submissionRef.current = true;
    setErrorMessage(null);
    createMutation.mutate(trimmed);
  };

  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    if (!commitOnBlur || mountTemplateRef.current) return;
    const titleAtBlur =
      event.target instanceof HTMLInputElement
        ? event.target.value
        : valueRef.current;
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    // AutoComplete fires blur before a clicked option's onSelect. Delay the
    // decision by one tick so an option selection can cancel it.
    blurTimerRef.current = setTimeout(() => {
      blurTimerRef.current = null;
      if (mountTemplateRef.current) return;
      const title = titleAtBlur.trim();
      if (title) submitAdHoc(title);
      else onCancel?.();
    }, 0);
  };

  return (
    <Space
      orientation="vertical"
      style={{ width: "100%" }}
      size="small"
      onBlurCapture={handleBlur}
    >
      <AutoComplete
        style={{ width: "100%" }}
        aria-label={studentName ? `为 ${studentName} 新增任务` : "新增任务"}
        value={value}
        options={options}
        placeholder="任务标题或模板名称"
        defaultActiveFirstOption={false}
        onChange={(next) => {
          if (submissionRef.current) return;
          valueRef.current = next;
          setValue(next);
          if (errorMessage) {
            setErrorMessage(null);
          }
        }}
        onSearch={(next) => {
          if (submissionRef.current) return;
          valueRef.current = next;
          setValue(next);
        }}
        onSelect={(selected, option) => {
          if (blurTimerRef.current) {
            clearTimeout(blurTimerRef.current);
            blurTimerRef.current = null;
          }
          if (submissionRef.current) return;
          if (option.kind === "template" && option.template) {
            mountTemplateRef.current = option.template;
            setMountTemplate(option.template);
            valueRef.current = "";
            setValue("");
          } else if (option.kind === "ad-hoc") {
            submitAdHoc(selected.slice("__adhoc__:".length));
          }
        }}
        filterOption={false}
        notFoundContent={templatesQuery.isPending ? "搜索模板中…" : null}
        disabled={saving}
        prefix={saving ? <LoadingOutlined /> : undefined}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            if (blurTimerRef.current) {
              clearTimeout(blurTimerRef.current);
              blurTimerRef.current = null;
            }
            if (commitOnBlur) onCancel?.();
            return;
          }
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            const activeId = (e.target as HTMLElement).getAttribute(
              "aria-activedescendant",
            );
            if (
              activeId &&
              document.getElementById(activeId)?.getAttribute("role") ===
                "option"
            ) {
              return;
            }
            // Enter with no highlighted option -> create ad-hoc task.
            e.preventDefault();
            submitAdHoc(value);
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
      {mountTemplate ? (
        <MountTrackModal
          studentId={studentId}
          initialTemplateId={mountTemplate.id}
          anchorDate={scheduledDate}
          open
          onClose={() => {
            mountTemplateRef.current = null;
            setMountTemplate(null);
          }}
        />
      ) : null}
    </Space>
  );
}
