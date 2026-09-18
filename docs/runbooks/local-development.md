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

## macOS 安装包

```bash
pnpm build:desktop:mac-dmg
```

产物为 `apps/desktop/src-tauri/target/release/bundle/dmg/助教工作台_0.1.0_aarch64.dmg`（产品名_版本_架构，与 Tauri 自带的 NSIS 命名 `助教工作台_0.1.0_x64-setup.exe` 对齐；带版本号是为了避免不同版本的安装包下载到同一目录时互相覆盖）。

DMG 里除了 `助教工作台.app` 和 `/Applications` 快捷方式，还有两个分发用的文件：

- `首次打开说明.txt`：解释「已损坏，无法打开」的成因，并给出终端命令
- `修复并打开.command`：一键完成「复制到应用程序 → 摘掉隔离标记 → 打开」

不能直接用 `tauri build --bundles dmg`：Tauri 自带的 DMG 只放应用和快捷方式，而 `bundle.macOS.files` 的路径相对 `<app>.app/Contents` 解析，没法把文件放到 DMG 根目录。所以 `apps/desktop/scripts/build-macos-dmg.sh` 先让 Tauri 只产 `.app`，再用 `hdiutil` 组装 DMG，组装后还会挂载回读，确认四个条目都在、且应用仍带 ad-hoc 签名。

没有 Apple 开发者账号，所以不做签名与公证。但 Apple Silicon 上「完全未签名」的二进制会被内核直接拒绝执行，用户看到的就是「已损坏」。因此 `apps/desktop/src-tauri/tauri.macos.conf.json` 里必须保留 ad-hoc 身份：

```json
"bundle": { "macOS": { "signingIdentity": "-" } }
```

这会让 Tauri 做 ad-hoc 签名：签名有效，但不是 Apple 签发，所以 Gatekeeper 仍会拦，需要用户自己摘掉隔离标记——这正是说明文件和脚本存在的原因。脚本会校验签名，一旦不是 ad-hoc 就立即失败，避免把打不开的包发出去。

`targets` 在 macOS 上写的是 `["app"]` 而不是 `["dmg"]`，目的是强制走上面这条路径，避免误产出一个缺少说明文件的 DMG。

只出 arm64：GitHub 已于 2025-09-19 下线 x86_64 的 macOS runner（Apple 停止支持该架构），`macos-latest` 是 arm64。

## 发布安装包

安装包不再跟着每次提交产出，改成跟着标签走：

```bash
git tag v0.1.0
git push origin v0.1.0
```

推标签后 `.github/workflows/ci.yml` 会做这些事，顺序是硬性的：

0. `preflight` 先跑 `node scripts/check-versions.mjs`：以 `tauri.conf.json` 为基准，
   确认必须跟随的 5 处（根与 `apps/*` 的 `package.json`、`tauri.conf.json`、
   `Cargo.toml`）彼此一致，并确认标签（`v0.2.0` → `0.2.0`）等于那个基准版本。
   `packages/*` 是内部库、允许独立演进，脚本只报告不拦截。
   `desktop` 和 `macos` 都 `needs` 它，所以这一步不过，两个平台根本不会开始编译。
1. `web` 跑 `gate:web`；`desktop` 在 Windows 上先跑 `gate:desktop` 再打包 NSIS。
   门禁和打包在同一个 job 里且门禁排在前面，所以门禁不过就不会打包。
2. `macos` 在 arm64 runner 上组装 DMG。它不重复跑门禁——同一份 Rust 代码在两个
   runner 上各跑一遍没有意义，而打包本身是一次 release 编译，编不过这个 job 就会失败。
3. `release` 需要上面三个 job 全部成功才执行，用 `gh release create --verify-tag`
   把两个平台的安装包和 `.sha256` 挂到标签对应的 Release 附件上。

为什么要有 `preflight` 这一道：安装包文件名取自 `tauri.conf.json` 的 `version`
（DMG 由 `build-macos-dmg.sh` 读它，NSIS 由 Tauri 自己读它）。标签和它不一致时，
打出来的是 `助教工作台_0.1.0_aarch64.dmg`，却挂到 `v0.2.0` 的 Release 上——用户
下到的包和 Release 声称的版本不符，而且从文件名上完全看不出来。版本号在仓库里
重复了 7 处（根和 `apps/*`、`packages/*` 的 `package.json`、`tauri.conf.json`、
`Cargo.toml`），改一处漏一处是迟早的事，所以先查一致性再看标签。同样的检查也在
`pnpm check` 里（`check:versions`），本地跑绿就不会到 CI 才红。

重跑已成功的运行会失败，因为 `gh release create` 发现 Release 已存在。这是刻意
的：不让重跑悄悄替换掉已经发布出去的安装包（构建不可复现，重编出来的字节不同，
已经抄下校验和的用户会对不上）。要重发就先 `gh release delete <tag>` 再重跑。

两个打包 job 都会在编译前清空自己的输出目录（`bundle/nsis`、`bundle/dmg`）。
这一步不能省：`Swatinem/rust-cache` 缓存的是整个 `target/`，里面包含上一次构建
留下的安装包；不清掉的话，旧版本的包会被一起上传，最后挂到新 Release 上，用户
下到的就是上一版。

`--verify-tag` 是必须的：没有它，`gh` 会在标签不存在时自动从默认分支补建一个，
Release 就可能指向一个和预期不同的提交。

PR 和 `main` 的普通推送只跑门禁，不打包。需要在没有标签的情况下验证打包链路时，
在 Actions 页面手动触发 workflow（`workflow_dispatch`）：只产 artifacts，不发 Release。

## 已退役的组件

Spring/PostgreSQL/登录栈已在 F8 阶段移除。历史契约存档见 `docs/reference/retired-server/`，决策记录见 `docs/adr/ADR-002-local-desktop-runtime.md`。
