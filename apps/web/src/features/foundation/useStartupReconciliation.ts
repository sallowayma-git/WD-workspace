import { App } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { reconcileStartup } from "../admin/dayCloseApi";
import { invalidateTaskViews } from "../tasks/taskActions";
import { useBusinessDate } from "./useBusinessDate";

/**
 * 桌面端关着的时候没人跑日结，所以启动补一次，同一天只补一次。
 * 只有真顺延了东西才出声：每次开机都弹"没事发生"没有意义。
 */
export function useStartupReconciliation(): void {
  const businessDate = useBusinessDate();
  const queryClient = useQueryClient();
  const { notification } = App.useApp();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      let result;
      try {
        result = await reconcileStartup(businessDate);
      } catch {
        // 补日结失败不该拦住开工：顶栏的"执行日结"还在。
        return;
      }
      const summary = result.summary;
      if (!summary || summary.scanned === 0) return;
      await invalidateTaskViews(queryClient);
      const parts = [`已顺延 ${summary.carried} 项`];
      if (summary.blocked > 0) parts.push(`${summary.blocked} 项无可用学习日`);
      if (summary.failed > 0) parts.push(`${summary.failed} 项失败`);
      const needsAttention = summary.blocked > 0 || summary.failed > 0;
      notification.open({
        key: `startup-reconciliation:${businessDate}`,
        type: needsAttention ? "warning" : "success",
        title: `期间自动处理 ${summary.scanned} 项`,
        description: parts.join("，"),
        // 卡住的任务要助教自己挑日子，别自动消失。
        duration: needsAttention ? 0 : 6,
      });
    })();
  }, [businessDate, notification, queryClient]);
}
