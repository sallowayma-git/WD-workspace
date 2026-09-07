# Local development runbook

本产品是单机 Tauri 桌面应用。运行时只依赖本机文件系统与本机 SQLite，没有服务器、没有登录、没有 PostgreSQL、没有 Java。浏览器只是开发/测试外壳，不是产品形态。

## 依赖门禁

| 依赖                       | 用途                             | 缺失后果                        |
| -------------------------- | -------------------------------- | ------------------------------- |
| Node >= 24.15.0 / pnpm     | 前端构建与测试                   | 无法安装依赖或运行 `pnpm check` |
| Rust stable                | Tauri 桌面外壳与本地 SQLite 命令 | 无法 `pnpm dev` / `pnpm build`  |
| Windows WebView2 Runtime   | 桌面窗口渲染                     | 桌面程序启动后白屏              |
| Windows Build Tools (MSVC) | 编译 Rust 依赖                   | `cargo` 链接失败                |

Node 版本以根 `package.json` 的 `engines`（`>=24.15.0`）为准。**不要使用 Node 20/22**（含默认 PATH 里的 22.x）：不满足 `engines` 时 pnpm 会在安装阶段直接拒绝，照旧文档准备环境会踩坑。

缺少任一项时脚本必须明确失败。不要用假数据或自动生成的凭据绕过门禁——本产品没有需要凭据的组件。

## 启动

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 直接启动 Tauri 桌面开发窗口（`pnpm dev:desktop`），不会启动任何服务器进程。

仅调试前端布局时可用 `pnpm dev:web`：它在浏览器里跑同一套 UI，但使用 **内存 SQLite**（`sql.js`），关闭标签页数据即丢失。任何持久化、导入或日结验收都必须在桌面程序里做。

## 数据位置

正式桌面运行时的数据库文件：

```text
%APPDATA%\com.wonderedu.assistant\assistant.db
```

Schema 由 `apps/desktop/src-tauri/migrations/` 中的 SQL 文件建立和更新，Tauri 启动时只执行尚未应用的迁移。删除数据库文件等于清空全部业务数据。

需要导出时使用顶栏「更多工具 → 导出数据」。文件保存在系统文档目录的 `AssistantExports` 文件夹，完成提示显示可复制的完整路径。导出包含已提交的 WAL 数据；应用不创建自动备份，也不在启动时替换数据库。

## 排查顺序

1. 确认桌面进程已启动，且 `%APPDATA%\com.wonderedu.assistant\assistant.db` 存在。
2. 用 SQLite 客户端检查 `_sqlx_migrations` 中的迁移记录是否与当前构建的 `migrations/` 一致。
3. 页面报“本地数据暂不可用”时，先看数据库文件是否被其他进程独占或被杀软锁定。
4. 前端行为异常时用 `pnpm dev:web` 复现；若浏览器正常而桌面异常，问题在 Tauri/SQLite 边界（`apps/desktop/src-tauri/src/local_database.rs`）。
5. `pnpm check` 会跑 `scripts/check-local-runtime.mjs`：它从 `main.tsx` 递归遍历 import 图，如果产品入口重新可达 HTTP transport 或裸 `fetch()`，门禁会失败。

## 数据重置

没有默认的重置命令。要清空本机数据，先关闭桌面程序，再手动删除或重命名 `assistant.db`。

实现自动重置脚本时必须要求显式确认，并在执行前打印解析后的绝对路径；禁止递归删除任何目录。

## 用户测试版

`pnpm build:preview` 编译 Windows Release EXE，内嵌完整界面与全部本地业务功能，不需要开发服务器。产物为 `apps/desktop/src-tauri/target/release/assistant_desktop.exe`，可直接发送给测试用户双击运行。

测试版仅覆盖产品名称与应用标识，数据保存到 `%APPDATA%\com.wonderedu.assistant.preview\assistant.db`，关闭后保留。运行要求为 Windows 10/11 x64 和 Microsoft Edge WebView2 Runtime。

2026-09-08 交付验证：Web 28 文件 / 204 用例和 Rust 6 用例通过；Release EXE 实测学生建档、学习日保存、快速/行内添加、任务编辑与完成、SEQUENCE 与 ITEMIZED 接排、Excel 导入、生词编辑、数据库及 CSV 导出、重启持久化。原生界面核验修复了学生写入响应映射、导入/长期任务列表刷新、窄窗口日历标题被挤压和矩阵表头错位。数据库完整性与外键检查通过。

发送文件统一放在忽略目录 `dist/preview-0.1.0-win-x64/`，包含 EXE、使用说明和 SHA-256；同级 ZIP 便于分发。测试版没有功能开关或试用期限，但尚未签名。每次交付只保留当前发送包，清理旧安装包、测试数据库、临时截图和脚本；源码回归测试保留。

## 已退役的组件

Spring/PostgreSQL/登录栈已在 F8 阶段移除。历史契约存档见 `docs/reference/retired-server/`，决策记录见 `docs/adr/ADR-002-local-desktop-runtime.md`。
