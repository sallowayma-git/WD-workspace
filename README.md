# 助教工作台

助教工作台是单机 Tauri 桌面应用。学生、学习日、长期任务、课程模板、Track、任务、Today、矩阵、排期、生词、导入和日结数据均保存在本机 SQLite，不需要登录、Java、PostgreSQL 或远端 API。

长期任务（SEQUENCE）按「标题模板 + 序号」自动接排：挂载后学生完成一项，下一项出现在下一个可学习日；顺延保持序号不变。逐项定义的课程（ITEMIZED，Excel 导入）继续使用模板版本机制，见 `docs/adr/ADR-003-sequence-long-task.md`。

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

迁移验收证据见 `docs/migration/flowclass/acceptance.md`。
