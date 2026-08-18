# Findings & Decisions

## Requirements

- 用户要求：查看 `DocsHarness/` 三份基础文档，初始化项目并开始开发；目标由代理自行设定、分阶段更新，直到达到文档约定和需求。
- 文档集合：PRD（需求与竞品研究）、SDD（开发设计与架构）、WBS（实施任务与测试计划）。

## Research Findings

- 当前工作区根目录只有 `DocsHarness/` 三份 Markdown，无 `.git`、源码、包管理、构建、容器或测试文件。
- SDD 规划单仓：`apps/web`、`apps/desktop`、`apps/api`、共享 `packages/*`、`infra`、`scripts`；技术矩阵为 Tauri 2、React 19+TypeScript strict+Vite、Java 21+Spring Boot 4.1.x/Modulith 2.1.x、PostgreSQL 18.x、Flyway、Quartz。
- WBS 将仓库骨架（P0-FND-001）、Docker Compose/Flyway（P0-FND-002）、开发种子（P0-FND-004）、CI 门禁（P0-FND-019）列为待办基础任务。
- 本机可用 Node/pnpm/Cargo/Rust；未发现 Java、Gradle、Docker、Docker Compose，后端和容器门禁需后续环境补齐或使用 wrapper/替代验证。
- PRD 核心模型冻结为 Student → 学习条件/轨道 → 每日任务实例 → Checklist；模板、模板版本、模板单元、学生轨道、每日任务实例必须分层，临时任务不推进轨道。
- PRD P0 要求完整可用闭环：顶部导航/Today、搜索、学生工作台与单学生日周月排期、学习条件、模板版本与 Excel 导入、轨道、临时任务、完成与自动顺延、拖拽、生词、权限/审计/备份/桌面打包。
- PRD 的高风险业务不变量：仅“完成”推进连续轨道；改期/拖拽/顺延不推进；顺延保留原实例并创建链路；命令需幂等；锁定任务不自动移动；组织时区解释业务日期、UTC 保存时间戳；服务端权限/租户/并发版本强制校验。
- PRD AC-001~015 构成核心产品验收：Today、入口语义、轨道挂载/连续推进、顺延、设备覆盖、拖拽、版本不可变、Excel 导入、临时任务、反向查询、并发、自动化透明、生词周汇总。
- PRD 性能预算：Today 60 学生/500 任务 P95 1.5s；Workbench 60×14 P95 2s；10 万搜索文档 P95 500ms；单写 API P95 800ms；5000 单元 Excel 异步导入。
- SDD 前半确认 P0 为中心数据库在线协作架构：Tauri 薄壳与浏览器共享 React UI，Spring Modulith 模块化单体提供 REST/OpenAPI，PostgreSQL 为唯一事实源；P0 不做微服务、Kafka、Elasticsearch、重型工作流或完整离线写入。
- SDD 推荐单仓与模块边界已冻结：前端按 feature 垂直切片，后端 identity/student/curriculum/planning/execution/vocabulary/search/importexport/audit/shared；跨模块只能走公开 API/事件，不得引用他模块 JPA 实体。
- 全局数据约束：UUID、organization_id、UTC 审计时间、version 乐观锁；date 按组织时区；删除采用归档/作废；高风险命令用 Idempotency-Key；409 返回当前实体摘要。
- 数据核心以 task_instance 为执行真值，保存模板快照、排期来源、override、锁定、顺延双向链与完成审计；部分唯一索引避免同一轨道单元出现两个 PENDING。
- 版本依赖启动时需形成 `dependency-lock.md`；前端 lockfile、Java BOM/dependency management、Rust Cargo.lock，许可证与大版本升级都有门禁。
- SDD 核心用例算法已明确：轨道指针必须从 currentOrdinal 连续扫描 COMPLETED，绝不能简单 +1；排期为每单元独立实例；完成/顺延/重开均以锁、版本和幂等键保护。
- DayClose 以 Quartz 持久 JobStore、业务日期和稳定 runId 运行，分页 `FOR UPDATE SKIP LOCKED`，每项复用 carryOverTask；找不到下一可学习日转 BLOCKED，锁定项 no-op。
- REST `/api/v1` 统一 camelCase、RFC3339 UTC、Problem Details、requestId、If-Match 与 Idempotency-Key，OpenAPI 为客户端唯一契约源；Today/Workbench 使用一次聚合读模型避免 N+1。
- 前端路由和组件拓扑已指定，姓名/生词/排期入口必须独立可访问；高密度工作台采用 TanStack Table/Virtual + CSS Grid，单学生日历可用 FullCalendar Standard；拖拽与 Checkbox 可乐观更新但业务真值由服务端返回。
- Tauri 只承担窗口、安全凭据、文件/通知、更新等平台能力，通过 PlatformAdapter 隔离；禁止直连数据库、复制业务规则、启用任意 shell。认证 access token 仅内存、refresh token 安全存储。
- 搜索读模型用 PostgreSQL FTS/trigram，事件驱动更新并可重建；最终权限过滤必须结构化 JOIN/EXISTS，不能依赖 JSON 列或前端隐藏。
- SDD 事务门禁：完成+指针+审计/事件、顺延源+目标+链、模板发布、轨道挂载必须单事务；锁顺序全局一致，批量按 UUID 排序且只有幂等命令可对死锁重试。
- P0 排期只做当前单元快速安排、完成后的下一候选、自动顺延、默认单元数与冲突提示，不隐式生成整周；容量默认软约束，老师确认优先。
- 测试金字塔要求领域/属性、Modulith 模块、真实 PostgreSQL Testcontainers、OpenAPI、前端组件、Playwright、Tauri smoke、性能/恢复/安全；H2 不可替代数据库集成测试。
- PR 门禁共十类：前端 lint/format/strict/tests，后端 compile/style/unit，Modulith verify，Testcontainers，OpenAPI diff，Flyway 空库/上一版，Playwright，依赖/许可证/安全，Web/API/Tauri 构建。
- 迁移采用 Expand/Contract；已应用 Flyway 文件不可改，失败优先前滚；备份 P0 RPO≤24h、RTO≤4h并至少季度恢复演练。
- SDD 实施顺序与 ADR 已冻结为 Foundation → Core Domain → Execution Workbench → Operationalization；核心 ADR 为模块化单体、薄桌面壳、模板/轨道/实例分层、顺延新实例、PostgreSQL 搜索、自定义工作台、服务端真值、发布模板不可变。
- WBS Phase 0 共 19 项基础任务，退出门禁要求干净环境启动、Web/Tauri 登录、`/context` 业务日期、Modulith/真实 PostgreSQL/Flyway/RBAC/组织隔离、SBOM/许可证扫描；禁止用业务假页面冒充完成。
- WBS P0-FND-001 的直接初始化验收是单命令 Web+API+PostgreSQL、单命令 Tauri dev、锁文件、无 secret；同时要求 EditorConfig、格式化、README、统一脚本和 CI 干净构建三端。
- WBS Phase 1 的退出闭环是学生资料与周计划、独立三入口、不可变模板、现有 Excel 预览/导入、挂载固定版本轨道/进度，以及迁移/租户/并发测试。
- WBS Phase 2 将执行闭环细化为真实 Today、虚拟化多学生 Grid、临时任务、挂载/安排、幂等完成、顺延历史、统一改期服务、单学生三视图，并要求 AC-001~~009/011/013~~014、60×14 性能和键盘可访问性。
- WBS Phase 3 的退出门禁为搜索反向查询、生词闭环、权限/越权/审计/脱敏、性能/大批日结、Tauri 签名更新、恢复演练、AC-001~015、UAT 无 Blocker/Critical。
- 最终里程碑不是页面数量，而是四项证明：轨道版本/进度历史稳定；完成在重复/并发下只推进连续前缀；顺延到下一可学习日且链路可见；助教可用“勾、拖、写、挂”脱离原 Excel。
- 字段/API/组件/迁移均有逐项门禁：每个端点需 operationId/schema/permission/scope/idempotency/version/audit/error/tests/generated client/mock/E2E；核心 operationId 首次发布后冻结。
- 2026-08-16 版本探测确认 Spring Boot 4.1.0 与 Spring Modulith 2.1.0 已正式发布且精确配对；前端当前稳定线含 React 19.2.8、Vite 8.2.1、Vitest 4.1.10、Tauri CLI 2.11.4/API 2.11.1，Node 26.4 满足引擎要求。
- 本机 Tauri 构建前置完整：Rust 1.96.1、VS Build Tools 2022/MSVC/Windows 11 SDK、WebView2、WiX、NSIS 均可用；普通 shell 中 cl 不在 PATH 不影响 Cargo 自动发现。
- apps/web 与 apps/desktop 分离时，Tauri `frontendDist` 从 `src-tauri` 解析为 `../../web/dist`；beforeDevCommand/beforeBuildCommand 应调用 web workspace，业务组件通过 PlatformAdapter 隔离 Tauri API。
- 工具链兼容性取舍：typescript-eslint 8.67 支持 ESLint 10 但 TypeScript `<6.1`，因此暂锁 TypeScript 6.0.3 而不追 TS 7；Vite 8 与 `@vitejs/plugin-react` 6 可配套，Node 26 满足 jsdom 30/Vite/ESLint 引擎要求。

## 2026-08-18 Cross-Phase Adversarial Audit

- Confirmed critical import defect: `ImportService.uploadAndPreview` persists a UUID job but `ImportPreview` omits it; `ImportPage.handleExecute` sends `fileSha256` to a UUID path. The execute workflow cannot succeed.
- Confirmed local-start topology mismatch: Vite development disables auth while `scripts/dev-stack.mjs` starts the API without the `dev` profile, so the documented quick start cannot pass authenticated `/context`.
- Confirmed desktop completion evidence is absent: the packaged bundle has no injected API base, refresh tokens use WebView `sessionStorage`, and Tauri has no secure credential/updater capability or smoke gate.
- Confirmed AC-007 client gap: schedule drag only pre-checks availability and does not surface backend `DEVICE_POLICY_CONFLICT` as an override workflow.
- Confirmed AC-008/014 client gap: task detail remains a placeholder toast and carry-over rows do not expose navigable source/target history.
- Confirmed quality-gate gap: CI lacks Playwright/accessibility/AC acceptance, OpenAPI drift, Cargo fmt/clippy/test, SBOM/license/security, packaged signing/update, backup/restore and performance evidence.
- Backend audit leads requiring main-agent verification: path/body identifier mismatch, weak idempotency binding, carry-over forward-date/source-type issues, unchecked undo target update, shrinking-set OFFSET in day-close, and destructive migration history.
- Existing uncommitted edits in task repository, exception handler, schedule, task card, Today and workbench predate this audit turn; preserve and integrate them.

## Technical Decisions

| Decision                                                                         | Rationale                                                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 以三份文档共同约束为验收基线                                                     | 避免只按单一文档实现而遗漏跨层约定                                              |
| 首先搭建 workspace、web、api、desktop、infra、scripts 骨架                       | 对齐 SDD 拓扑并为后续并行开发提供边界                                           |
| 第一垂直切片优先健康检查与统一开发入口                                           | 在依赖不完整时仍可验证工程边界与可运行性                                        |
| Phase 0 第一批范围覆盖 P0-FND-001/003/005/007/008/015/016/017/019 的可脚手架部分 | 这些任务共同定义可持续开发骨架；数据库、认证完整实现仍依赖 Java/PostgreSQL 环境 |

## Issues Encountered

| Issue                        | Resolution                                 |
| ---------------------------- | ------------------------------------------ |
| 空仓库无法直接运行文档中命令 | 先初始化脚手架与脚本，再按可用工具分层验证 |

## Resources

- `DocsHarness/01_助教工作台_PRD_需求与竞品研究_v1.0.md`
- `DocsHarness/02_助教工作台_SDD_开发设计与架构_v1.0.md`
- `DocsHarness/03_助教工作台_WBS_实施任务与测试计划_v1.0.md`

## 2026-08-16 Implementation Reconciliation

- 当前代码已远超旧计划：单仓、三端构建、统一检查、上下文/错误契约、基础认证、学生/模板领域、真实 PostgreSQL CI 集成门禁均已实现。
- `pnpm check` 最近一次通过格式、Web lint/typecheck/test、共享包 TypeScript、API 测试/架构、Cargo fmt/clippy；Web build 也通过。需在本轮修改前后重新取得证据。
- Vite 已从根 `.env` 加载；`dev-stack` 的 Windows `pnpm.cmd` EINVAL 已修复。无 PostgreSQL 时 API 最终在 `127.0.0.1:5432` 连接失败，符合环境事实。
- 身份认证仍是关键缺口：`AuthProperties` 只表示单个配置用户；`AuthSessionStore` 使用进程内 map；`TenantContextFilter` 用静态组织配置；角色分配表与账户状态没有被读取。
- V001 虽有 `organization`、`user_account`、`user_role_assignment`，但没有 auth session、失败计数/锁定时间、组织/用户 bootstrap；默认组织未插入时学生/模板外键写入可能失败。
- RBAC 目前仅 controller 角色判断；ASSISTANT 仍能访问组织内全部学生，`STUDENT_SET` 数据范围没有结构化 JOIN/EXISTS 实现，跨组织 IDOR 和账户禁用/角色变更后的 token 失效也未证明。
- Web refresh token 存于 `sessionStorage`，access token 在模块内存；仅启动时 refresh，没有 401 单飞刷新/重试与基于权限的菜单守卫；Tauri 尚无系统安全存储适配。
- 模板发布/学生 CRUD 已建立 Phase 1 基础，但常规周/具体周 API、模板编辑器、Excel 预览导入、轨道挂载/进度、Today/执行/顺延均未完成。

## 2026-08-16 Phase 1 Implementation Round 2

- 用户确认本地应用模式，跳过数据库身份验证/RBAC/持久会话/安防门禁。
- 并发子代理实现了：周计划 API（WeekPlanService/Repository）、学生详情页（StudentProfilePage）、轨道挂载与任务实例（TrackService/SchedulingService/TrackController + V004 迁移）。
- 直接实现了 Excel 导入：ExcelTemplateParser（POI 5.4.1）、ImportService、ImportController、ImportPage 前端页面 + V005 迁移。
- 模板详情页（TemplateDetailPage）已实现：版本列表、草稿单元编辑器、发布按钮、创建新草稿。
- 所有检查通过：format、lint、typecheck、web tests (4/4)、API tests (17/17)、cargo fmt/clippy。
- 审计代理正在后台运行，审计后端业务规则和前端 PRD 覆盖度。
- 文档歧义集中在日结时间、多助教访问关系、认证方式、并发契约、locked 手动改期权限、CONFIRM 设备、容量策略、同日并行、Correction API、Linux 发布范围与 Excel 验收强度。实现时采用更强门禁且把未冻结项显式保留。
