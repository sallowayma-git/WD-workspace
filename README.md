# 助教工作台

助教工作台是单机 Tauri 桌面应用。学生、学习日、长期任务、任务模板、Track、任务、Today、矩阵、排期、生词、导入和日结数据均保存在本机 SQLite，不需要登录、Java、PostgreSQL 或远端 API。

长期任务（SEQUENCE）按「标题模板 + 序号」自动接排：挂载后学生完成一项，下一项出现在下一个可学习日；顺延保持序号不变。逐项定义的模板（ITEMIZED，Excel 导入）继续使用模板版本机制，见 `docs/adr/ADR-003-sequence-long-task.md`。

## 产品边界

- 正式运行形态：Tauri 桌面应用。
- 唯一业务真值：应用数据目录中的 `assistant.db`。
- React/Vite 仅作为桌面 UI 技术栈；浏览器入口只用于开发和测试。
- 不包含多用户、RBAC、多机构、云同步、课程售卖、班课、出勤、支付或通知中心。

## 目录

```text
apps/web       React/Vite 桌面 UI
apps/desktop   Tauri 2 桌面运行时与 SQLite migration
packages       共享类型、设计令牌和测试 fixture
scripts        本地运行边界校验
docs           迁移来源、决策和验收记录
DocsHarness    产品与实施基线
```

## 前置依赖

- Node.js 24.15+ 与 pnpm 11.19
- Rust stable
- Windows WebView2 与 Microsoft C++ Build Tools

## 开发

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 启动 Tauri 桌面应用。`pnpm dev:web` 只启动开发/测试壳，并使用内存 SQLite；它不是产品部署方式。

## 校验与构建

```powershell
pnpm check
pnpm build
```

`pnpm check` 校验正式入口不可达 HTTP/Auth transport，并运行 Web 类型、测试与 Rust 门禁。`pnpm build` 生成本地桌面可执行文件，不启动或构建任何服务器组件。

Windows 可执行文件位于：

```text
apps/desktop/src-tauri/target/release/assistant_desktop.exe
```

SQLite 数据文件通常位于：

```text
%APPDATA%/com.wonderedu.assistant/assistant.db
```

## 安装包

CI 只在推送 `v*` 标签时产出安装包：推标签会跑完门禁再打包，两个平台的安装包同时挂到 GitHub Release 的附件里，也会作为 workflow artifacts 保留 14 天。PR 和 `main` 的普通推送只跑门禁，不打包。

```bash
git tag v0.1.0 && git push origin v0.1.0
```

需要在没有标签的情况下验证打包链路（例如改了打包脚本），可以在 Actions 页面手动触发一次 workflow：只产 artifacts，不发 Release。

标签要和仓库里的版本号对得上（`v0.2.0` ↔ `0.2.0`）。安装包文件名取自 `apps/desktop/src-tauri/tauri.conf.json` 的 `version`，对不上的话会打出一个版本号和 Release 名称不符的包，而文件名本身看不出问题——所以 workflow 会在最前面的 `preflight` 直接拦下来，不会白编二十分钟。`pnpm check` 里也有一道同样的检查。

| 平台        | 产物                                                               | 本地构建命令                 |
| ----------- | ------------------------------------------------------------------ | ---------------------------- |
| Windows x64 | NSIS 安装程序 `.exe`，安装向导里有目录选择页，可选当前用户或全机器 | `pnpm build:desktop:nsis`    |
| macOS arm64 | `.dmg`，内含应用、`/Applications` 快捷方式、说明文件与一键修复脚本 | `pnpm build:desktop:mac-dmg` |

两个安装包都没有代码签名：项目没有 Apple 开发者账号，也没有 Windows 代码签名证书。因此分发时同时提供 `.sha256` 校验值，用户可据此确认文件未被篡改。

macOS 用户首次打开需要先摘掉隔离标记，否则系统会报「已损坏，无法打开」。原因、终端命令和一键脚本都写在 DMG 里的 `首次打开说明.txt`；脚本源码见 `apps/desktop/src-tauri/macos/`。

迁移验收证据见 `docs/migration/flowclass/acceptance.md`。
