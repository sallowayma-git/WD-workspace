# ADR-002：本地桌面运行时取代服务端架构

## 状态

Accepted — 2026-08-20。取代 ADR-001 关于 PostgreSQL/Flyway/RBAC/租户的部分；ADR-001 其余关于严格前端框架与 Tauri 入口的内容仍然有效。

## 背景

ADR-001 假设产品有服务端状态真值、租户与 RBAC。Flowclass 融合任务书 v1.0 第 1 节把产品边界冻结为**单机助教工作台**：一个人在自己的电脑上用，替代原来的 Excel 执行真值。

在这个边界下，服务端不是"以后再做的功能"，而是**错误的形态**：它引入登录、租户、密码 hash、Docker、健康检查和网络故障模式，而这些都不服务于任何真实用户需求。

## 决策

1. 正式运行时只有 Tauri 桌面程序 + 本机 SQLite。浏览器（`pnpm dev:web`）仅作开发/测试外壳，使用内存 SQLite。
2. 业务真值从 HTTP 端点转移到 `apps/web/src/data/DataAdapter.ts`。桌面实现是 `SqliteLocalDataAdapter` + `TauriSqliteStorage`；多写事务由单个 Rust command 在一个 SQLx transaction 内执行。
3. 不做登录、不做用户、不做 organization/tenant、不做 RBAC。业务表不含 `organization_id`、`created_by`、`updated_by`。
4. 业务规则在 Spring 退役**之前**先通过 TypeScript parity tests 固定（任务书风险 R7）。
5. 产品入口图不允许可达 HTTP transport。该约束由 `scripts/check-local-runtime.mjs` 在 `pnpm check` 中强制执行，而不是靠代码评审记忆。

## 已 DROP 的模块

| 模块                                                                   | 原位置                                            | 决策                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| Spring Boot API（全部 Modulith 模块）                                  | `apps/api/`                                       | DROP。规则已由 TS parity tests 固定；实现可从 git 基线 `3b93f57` 取回 |
| PostgreSQL + Flyway + Docker Compose                                   | `infra/`                                          | DROP。本地 SQLite migration 取代                                      |
| 密码登录 / JWT / refresh token                                         | `features/auth/`, `lib/api/http.ts`               | DROP。单机单用户没有认证边界                                          |
| organization / tenant / RBAC / 角色导航                                | `contextApi`, `AuthProvider`, `AppShell` 角色判断 | DROP。日结改为常驻工具页                                              |
| 服务端 feature flag 开关                                               | `useFeatureFlag`                                  | DROP。Today 批量操作改为内置能力                                      |
| Foundation 状态页 / 计划路由占位页                                     | `features/foundation/*`                           | DROP。产品路由不再展示工程状态                                        |
| Vite `/api` dev proxy、Tauri CSP 的 localhost 放行                     | `vite.config.ts`, `tauri.conf.json`               | DROP                                                                  |
| Flow SaaS 语义：Course/Class/Enrolment/Attendance/Teacher/Room/Payment | Flowclass 源                                      | 从未引入（任务书风险 R1）                                             |

## 未决产品选择

以下项目**有意**留在未决状态，不是遗漏：

1. **导入 job 只存在于单个应用会话内。** `previewTemplateImport` → `executeTemplateImport` 之间的预览列和错误明细放在 adapter 的内存 Map 里，没有 `import_job` 表。导入结果（模板/版本/条目）已持久化。若将来需要跨重启查看导入审计，需要新增表。
2. **日结不落 run 记录。** 与退役前的 Java 行为一致：`triggerDayClose` 返回本次批量结果，不写 `day_close_run`。历史追溯目前依赖任务自身的 lineage。
3. **全局搜索用 LIKE，不用 FTS5。** 单机数据量下足够；任务书 `LOC-016` 允许按需再上 FTS5。
4. **Calendar 采用 Partial。** Month 视图与 core/DnD 复用 Flowclass；Day/Week 保留 WD 的日期语义，不虚构小时（任务书风险 R2）。
5. **按需手动导出。** 顶栏「更多工具 → 导出数据」通过 SQLite `VACUUM INTO` 生成包含已提交 WAL 内容的独立数据库文件，保存到用户文档目录的 `AssistantExports`。不提供后台备份调度、备份中心或启动恢复流程。

## 后果

- 启动路径没有网络、没有登录、没有外部进程；失败模式收敛为"数据库文件能否打开"。
- 失去服务端的多端同步与集中审计能力。这是产品边界的选择，不是技术债。
- 任何重新引入 `fetch()`、HTTP adapter 或 auth store 的改动都会让 `pnpm check` 失败。
