import { SearchOutlined } from "@ant-design/icons";
import { Button, Layout, Space, Tooltip, Typography } from "antd";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../features/auth/AuthProvider";
import { GlobalSearchDialog } from "../features/search/GlobalSearchDialog";

const ADMIN_ROLES = ["ADMIN"];

const navigation = [
  { to: "/today", label: "今日工作" },
  { to: "/workbench", label: "学生工作台" },
  { to: "/students", label: "学生列表" },
  { to: "/templates", label: "任务模板" },
] as const;

export function AppShell() {
  const { session } = useAuth();
  const showAdminEntry =
    session?.user.roles.some((role) => ADMIN_ROLES.includes(role)) ?? false;
  const [searchOpen, setSearchOpen] = useState(false);

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
          {showAdminEntry ? (
            <NavLink
              className={({ isActive }) =>
                `nav-link${isActive ? " nav-link-active" : ""}`
              }
              to="/admin/day-close"
            >
              日结管理
            </NavLink>
          ) : null}
        </nav>
        <Space className="top-navigation-actions">
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
          <span className="phase-badge">Core Domain</span>
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
