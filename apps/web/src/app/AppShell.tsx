import {
  DownloadOutlined,
  MoreOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Dropdown,
  Layout,
  Space,
  Tooltip,
  Typography,
} from "antd";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { isTauriRuntime } from "../data/runtime";
import { useStartupReconciliation } from "../features/foundation/useStartupReconciliation";
import { GlobalSearchDialog } from "../features/search/GlobalSearchDialog";
import { GlobalQuickAdd } from "../features/quickadd/GlobalQuickAdd";

const navigation = [
  { to: "/today", label: "今日工作" },
  { to: "/workbench", label: "学生工作台" },
  { to: "/students", label: "学生列表" },
  { to: "/long-tasks", label: "长期任务" },
] as const;

export function AppShell() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { message } = App.useApp();

  async function exportData() {
    if (exporting) return;
    setExporting(true);
    try {
      const path = await invoke<string>("export_local_database");
      void message.success({
        content: (
          <>
            已导出：<Typography.Text copyable>{path}</Typography.Text>
          </>
        ),
        duration: 10,
      });
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setExporting(false);
    }
  }

  // 桌面端没有跨夜跑日结的服务器，开机时补上离开期间漏掉的顺延。
  useStartupReconciliation();

  // FR-SEARCH-003 / P3-SRC-007: global Ctrl+K (Windows/Linux) or Cmd+K (macOS)
  // toggles the search modal. The native browser behavior (focus address bar
  // in some browsers) is suppressed via preventDefault.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey;
      if (modifierPressed && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <Layout className="app-shell">
      <Layout.Header className="top-navigation">
        <NavLink className="brand" to="/today" aria-label="助教工作台">
          <span className="brand-mark" aria-hidden="true">
            问
          </span>
          <Typography.Text className="brand-title">助教工作台</Typography.Text>
        </NavLink>
        <nav className="primary-navigation" aria-label="一级导航">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              className={({ isActive }) =>
                `nav-link${isActive ? " nav-link-active" : ""}`
              }
              to={item.to}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <Space className="top-navigation-actions">
          {/* 快速添加放在全局搜索左侧：学生名/日期自动匹配后一键建任务。 */}
          <GlobalQuickAdd />
          <Tooltip title="全局搜索 (Ctrl/Cmd+K)">
            <Button
              aria-label="打开全局搜索"
              aria-keyshortcuts="Control+K Meta+K"
              icon={<SearchOutlined />}
              onClick={() => setSearchOpen(true)}
            >
              全局搜索
            </Button>
          </Tooltip>
          {isTauriRuntime() ? (
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  {
                    key: "export",
                    label: "导出数据",
                    icon: <DownloadOutlined />,
                    disabled: exporting,
                    onClick: () => void exportData(),
                  },
                ],
              }}
            >
              <Button
                aria-label="更多工具"
                icon={<MoreOutlined />}
                loading={exporting}
              />
            </Dropdown>
          ) : null}
        </Space>
      </Layout.Header>
      <Layout.Content className="app-content">
        <Outlet />
      </Layout.Content>
      <GlobalSearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
      />
    </Layout>
  );
}
