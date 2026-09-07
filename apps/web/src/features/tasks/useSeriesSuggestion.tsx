import { App, Button, Space } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { ApiError } from "../../lib/api/ApiError";
import { convertTaskToLongTask } from "../longtasks/longTaskApi";
import {
  dismissSeriesSuggestion,
  listSeriesSuggestions,
  type SeriesSuggestion,
} from "./seriesSuggestionApi";
import { invalidateTaskViews } from "./taskActions";

/**
 * 布置任务后问一句要不要改成长期任务。刻意用 notification 而不是 Modal：
 * 不打断手上的动作，但停留到助教明确选择——"暂不"会被永久记住。
 */
export function useSeriesSuggestion() {
  const { message, notification } = App.useApp();
  const queryClient = useQueryClient();

  const accept = useCallback(
    async (studentId: string, suggestion: SeriesSuggestion) => {
      try {
        await convertTaskToLongTask(suggestion.taskId, {
          expectedVersion: suggestion.taskVersion,
        });
        await invalidateTaskViews(queryClient);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["long-tasks"] }),
          queryClient.invalidateQueries({
            queryKey: ["student-tracks", studentId],
          }),
        ]);
        void message.success(
          `「${suggestion.seriesName}」已设为长期任务，完成后自动接排第 ${suggestion.nextOrdinal} 项`,
        );
      } catch (error) {
        void message.error(
          error instanceof ApiError
            ? error.message
            : "设为长期任务失败，请稍后重试",
        );
      }
    },
    [message, queryClient],
  );

  const dismiss = useCallback(
    async (studentId: string, suggestion: SeriesSuggestion) => {
      try {
        await dismissSeriesSuggestion(studentId, suggestion.normalizedKey);
      } catch {
        // 记不住"暂不"最多是下次再问一遍，不值得打断助教。
      }
    },
    [],
  );

  /** 布置完一项后调用；没有够格的系列就什么都不做。 */
  const offerSeriesSuggestion = useCallback(
    async (studentId: string | null | undefined) => {
      if (!studentId) return;
      let latest: SeriesSuggestion | undefined;
      try {
        [latest] = await listSeriesSuggestions(studentId);
      } catch {
        return;
      }
      if (!latest) return;
      const suggestion = latest;
      const key = `series-suggestion:${studentId}:${suggestion.normalizedKey}`;
      notification.open({
        key,
        title: `已连续布置 ${suggestion.assignmentCount} 次「${suggestion.seriesName}」`,
        description: "以后完成后自动接排下一项？",
        duration: 0,
        btn: (
          <Space>
            <Button
              size="small"
              onClick={() => {
                notification.destroy(key);
                void dismiss(studentId, suggestion);
              }}
            >
              暂不
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={() => {
                notification.destroy(key);
                void accept(studentId, suggestion);
              }}
            >
              设为长期任务
            </Button>
          </Space>
        ),
      });
    },
    [accept, dismiss, notification],
  );

  return { offerSeriesSuggestion };
}
