# Task Plan: 助教工作台全量实现

## Goal

以 `DocsHarness/` 中 PRD、SDD、WBS 为唯一产品/架构基线，持续实现并验证助教工作台，直到满足 PRD AC-001~~015、WBS Phase 0~~3 退出门禁和“轨道稳定、推进幂等、顺延可追溯、勾/拖/写/挂可用”四项业务证明。

## Current Phase

跨阶段回归审计（进行中；代码覆盖面较广，但 Foundation、Core Domain、Execution、Operationalization 均存在尚未闭合或缺少强证据的门禁）

## Phases

### Phase 0: Foundation

- [x] pnpm 单仓、Web/API/Tauri/共享包/基础设施/脚本骨架
- [x] React/Vite、Spring Boot/Modulith、Tauri 三端构建与统一检查入口
- [x] `/api/v1/context`、Problem Details、requestId、CORS、配置校验
- [x] 登录/刷新轮换/退出的基础契约与 Web 启动门禁
- [x] PostgreSQL 18/Flyway 迁移定义与 CI 强制集成测试
- [~] 数据库身份、持久会话和 Web refresh 基础已实现；RBAC/数据范围、桌面安全凭据和真实 PostgreSQL 证明待闭合
- [x] Tauri Capability 最小化、PlatformAdapter 隔离
- [x] CI 基线：lint/unit/module verify/Testcontainers/OpenAPI/依赖扫描
- **Status:** in_progress

### Phase 1: Core Domain

- [x] 学生 CRUD、默认七天常规周、组织过滤与乐观版本
- [x] 模板草稿、连续单元替换、校验和、发布与已发布版本不可变
- [x] 学生列表/新建、资料/生词/排期独立入口和模板列表 API 真值
- [x] 常规周/具体周 API 与 UI（WeekPlanService/Repository 已实现）
- [x] 学生详情和三入口的真实业务页面（StudentProfilePage 已实现）
- [x] 模板详情/草稿编辑器（TemplateDetailPage 已实现）
- [x] Excel 上传、解析、预览、错误定位和幂等导入（ImportService/ImportPage 已实现）
- [x] 固定模板版本的学生轨道挂载、进度与事务一致性（TrackService/SchedulingService 已实现）
- [ ] 轨道挂载 UI（前端页面）
- [ ] 迁移/索引/租户/并发真实 PostgreSQL 测试
- **Status:** in_progress

### Phase 2: Execution

- [x] Today 聚合读模型、临时任务与多学生双密度工作台（TodayService + TodayPage 已实现）
- [x] 挂载/安排、Checklist、幂等完成与连续前缀推进（ExecutionService 已实现）
- [~] 重开、改期/拖拽共用服务、自动顺延与可见历史链（ExecutionService 已实现基础，拖拽 UI 待完成）
- [ ] 单学生日/周/月排期
- [ ] AC-001~~009、011、013~~014、60×14 性能与键盘可访问性门禁
- **Status:** in_progress

### Phase 3: Operationalization

- [x] 搜索、反向查询与 PostgreSQL FTS/trigram 可重建读模型（SearchService + DateQueryParser 已实现）
- [x] 生词闭环与周汇总（VocabularyService + VocabularyPage 已实现）
- [ ] 权限、越权、审计、脱敏、性能和大批日结门禁
- [ ] Tauri 签名/更新/回滚与备份恢复演练
- [ ] AC-001~015、UAT Blocker/Critical=0 和已知限制签收
- **Status:** in_progress

### Final Acceptance

- [ ] 版本化轨道在模板后续发布后仍保持稳定历史
- [ ] 完成命令在重复/并发下只推进连续已完成前缀
- [ ] 顺延到下一可学习日且来源/目标链路可见
- [ ] 助教通过“勾、拖、写、挂”可脱离原 Excel 工作流
- [ ] 三端构建、CI/安全/恢复证据与运行文档完整
- **Status:** pending

## Current Iteration

1. 对阶段门禁、后端不变量、前端/Tauri/CI 进行并发对抗审计。
2. 复核并修复 Excel 执行标识、本地启动认证拓扑及后端事务级阻断项。
3. 补齐任务详情/顺延链、设备冲突、桌面安全存储与可验证 CI 门禁。
4. 运行全量门禁后再次并发审计；审计仍有问题则进入下一轮。

## Decisions Made

| Decision                                                    | Rationale                                         |
| ----------------------------------------------------------- | ------------------------------------------------- |
| 最终验收采用 AC-001~015、四阶段门禁和四项业务证明三重基线   | 避免以页面或单元测试数量代替真实闭环              |
| 先完成 Foundation 数据库身份与授权，再扩展 Phase 1          | 当前静态组织/单用户会让后续所有租户与审计证明失真 |
| 中心 PostgreSQL 身份/RBAC/持久会话/租户隔离均为硬门禁      | PRD/SDD/WBS 明确采用中心数据库在线协作架构        |
| Access token 保持内存；Refresh token 仅持久化哈希并轮换     | 对齐 SDD 安全边界与现有 token 契约                |
| Docker 缺失是本机环境阻塞，不降低 CI 的真实 PostgreSQL 门禁 | H2/Mock 不能替代 PostgreSQL/Flyway 证据           |
| 三份 DocsHarness 文档保持只读                               | 基础文档是需求事实源，不因实现方便而改写          |

## Open Product Decisions

- 日结默认 05:00 目前按 SDD 默认值实现，仍需产品确认。
- 学生是否允许多个助教共同负责、CONFIRM 设备语义、硬容量策略、同日并行单元数仍需在对应 Story DoR 前冻结。
- 并发契约统一采用 `If-Match` 还是 body `expectedVersion` 尚待 ADR；当前不得混用新端点。

## Errors Encountered

| Error                                                 | Attempt | Resolution                                                    |
| ----------------------------------------------------- | ------: | ------------------------------------------------------------- |
| 本机无系统 Java/Gradle                                |       1 | 项目内 `.tooling/jdk-21` + Gradle wrapper 已可执行            |
| 本机无 Docker/Compose/PostgreSQL                      |       1 | CI 强制 Testcontainers/PostgreSQL；本机保留显式失败证据       |
| Windows `dev-stack` 直接 spawn `pnpm.cmd` 触发 EINVAL |       1 | 仅 pnpm 子进程通过 `cmd.exe` 启动，已验证进入 API DB 连接阶段 |
| 5173 端口曾被已有 Vite listener 占用                  |       1 | 记录为环境冲突；复测前先确认并清理项目遗留进程                |
| 过往规划文件未同步大量实现进展                        |       1 | 2026-08-16 根据代码/探查结果重建阶段计划                      |
| `rg.exe` 被 Windows App 权限拒绝                      |       1 | 改用 PowerShell `Get-ChildItem`/`Select-String` 定点检索      |
| 两条首轮审计代理受 429 中断                           |       1 | 采用其已返回证据并由主代理定点复核；未把中断视为通过           |

## Guardrails

- 每一轮重大取舍前重读本计划；每个实现切片后更新 `progress.md` 和 `findings.md`。
- 不宣称 Phase 0 完成，直到数据库身份/RBAC/租户/种子/安全和真实 PostgreSQL 证据满足门禁。
- 不创建前端假 Today、假顺延或假轨道数据冒充业务完成。
