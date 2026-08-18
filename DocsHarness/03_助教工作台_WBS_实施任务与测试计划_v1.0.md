# 助教工作台实施任务与测试计划（WBS）

> 文档版本：v1.0  
> 文档状态：实施基线  
> 编制日期：2026-08-16  
> 上游文档：PRD v1.0、SDD v1.0  
> 目标：把架构和业务规则拆成可以创建 Issue、开发、评审、测试和验收的工作包

---

# 0. 使用说明

## 0.1 任务层级

```text
Phase（阶段）
└── Epic（工作包）
    └── Story/Task（可开发任务）
        └── Test Case / Acceptance（测试与验收）
```

任务编号：

- `P0-FND-*`：基础设施；
- `P1-STU-*`：学生与学习条件；
- `P1-CUR-*`：模板与导入；
- `P1-TRK-*`：任务轨道；
- `P2-TDY-*`：今日工作；
- `P2-WBK-*`：学生工作台；
- `P2-EXE-*`：完成、改期和顺延；
- `P2-CAL-*`：单学生日历；
- `P3-SRC-*`：全局搜索；
- `P3-VOC-*`：生词本；
- `P3-SEC-*`：权限与审计；
- `P3-OPS-*`：部署、桌面、运维与上线。

## 0.2 任务字段

每个任务至少包含：

- 目标；
- 上游需求；
- 依赖；
- 后端/前端/数据库/桌面工作；
- 关键不变量；
- 测试要求；
- 验收标准；
- 交付物；
- 复杂度：S/M/L/XL，仅用于相对比较，不是工期承诺。

## 0.3 全局 Definition of Ready

任务开始前必须具备：

- 对应 PRD FR/BR 或明确技术债编号；
- 数据模型/API 草案；
- 交互原型或状态说明；
- 权限、审计、错误和空状态要求；
- 测试数据；
- 依赖任务已完成或有 mock 契约。

## 0.4 全局 Definition of Done

任务完成必须满足：

- 代码评审通过；
- 模块边界验证通过；
- TypeScript strict/Java compile/lint 通过；
- 数据迁移可从空库和上一版本执行；
- 单元、集成和必要 E2E 通过；
- OpenAPI 与生成客户端无漂移；
- 权限、租户、并发和幂等已测试；
- 审计/日志/指标已接入；
- 无阻断级可访问性、安全和许可证问题；
- 文档、运行手册和 release note 更新；
- 产品按验收场景确认。

---

# 1. 阶段总览

| 阶段 | 目标 | 退出条件 |
|---|---|---|
| Phase 0：Foundation | 建立可持续开发、部署和桌面运行骨架 | Web/API/Tauri 可登录；模块/迁移/CI/安全基线通过 |
| Phase 1：Core Domain | 建立学生、周计划、模板、Excel 导入和学生任务轨道 | 能把 Excel 转模板并挂载给学生，数据结构稳定 |
| Phase 2：Execution Workbench | 完成 Today、学生矩阵、日历、Checklist、改期、自动顺延 | 形成“挂载—安排—完成/顺延—下一单元”的闭环 |
| Phase 3：Operationalization | 搜索、生词、权限审计、性能、桌面签名、备份和试运行 | 通过 UAT、恢复演练和发布门禁，可投入真实助教试用 |

各阶段至少包含四个独立工作包，任何阶段不得仅以“页面做完”作为退出条件。

---

# 2. Phase 0 — Foundation

## Epic P0-FND-01：单仓库与开发环境

### P0-FND-001 创建仓库骨架

**目标**：建立 SDD 规定的 `apps/web`、`apps/desktop`、`apps/api`、`packages`、`docs`、`infra`。  
**上游**：SDD §4。  
**复杂度**：M。

工作项：

1. 初始化 Git、分支保护、CODEOWNERS；
2. 初始化 pnpm workspace；
3. 初始化 React/Vite/TypeScript strict；
4. 初始化 Spring Boot Gradle Kotlin DSL；
5. 初始化 Tauri 2 并引用 web build；
6. 添加 EditorConfig、格式化和统一脚本；
7. README 包含本地启动、测试、环境变量和故障排查。

验收：

- 一条命令启动 Web + API + PostgreSQL；
- 一条命令启动 Tauri dev；
- 新环境不需要手工改源码；
- 锁文件全部提交；
- 无示例密码或 secret。

测试：CI 在干净环境完整构建三端。

### P0-FND-002 Docker Compose 本地依赖

创建 PostgreSQL 18、可选 MinIO、OpenTelemetry Collector profile。数据库健康检查完成后 API 才启动；数据卷和重置脚本清楚区分。

验收：

- `compose up` 后 Flyway 自动迁移；
- 重启不丢数据；
- `make reset-local-data` 明确二次确认；
- 使用非默认生产密码模板，开发 secret 不进入版本库。

### P0-FND-003 统一配置系统

后端使用 Spring profile/环境变量；前端只暴露 `VITE_*` 非敏感配置；Tauri API endpoint 使用签名构建配置。创建配置校验，缺少关键项启动失败。

测试：错误配置、未知时区、无效 URL、空 JWT key 均 fail fast。

### P0-FND-004 示例数据与测试 Fixture

建立 Fixture Builder，不直接复用生产导入文件：Organization、Admin、Assistant、3 名学生、3 个模板、若干轨道与任务。测试数据确定性生成。

验收：`seed-dev` 可重复运行且幂等；生产 profile 不暴露该命令。

## Epic P0-FND-02：模块化单体骨架

### P0-FND-005 创建 Spring Modulith 模块

创建 identity、student、curriculum、planning、execution、vocabulary、search、importexport、audit、shared 包与 `package-info.java`。标记公开接口/NamedInterface。

验收：`ApplicationModules.verify()` 通过；模块图可生成；禁止循环依赖。

### P0-FND-006 模块边界 CI 门禁

添加架构测试：

- web/controller 不被其他模块调用；
- infrastructure 不跨模块引用；
- domain 不依赖 Spring MVC；
- search 不写主业务表；
- audit 不被业务反向读取驱动状态。

故意添加一次非法依赖验证测试能失败，然后移除。

### P0-FND-007 统一错误模型

实现 RFC Problem Details：code、requestId、fieldErrors、current。建立 DomainException 到 HTTP 状态映射。

测试：400/401/403/404/409/422/500；500 不泄露堆栈和 SQL。

### P0-FND-008 时钟、ID、TenantContext

提供 `BusinessClock`、`IdGenerator`、`TenantContext`、`ActorContext` 可替换接口。测试中固定时钟，不直接调用 `Instant.now()`/`LocalDate.now()` 进入领域代码。

验收：全仓静态扫描/评审确保领域层不自行读取系统默认时区。

## Epic P0-FND-03：数据库与迁移基线

### P0-FND-009 Flyway 基线

创建 organization、user_account、role_assignment、idempotency_record、audit_event 基础表及 extension（如 pg_trgm）。

要求：

- 通用字段一致；
- 外键/检查/唯一/索引有明确名称；
- 不使用 `ddl-auto=update`；
- migration 从空库可执行。

### P0-FND-010 JPA 审计与乐观锁

实现统一审计监听或 mapped superclass；organizationId 不能由客户端任意覆盖；`@Version` 映射 bigint。

测试：创建/更新 actor；并发更新抛 409；系统任务 actor。

### P0-FND-011 Testcontainers 数据库测试骨架

CI 启动 PostgreSQL 18，执行 Flyway，运行 repository tests。禁止 H2 作为 PostgreSQL 行为替代。

测试覆盖：JSONB、trigram extension、partial unique index、timestamptz/date。

### P0-FND-012 上一版本升级测试框架

建立 `db-snapshots`/Test Migration Harness。每次发布保留上一版本 schema fixture；CI 验证 upgrade。首版先建立流程。

## Epic P0-FND-04：认证、Context 与桌面壳

### P0-FND-013 本地认证

实现登录、刷新、登出、会话撤销、密码哈希和失败限制。创建 Admin bootstrap，只能通过安全初始化流程。

测试：正确/错误密码、锁定、停用、refresh rotation、登出后失效、跨组织用户名策略。

### P0-FND-014 RBAC 基础

实现角色和权限枚举、方法级授权、DataScope 接口。P0 角色：ADMIN、LEAD_TEACHER、ASSISTANT、VIEWER。

测试：每个角色访问 `/context`、学生列表和管理接口；前端隐藏不是测试替代。

### P0-FND-015 `/context` 接口

返回用户、组织、businessDate、timezone、dayCloseTime、permissions、featureFlags、客户端最低兼容版本。

验收：React 启动前先读取 context；业务日期不由浏览器本地决定。

### P0-FND-016 React 应用框架

创建 TopNavigation、路由、QueryClient、AuthProvider、ErrorBoundary、全局通知、空/加载/错误状态。导航仅显示今日工作、学生工作台、任务模板和搜索。

### P0-FND-017 Tauri Capability 与 PlatformAdapter

实现文件选择、保存、通知、版本、单实例的 adapter；capability 最小化；禁用 shell。

测试：浏览器 adapter 与 Tauri adapter 契约一致；未授权文件路径调用失败。

### P0-FND-018 桌面凭据与登出

access token 内存，refresh token 安全存储；登出清理。日志扫描不得出现 token。

### P0-FND-019 CI 基线

流水线包括 lint、unit、module verify、Testcontainers、OpenAPI diff、dependency/license scan、web/api/tauri build。

### Phase 0 退出门禁

- [ ] 干净环境可启动；
- [ ] Tauri 和浏览器都能登录；
- [ ] `/context` 返回业务日期；
- [ ] Modulith 验证和 PostgreSQL 集成测试通过；
- [ ] Flyway 从空库运行；
- [ ] 基础 RBAC 和组织隔离测试通过；
- [ ] SBOM/许可证扫描可运行；
- [ ] 无业务页面假实现被误认为完成。

---

# 3. Phase 1 — Core Domain

## Epic P1-STU-01：学生资料与入口语义

### P1-STU-001 student 表与实体

实施 SDD `student` 字段、索引、状态和归档。Repository 所有查询默认 organization 过滤。

测试：studentCode 唯一、跨组织同 code 可用、归档不在默认列表、乐观锁。

### P1-STU-002 学生 CRUD API

实现创建、读取、更新、归档。DTO 不暴露内部密码/权限字段；note 权限可配置。

验收：符合 FR-PROFILE-002；错误返回字段级信息。

### P1-STU-003 学生列表查询

支持姓名/别名、状态、主要助教、标签、设备政策筛选；分页和稳定排序。

测试：中文名、大小写英文别名、空查询、跨租户、无权限学生。

### P1-STU-004 StudentIdentityActions

前端实现姓名、`生词本`、`排期` 三个独立可聚焦控件；不使用整行 click。

组件测试：

- 点击姓名只触发 profile；
- 点击生词本只触发 vocabulary；
- 点击排期只触发 schedule；
- Tab 顺序正确；
- 屏幕阅读器名称正确。

### P1-STU-005 学生资料 Drawer/Route

实现基本资料表单、状态、标签、助教、设备政策、学科倾向占位区。关闭恢复列表位置。

验收：未保存提示、409 冲突、权限只读模式。

## Epic P1-STU-02：常规周与具体周计划

### P1-STU-006 常规周数据表

创建 weekly_pattern 与 day 子表；7 天唯一、分钟检查、effective 范围。

### P1-STU-007 常规周 API 与服务

替换 ACTIVE pattern，不修改历史。新学生默认 7 天 available=true；分钟默认由组织设置或 0。

测试：生效区间重叠、少于/多于 7 天、负分钟、设备覆盖。

### P1-STU-008 周计划数据表

创建 week_plan/day_availability；weekStart 必须周一；日期必须落在周内；学生+日期唯一。

### P1-STU-009 复制常规周/上周

实现 BASE_PATTERN、PREVIOUS_WEEK、MANUAL 来源。已有 DRAFT 可显式替换；CONFIRMED 不允许无提示覆盖。

### P1-STU-010 周计划编辑 UI

7 行：勾选、分钟、设备覆盖、备注。默认全部勾选；用户取消不可学习日。支持“复制上周”和“恢复常规”。

测试：键盘、批量勾选、保存草稿、确认、服务端错误。

### P1-STU-011 Effective Availability 查询

实现优先级：具体日→常规周→组织默认。提供模块 API 给 planning。

属性测试：随机周计划下结果符合覆盖规则。

### P1-STU-012 Schedule Impact Preview 骨架

先返回未来已排任务和冲突，不在 Phase 1 自动移动。前端显示影响列表。

## Epic P1-CUR-01：任务模板与版本

### P1-CUR-001 模板/版本/单元迁移

按 SDD 建表、约束、索引。已发布版本不可通过普通 repository update 修改。

### P1-CUR-002 创建模板与草稿

API + UI：名称、code、简称、科目、单位、默认分钟、设备。创建 version 1 DRAFT。

### P1-CUR-003 草稿单元表格编辑

高密度表格支持 ordinal、code、title、shortTitle、duration、device、contentRef；支持粘贴多行、插入、删除、重排。

要求：

- 所有编辑在草稿；
- 本地校验后整集合提交；
- 服务端重新编号或拒绝不连续，策略在 UI 明示；
- 大于 500 单元时虚拟化。

### P1-CUR-004 发布模板

实现 publish 事务、checksum、itemCount、currentPublishedVersion、事件和审计。

测试：空版本、ordinal 缺口、重复 itemCode、并发发布、重复幂等键、已发布不可改。

### P1-CUR-005 从发布版创建下一草稿

完整复制单元但生成新 ID；保留 itemCode；版本号递增。

### P1-CUR-006 模板列表/详情

列表显示总单元、默认时间、设备、版本、状态；详情显示单元与 usage 占位。

## Epic P1-IMP-01：Excel 模板导入

### P1-IMP-001 上传与文件安全

实现 xlsx 上传、大小/工作表/行列/字符串限制、SHA-256、隔离存储、ZIP bomb 防护。

### P1-IMP-002 流式解析器

针对“作业进度目录”读取列头、第二行元数据、后续非空单元。写单元测试使用用户结构的脱敏 fixture。

### P1-IMP-003 元数据解析建议

支持 `1P/30/1hour`、`1Day/30/30mins`、`每篇20分钟`、`1个场景/26/5页1hour` 等；无法解析保留原文并标 warning。

### P1-IMP-004 导入预览 UI

逐列显示：目标模板、推断单位/总量/时长、非空数、前后样例、错误。用户可选择新建/更新草稿/忽略。

### P1-IMP-005 导入执行

每列一个事务调用 CurriculumService；已发布模板不覆盖；错误记录到 import_row_error。

### P1-IMP-006 导入进度与报告

异步 job、轮询或 SSE、成功/部分/失败；错误 CSV；审计 file hash 和 mapping。

### P1-IMP-007 现有 Excel 验收

使用提供文件验证至少生成：阅读词汇 30、长难句 30、机经示例 30、807 词汇 26、写作观点 27、口语 Part3 74、写作词伙 25 个有效非空单元（原表另有 1 个仅包含空格的单元，导入时应按空值处理）。总量声明与非空单元不一致时提示而不伪造单元。

## Epic P1-TRK-01：学生任务轨道

### P1-TRK-001 轨道表与实体

实现状态、start/current/end、版本绑定、单位数、策略、优先级和乐观锁。

### P1-TRK-002 MountTrack 服务/API

校验学生/模板/版本/ordinal/重复轨道；支持 warnings + confirm override；创建首批实例为可选。

### P1-TRK-003 挂载 UI

从模板详情或 Quick Add 入口：学生、起始单元、结束单元、开始日期、每次单元数、策略。选择学生时显示已有同模板轨道。

### P1-TRK-004 Track Progress 组件

显示短名、current/end、百分比、状态、下一单元。完成状态为 100%；未知总量不显示误导百分比。

### P1-TRK-005 暂停/恢复/取消

明确处理现有 PENDING 的选项。所有操作审计。

### P1-TRK-006 指针算法单元测试

覆盖：单项、连续多项、乱序、重复、结束、skip、reopen。目标覆盖率不是唯一门禁，所有不变量必须断言。

### P1-TRK-007 轨道列表 API

按学生返回活跃/暂停/完成；按模板返回 usage。分页历史轨道。

### Phase 1 退出门禁

- [ ] 学生资料、常规周、具体周计划可用；
- [ ] 姓名/生词本/排期三个入口语义通过测试；
- [ ] 可以创建、编辑、发布不可变模板；
- [ ] 提供 Excel 可预览并生成正确模板；
- [ ] 可以给学生挂载指定版本轨道并显示进度；
- [ ] 核心表迁移、索引、租户和并发测试通过；
- [ ] 尚未实现的 Today/顺延不得用前端假逻辑代替。


---

# 4. Phase 2 — Execution Workbench

## Epic P2-EXE-01：每日任务实例与快速录入

### P2-EXE-001 task_instance 迁移

实现 SDD 字段、状态 CHECK、外键、索引和 partial unique pending track item。迁移测试必须证明 PostgreSQL 约束生效。

测试：

- TRACK 缺 track/item 拒绝；
- AD_HOC 带 track 拒绝；
- 同轨道同单元两个 PENDING 拒绝；
- 历史 CARRIED_OVER 后允许新 PENDING；
- completed 必须有完成字段由领域/API保证并通过集成测试。

### P2-EXE-002 CreateAdHocTask 服务/API

自由文本、日期、学生、分钟、设备、锁定。title trim、长度限制；默认 scheduleOrigin=MANUAL。

测试：空白、超长、无权限学生、不可学习日 warning、重复 idempotency。

### P2-EXE-003 ScheduleTrackItems 服务/API

为连续 ordinal 创建独立实例，支持 unitCount。默认从 currentOrdinal 开始；manual skip 需权限和原因。

测试：

- unitCount 1/2/超范围；
- 已有 PENDING 返回/冲突策略；
- 非连续拒绝；
- 设备/容量 warning；
- 同事务全部成功或全部失败。

### P2-EXE-004 InlineTaskComposer

实现三类项：自由文本、模板、模板单元。最近使用可先本地，收藏后续持久化。

组件测试：输入、debounce、键盘选择、回车自由文本、模板打开挂载、保存后焦点恢复、网络失败保留输入。

### P2-EXE-005 Task Detail Drawer

显示 title、学生、日期、状态、来源、轨道/ordinal、历史链、预计分钟、设备、锁定、审计摘要。操作按钮按状态与权限显示。

### P2-EXE-006 锁定/解锁

API + UI；锁定任务显示图标；自动流程跳过；改期需要权限。

## Epic P2-TDY-01：今日工作

### P2-TDY-001 Today Read Model SQL

实现一次请求返回统计、学生分组、身份按钮数据、availability、任务列表和容量。

要求：

- organization/data scope 强制；
- 任务排序：异常/顺延、锁定、轨道优先级、创建顺序；
- 不通过 JPA 循环；
- 返回 task version。

数据库测试：60 学生、500 当日任务查询计划和 SQL 数量。

### P2-TDY-002 Today API

`GET /today` 支持 date、assistant、status、subject、search。日期越界和无效时区错误明确。

### P2-TDY-003 Today 页面框架

DateNavigator、MetricBar、FilterBar、StudentTaskGroup。默认当前业务日期；前后日和回今天。

### P2-TDY-004 学生组头

展示姓名、Vocabulary Button、Schedule Button、设备标签、分钟容量。姓名仍是 Profile Button。

组件测试重用 StudentIdentityActions 契约。

### P2-TDY-005 Checklist Row

任务前 Checkbox，显示 completing 状态、来源、轨道 ordinal、预计分钟、锁定、顺延标记。操作菜单包含详情、改期、取消、锁定。

### P2-TDY-006 空状态与异常状态

- 今日无任务；
- 无负责学生；
- 只读角色；
- 数据部分加载失败；
- 已离线缓存；
- server businessDate 与用户预期不同时显示绝对日期。

### P2-TDY-007 Today 统计点击筛选

点击“昨日顺延”等自动设置过滤；URL 可分享/恢复；清除筛选明确。

### P2-TDY-008 批量任务操作（P1 Feature Flag）

实现多选、批量预览和 `POST /task-instances:batch` 客户端。P0 默认关闭 Feature Flag；P1 开放改期、取消、锁定/解锁，批量完成仅对明确允许的同质任务开放。

后端要求：单批最多 200 项；逐项复用现有命令；逐项权限、expectedVersion 和幂等；返回成功/冲突/禁止/失败清单。前端必须在提交前显示动作、目标日期和受影响学生，不允许“一键静默处理”。

测试：混合权限、版本冲突、重复提交、部分失败、批次中含已完成/锁定任务、键盘选择、撤销入口。

## Epic P2-WBK-01：学生工作台数据与 Grid

### P2-WBK-001 Workbench Read Model

实现日期范围 + 学生分页/游标。一次返回学生、每天 availability、tasks、vocab count、tags。

限制：默认 7 天，最大 31 天；多学生月矩阵禁止。

### P2-WBK-002 Grid 数据适配层

将 API DTO 转为稳定 row model。建立 query keys：organization、range、filter、density。避免每个 checkbox 重建所有 rows。

### P2-WBK-003 Frozen Student Column

显示姓名、生词本、排期、标签、助教。sticky 与横向滚动稳定。

测试：窄屏、省略、按钮焦点、横向滚动、不触发行 click。

### P2-WBK-004 Virtual Date Columns

TanStack Virtual 渲染可见日期列，支持 7/14/31 天范围。保持日期 header 与 cell 对齐；滚动到今天。

性能基准：60 行 × 14 天含平均 4 tasks/cell，交互无明显长任务；记录 profiler 基线。

### P2-WBK-005 Compact View

格子显示前 2—3 条 shortTitle、状态点和 +N；点击格子打开 Cell Popover，不直接误完成。

### P2-WBK-006 Expanded View

显示 checkbox、任务标题、时长、来源、菜单；行高受控；任务多时 cell 内滚动或展开。

### P2-WBK-007 密度切换与偏好

切换保持学生/日期滚动位置；保存用户偏好；URL/本地偏好优先级明确。

### P2-WBK-008 学生筛选

姓名、助教、设备、标签、科目倾向、冲突、逾期。服务端筛选；高频条件有索引。

### P2-WBK-009 Quick Add Drawer

默认收起；常用模板、最近、搜索、临时任务。完整几百单元不默认加载。拖模板到学生行触发 mount form。

### P2-WBK-010 Grid 可访问性替代

每个拖拽有菜单“移动到日期”；键盘可打开格子、勾选和添加；ARIA row/column label。自动化 axe 测试 + 人工键盘检查。

## Epic P2-EXE-02：完成、重新打开和轨道推进

### P2-EXE-007 CompleteTask 事务

实现行锁、幂等、状态检查、轨道指针重算、审计、事件。固定锁顺序并写注释/测试。

### P2-EXE-008 Complete API

要求 `If-Match`/version 与 Idempotency-Key。响应返回 task、track summary、next candidate 和 updated statistics hint。

### P2-EXE-009 前端乐观完成

TanStack Query onMutate/onError/onSuccess。只乐观任务视觉，不擅自 +1 指针；成功使用服务端 track。

测试：成功、500、409、重复点击、离线、两页面同一任务缓存失效。

### P2-EXE-010 连续多单元推进

服务端查询完成 ordinals 并推进到第一个缺口。集成测试并发完成 8/9 顺序互换。

### P2-EXE-011 ReopenTask

安全回退条件、纠错错误码。UI 取消勾选前如果会影响轨道，显示说明；普通助教无权强制纠错。

### P2-EXE-012 Cancel/Skip

CANCEL 不推进；SKIP 可推进且需权限/原因。UI 文案区分，不使用同一“删除”按钮。

### P2-EXE-013 Track Completed

指针超过 end 后状态 COMPLETED，Today/Workbench 显示完成；不再生成候选；事件/审计。

### P2-EXE-014 完成闭环 E2E

E2E：挂载 807 从 8 开始→安排第8→Today 勾选→轨道 9/26→下一候选第9→搜索 usage 更新。

## Epic P2-EXE-03：改期与拖拽

### P2-EXE-015 RescheduleTask 服务

只允许 PENDING/BLOCKED；检查 availability/device/capacity/locked；返回 warning 或提交。manual override 原因。

### P2-EXE-016 Reschedule API warning 协议

第一次请求 `confirmWarnings=false` 可返回 422/业务响应：warnings + proposed change；确认请求附 warning token，防止条件变化后使用旧确认。

### P2-EXE-017 dnd-kit 基础

Draggable task、Droppable date cell、DragOverlay、auto scroll。拖拽 data 只含 ID/版本，后端取真值。

### P2-EXE-018 目标状态反馈

allowed=普通边框；warning=文字+图标；blocked=禁止。颜色不是唯一信号。

### P2-EXE-019 拖拽乐观更新与回滚

成功 patch date；失败回原 cell；409 显示最新位置；短时 Undo 调补偿 API。

### P2-EXE-020 键盘/菜单改期

提供“移动到明天/选择日期/下一可学习日”。与拖拽调用同一 API。

### P2-EXE-021 虚拟 Grid 拖拽测试

覆盖虚拟化回收、横向 auto-scroll、目标列未渲染、切换密度、任务多 cell、键盘 sensor。

## Epic P2-EXE-04：自动顺延与日结

### P2-EXE-022 FindNextAvailableDate

实现优先级与设备条件；horizon；排除日期。属性测试随机数据。

### P2-EXE-023 CarryOverTask 事务

原 CARRIED_OVER、新 PENDING、双向链、快照复制、指针不变、幂等。找不到日期 → BLOCKED。

### P2-EXE-024 Quartz JobStore

配置 JDBC 持久化、集群实例 ID、misfire；创建 organization job schedule。禁止使用只在内存的默认 store。

### P2-EXE-025 DayCloseRun 表与 Job

保存运行统计；分页/skip locked；单项失败继续，最终 PARTIAL；失败可重跑。

### P2-EXE-026 日结管理 API

查看 runs、失败项、手工补跑。仅 ADMIN/LEAD 对应权限。

### P2-EXE-027 顺延 Drawer

Today metric 点击显示原日期、目标日期、任务、学生、原因、链路和状态；可打开详情。

### P2-EXE-028 自动化通知

P0 页面内通知即可：日结完成、blocked 数、失败。桌面系统通知可配置，避免每项弹窗。

### P2-EXE-029 顺延并发/崩溃测试

- 同任务两个 worker；
- 创建新实例后事务回滚；
- Job 崩溃后重跑；
- 锁定任务跳过；
- task 在扫描后被老师完成；
- horizon 无日期。

### P2-EXE-030 顺延 E2E

学生周二不可学习；周一未完成；补跑日结；验证周一历史、周三新任务、轨道未推进、Today 顺延统计。

## Epic P2-CAL-01：单学生日/周/月视图

### P2-CAL-001 Schedule API

按 studentId/from/to 返回 availability、tasks、track summaries。最大范围 366 天但默认短范围；权限检查。

### P2-CAL-002 Student Header

姓名、设备、标签、资料/生词按钮、常规/本周条件摘要、轨道进度。

### P2-CAL-003 DayChecklist

专用日视图：任务、Checkbox、容量、Inline Composer。与 Today 复用 TaskChecklistRow，不复制业务逻辑。

### P2-CAL-004 FullCalendar Week

Standard timeGrid/dayGrid 选择；全天任务按日期显示；拖拽统一 reschedule mutation；不可学习日背景标记。

### P2-CAL-005 FullCalendar Month

每格最多阈值、+N、日期详情面板、完成状态显示开关。禁止将完整标题塞满月格。

### P2-CAL-006 ViewSwitcher/URL

`view=day|week|month&date=`；刷新恢复；排期按钮默认进入 week 或用户上次视图。

### P2-CAL-007 Calendar license guard

依赖清单确认只包含 Standard plugins；CI/license review 检查未引入 premium resource packages。

### P2-CAL-008 单学生视图 E2E

三个视图切换、拖动、勾选、打开任务、不可学习日、月 +N、返回工作台位置。

## Epic P2-STU-03：学习条件变更影响处理

### P2-STU-013 ScheduleImpactAnalyzer 完整实现

检查未来 PENDING：day unavailable、device conflict、capacity overflow。返回 suggestedDate 和 locked。

### P2-STU-014 Impact Preview UI

保存学生周计划前显示受影响任务；按冲突分组；锁定项突出。

### P2-STU-015 Apply Resolution

KEEP、MOVE_SUGGESTED、CUSTOM；批量命令幂等；每项调用统一 reschedule policy。

### P2-STU-016 并发与部分失败

条件在 preview 后变化时 warning token 失效；批量结果逐项显示；不悄悄吞错。

### Phase 2 退出门禁

- [ ] Today 默认首页真实可用；
- [ ] 多学生 Grid 紧凑/扩展可扫描与编辑；
- [ ] 三个学生入口保持语义；
- [ ] 临时任务可表格式快速输入；
- [ ] 模板可挂载、单元可安排；
- [ ] Checklist 完成正确推进轨道且幂等；
- [ ] 未完成正确顺延到下一可学习日并保留历史；
- [ ] 日期拖拽与菜单改期共用同一服务；
- [ ] 单学生日/周/月可用；
- [ ] PRD AC-001~009、AC-011、AC-013~014 通过；
- [ ] 60学生×14天性能与键盘可访问性达到基线。


---

# 5. Phase 3 — Operationalization

## Epic P3-SRC-01：全局搜索

### P3-SRC-001 search_document 迁移

建立结构化 studentId/templateId 可选列、tsvector、trigram、唯一和索引。扩展 pg_trgm 在 Flyway 中显式创建。

### P3-SRC-002 规范化函数

处理 trim、大小写、全半角、连续空白、常见编号格式。生词/备注不默认进入全局搜索，避免敏感和噪音。

测试：中英文、数字、`807-12`、`第12节`、全角字符。

### P3-SRC-003 Search Projection Listeners

监听 StudentUpdated、TemplatePublished、TrackMounted、TaskScheduled/Completed/CarriedOver，幂等 upsert。

测试：事件重复、乱序、实体归档、处理失败后重投。

### P3-SRC-004 Search Rebuild Job

按组织重建、进度、取消、校验抽样。重建期间可用；generation/分批策略。

### P3-SRC-005 DateQueryParser

支持固定格式和今天/明天/昨天/下周一。返回绝对日期和理解提示。

属性/示例测试：跨年、月末、闰日、组织时区、本机时区不同。

### P3-SRC-006 Search API

分组返回 Student/Template/Item/Task/Date；权限在 SQL 层过滤；limit/timeout。

性能：10 万文档 P95 目标；Explain plan 保存。

### P3-SRC-007 Global Search Dialog

Ctrl/Cmd+K、键盘导航、分组、类型标识、历史查询。日期解析提示。

### P3-SRC-008 模板 usage Drawer

点击模板显示挂载学生、current/end、下一日期；分页、筛选。

### P3-SRC-009 单元 usage Drawer

显示已完成、待完成、已安排及日期。严禁返回无权限学生。

### P3-SRC-010 Search E2E

搜索学生→资料；搜索日期→日视图；搜索 807 第12节→usage；跨助教权限过滤。

## Epic P3-VOC-01：生词本

### P3-VOC-001 vocabulary 表与迁移

batch/entry、索引、状态、sourceEntry。跨批重复允许。

### P3-VOC-002 批量文本解析

支持换行/逗号/tab；trim；规范大小写；空行；原始输入；重复提示。

测试：英文、短语、含连字符/撇号、中文释义混入、超长项、500 条限制。

### P3-VOC-003 Preview API

返回 normalized terms、批内重复、历史出现次数（仅提示）、错误。Preview 不写库。

### P3-VOC-004 Save Batch API

事务保存 batch + entries；幂等键；学生权限；来源/科目可选。

### P3-VOC-005 Vocabulary Button

学生身份区显示“生词本”与本周数量。按钮不依赖整个生词列表加载。

### P3-VOC-006 生词本页面

本周/本月/全部、日期/科目/来源筛选、批次折叠、状态编辑、分页。

### P3-VOC-007 复制与导出

安全纯文本、CSV/XLSX；CSV 公式注入防护；导出审计和短期链接。

### P3-VOC-008 复测批次 P1 接口预留

sourceEntryId、sourceType=RETEST；UI 可暂不开放，但数据模型与 API 不阻塞未来。

### P3-VOC-009 Vocabulary E2E

从学生按钮进入→粘贴10项→预览重复→保存→本周计数更新→导出。

## Epic P3-SEC-01：完整权限、审计与隐私

### P3-SEC-001 权限矩阵实现

为每个 API 标注 permission；DataScope 应用于查询和命令。生成权限覆盖表。

### P3-SEC-002 Assigned Student Scope

建立学生访问关系或主要助教规则；教学负责人 view all；助教仅负责范围。转移助教后立即生效。

### P3-SEC-003 越权自动测试

对每个资源随机 ID、另一组织 ID、未分配学生 ID 执行 read/write；预期 404/403 策略统一。

### P3-SEC-004 业务审计拦截器

实现 actor、correlation、before/after 最小字段；领域事件补充复杂操作。审计失败对核心命令的策略：主审计写入同事务，外部日志可异步。

### P3-SEC-005 审计查询 UI

教学负责人/管理员可按学生、任务、时间、操作人、动作查询。敏感字段脱敏，分页。

### P3-SEC-006 日志脱敏测试

测试运行后扫描 log fixture，禁止 token、password、完整 Excel raw row、敏感 note。

### P3-SEC-007 CSV/Excel 安全

公式前缀转义；文件名清洗；Content-Disposition；MIME；下载授权。

### P3-SEC-008 Tauri 安全评审

Capability、CSP、remote origin、updater signature、file scope、token storage。输出 checklist 并阻断高危。

### P3-SEC-009 SBOM 与许可证门禁

生成前后端/Rust SBOM；allow/review/deny；GPL/AGPL 依赖阻断；THIRD_PARTY_NOTICES。

## Epic P3-OPS-01：可观测性与运行任务

### P3-OPS-001 结构化日志

requestId/traceId/org/actor/module/event/duration；敏感字段清单。

### P3-OPS-002 Actuator/OTel

health、metrics、traces；管理端口保护；生产不公开 env/configprops。

### P3-OPS-003 领域指标

完成、顺延、blocked、轨道推进、导入、搜索、日结。禁止高基数 labels。

### P3-OPS-004 Scheduler Dashboard

管理页面显示最近日结、失败、event backlog、import jobs。只读为主，重跑需权限和确认。

### P3-OPS-005 告警规则

- 日结未按时成功；
- blocked 激增；
- event publication backlog；
- 5xx/409 异常趋势；
- DB pool；
- 磁盘/备份失败；
- 桌面最低版本不兼容。

### P3-OPS-006 Runbook 编写

按 SDD 列表逐项写症状、诊断、操作、回滚、升级路径和审计要求。

## Epic P3-OPS-02：性能与容量

### P3-OPS-007 性能数据生成器

生成 10 组织、5,000 学生、100 模板、百万 task_instance 的可重复数据；不使用真实姓名。

### P3-OPS-008 Today/Workbench SQL 优化

EXPLAIN ANALYZE；索引；消除 N+1；查询预算断言或 datasource proxy。

### P3-OPS-009 前端性能基准

60学生×14天、120学生×7天；React Profiler；滚动、checkbox、drag、density switch。

### P3-OPS-010 API 负载测试

k6/Gatling 脚本：Today、Workbench、complete、search。保存报告基线。

### P3-OPS-011 DayClose 大批量

100,000 pending；批次、并发、DB 锁、恢复；验证业务幂等和运行统计。

### P3-OPS-012 Excel 大文件

5k/50k cells；内存上限、超时、取消、错误报告。

## Epic P3-OPS-03：桌面发布与兼容

### P3-OPS-013 PlatformAdapter 完整化

上传、保存导出、通知、appVersion、openPath。浏览器 fallback。

### P3-OPS-014 Windows 构建签名

CI 安全使用证书；安装/卸载；升级；SmartScreen 策略；制品 hash。

### P3-OPS-015 macOS 构建签名/公证

若目标范围包括 macOS：签名、notarization、universal/architecture 决策。

### P3-OPS-016 Updater channels

stable/beta、签名 manifest、下载/安装、失败回滚、最低版本提示。

### P3-OPS-017 API 客户端兼容

后端兼容前一桌面小版本；contract tests；客户端发送 version header；过旧给明确升级页。

### P3-OPS-018 安装 Smoke

真实 Windows/macOS runner 或设备：首次安装、登录、文件导入、导出、通知、更新检查、登出清凭据。

## Epic P3-OPS-04：备份、恢复与发布

### P3-OPS-019 生产 Compose/Kubernetes/VM 方案

根据客户环境选一种主方案，文档不得同时给三套无人维护的生产路径。P0 可 Docker Compose + 受管 PostgreSQL/独立主机。

### P3-OPS-020 TLS/域名/密钥

HTTPS、证书自动续期、secret store、key rotation、CORS。

### P3-OPS-021 PostgreSQL 备份

每日备份、WAL/PITR 可选、加密、保留、监控。脚本不得只“生成成功日志”而不验证制品。

### P3-OPS-022 恢复演练

从备份恢复到隔离环境；执行一致性检查：任务链、track pointer、Flyway、search rebuild、登录。

### P3-OPS-023 发布/回滚手册

Expand/Contract、备份、迁移、API、桌面 channel、监控。数据库以向前修复为主。

### P3-OPS-024 Staging 环境

与生产同数据库主版本、时区、scheduler；脱敏数据；可跑完整 E2E。

## Epic P3-UAT-01：用户试用与上线门禁

### P3-UAT-001 真实业务数据映射演练

使用客户 Excel 副本和少量脱敏学生，验证模板导入、轨道挂载、周计划。

### P3-UAT-002 助教任务脚本

至少包含：

1. 打开今日工作；
2. 搜索学生；
3. 点击姓名资料；
4. 点击生词本；
5. 点击排期；
6. 写临时任务；
7. 挂载 807；
8. 拖动改期；
9. 勾选完成；
10. 查看自动顺延；
11. 搜索第12节 usage；
12. 导出生词。

### P3-UAT-003 可用性记录

记录每个脚本：完成率、操作次数、犹豫点、错误、是否回到 Excel。禁止仅询问“好不好用”。

### P3-UAT-004 缺陷分级

- Blocker：数据错乱、越权、任务丢失、轨道错位；
- Critical：核心闭环无法完成；
- Major：高频操作明显绕路；
- Minor：视觉/低频问题。

Blocker/Critical 清零后方可上线试运行。

### P3-UAT-005 数据迁移/初始化

确认哪些学生、模板、当前进度、周计划需要导入；每批有 reconciliation 报告。

### P3-UAT-006 培训材料

只教“勾、拖、写、挂”与异常处理；包含三入口、顺延可见、如何撤销、如何反馈问题。

### P3-UAT-007 试运行观察

观察自动顺延修正率、重复任务、track pointer、系统外 Excel 使用率、用户反馈；每天检查日结。

### Phase 3 退出门禁

- [ ] 全局搜索含任务反向查询；
- [ ] 生词录入、汇总、导出闭环；
- [ ] 权限/越权/审计/日志脱敏通过；
- [ ] 性能目标和大批量日结通过；
- [ ] Tauri 制品签名和更新流程通过；
- [ ] 备份恢复演练通过；
- [ ] PRD AC-001~015 全部通过；
- [ ] UAT 无 Blocker/Critical；
- [ ] 已知限制记录并获得产品负责人接受。

---

# 6. 字段级实施清单

本节把 SDD 数据字典转成迁移、实体、仓储、API 与测试任务，防止“表建了但字段语义没实现”。字段命名以 SDD 为准；若实现中需要改名，必须先更新数据字典、OpenAPI 和本节。

## 6.1 通用字段门禁

除只追加事件表等明确例外外，每张可变业务表必须验证：

- [ ] `id uuid` 使用服务端 ID 生成策略；
- [ ] `organization_id uuid` 且所有读写强制租户过滤；
- [ ] `created_at`、`created_by`、`updated_at`、`updated_by`；
- [ ] `version bigint` 乐观锁，API 返回 expectedVersion；
- [ ] status 使用数据库 CHECK 或受控枚举；
- [ ] FK 删除策略明确，历史核心表不得级联物理删除；
- [ ] 归档字段（若适用）；
- [ ] Flyway migration、字段字典、索引和回滚/向前修复说明；
- [ ] Repository 租户隔离测试；
- [ ] API 不允许客户端注入 `organizationId/createdBy/updatedBy`；
- [ ] UTC 时间戳与组织 BusinessDate 的转换测试；
- [ ] PII 字段不进入普通日志与搜索 payload。

## 6.2 organization、user_account 与权限字段

- [ ] `organization.code` 唯一；`business_timezone` 必须是合法 IANA ZoneId；
- [ ] `day_close_time`、`carryover_horizon_days` 有边界和默认值；
- [ ] `user_account.username` 机构内唯一；status 支持 ACTIVE/LOCKED/DISABLED；
- [ ] password hash 只存强哈希；邮箱规范化策略明确；
- [ ] `user_role_assignment` 支持 ORGANIZATION/STUDENT_SET scope；
- [ ] 禁用用户后刷新会话失效；
- [ ] 管理接口与普通业务接口权限矩阵测试完整。

## 6.3 student、student_tag 与 student_subject_preference

- [ ] `student.student_code` 机构内唯一且归档后历史可查；
- [ ] `name`、`alias` 长度、规范化和搜索更新事件；
- [ ] `default_device_policy` 仅允许 ALLOWED/NOT_ALLOWED/CONFIRM；
- [ ] `primary_assistant_id` 必须属于同组织；
- [ ] `note` 受更高权限控制且日志脱敏；
- [ ] `student_tag` 保留 tag snapshot，避免标签改名污染历史展示；
- [ ] `student_subject_preference(student_id, subject_code)` 唯一；priority 1—5；
- [ ] 姓名按钮、生词按钮、排期按钮均使用同一 StudentSummary DTO，但点击语义独立。

## 6.4 student_weekly_pattern、student_weekly_pattern_day、student_week_plan 与 student_day_availability

- [ ] 常规周同一学生最多一条 ACTIVE pattern；
- [ ] `student_weekly_pattern_day` 必须有 ISO 1—7 共 7 条；
- [ ] `available_minutes` 范围 0—1440；不可学习日的分钟语义统一；
- [ ] `device_policy_override=null` 表示继承，不等于 CONFIRM；
- [ ] `week_start_date` 必须周一，`(student_id, week_start_date)` 唯一；
- [ ] WeekPlan DRAFT 可改，CONFIRMED/CLOSED 的修改必须走新版本/纠错命令；
- [ ] `student_day_availability.business_date` 必须落在其 week plan；
- [ ] 常规周、上周复制和手工覆盖的 `source_type/source_id` 可追溯；
- [ ] 有未来任务时修改 availability 必须先产生 ScheduleImpactPreview；
- [ ] 条件变更与应用解决方案之间使用 warning token/expectedVersion 防竞态。

## 6.5 task_template 与 task_template_version

- [ ] `template_code` 机构内唯一并规范化；
- [ ] `short_name` 有长度上限并用于紧凑视图；
- [ ] subject/category 使用可扩展代码，不在 UI 写死；
- [ ] default duration 范围合法；default requires device 可被 item/track 覆盖；
- [ ] `current_published_version_id` 只能指向本模板 PUBLISHED 版本；
- [ ] 同模板 `(template_id, version_number)` 唯一，最多一条 DRAFT；
- [ ] 发布时计算 `item_count/checksum/published_at/by`；
- [ ] PUBLISHED 版本 repository 和 SQL 层均阻止原地更新；
- [ ] RETIRED 模板不可新挂载，但历史轨道和任务仍能查询；
- [ ] 创建下一草稿复制稳定 itemCode，但产生新版本/新 item ID。

## 6.6 task_template_item

- [ ] `(template_version_id, ordinal)` 唯一且发布时从 1 连续；
- [ ] 非空 `item_code` 同版本唯一；
- [ ] `title`、`short_title`、duration、device 覆盖规则明确；
- [ ] shortTitle 缺失时有稳定生成规则，不依赖前端临时截断；
- [ ] `content_ref` 只作为引用，不允许服务端任意抓取 URL；
- [ ] `metadata` 只存导入行号等低频数据，不承载核心业务字段；
- [ ] 草稿允许停用/重排，发布后不可原地修改；
- [ ] Excel 空单元格不生成 item，错误单元格必须进入 import row report。

## 6.7 student_task_track

- [ ] `template_version_id` 固定且属于 `template_id`；
- [ ] `1 <= start_ordinal <= current_ordinal <= end_ordinal + 1`；
- [ ] `default_units_per_session >= 1`；
- [ ] COMPLETED 时 `current_ordinal=end_ordinal+1`；
- [ ] pause/resume 不丢指针；cancel 不删历史；
- [ ] schedulingPolicy 只允许 MANUAL/ROLLING/AUTO_CAPACITY；P0 仅启用已实现策略；
- [ ] Track duplicate warning 与显式确认；
- [ ] duration/device override 的优先级测试；
- [ ] `version` 乐观锁和并发完成时行锁顺序测试；
- [ ] Progress 由 current/end 计算，禁止单独维护可能漂移的百分比。

## 6.8 task_instance

- [ ] `source_type=TRACK` 必须有 track/template item/ordinal；AD_HOC 必须为空；
- [ ] `scheduled_date` 与 `original_scheduled_date` 语义明确；
- [ ] status 仅允许 PENDING/COMPLETED/CARRIED_OVER/CANCELLED/SKIPPED/BLOCKED；
- [ ] `title/shortTitle/duration/device` 均保存历史快照；
- [ ] `schedule_origin` 区分 AUTO/MANUAL/IMPORT/CARRYOVER；
- [ ] `manual_override=true` 时 reason/operator 策略生效；
- [ ] `locked=true` 时日结和普通改期不得移动；
- [ ] carry-over 双向链不得自引用，源/目标必须同学生且同业务任务；
- [ ] completed/cancelled actor/time 与状态一致；
- [ ] 部分唯一索引阻止同轨道单元出现两个 PENDING；
- [ ] `(student_id, scheduled_date, status)`、组织日期、track ordinal 索引；
- [ ] 每个写命令都要求 expectedVersion 与 idempotencyKey（适用时）；
- [ ] 批量命令逐项复用单项领域命令，不另写状态推进逻辑。

## 6.9 vocabulary_batch 与 vocabulary_entry

- [ ] Batch 直接归属 student，occurredDate 使用 BusinessDate；
- [ ] sourceType/subject/sourceLabel 均可选到最低必要程度；
- [ ] `raw_input` 保存策略、长度上限和敏感信息规则明确；
- [ ] `term_original` 必填，`term_normalized` 使用统一规范化器；
- [ ] ACTIVE/MASTERED/ARCHIVED 状态合法；
- [ ] 跨批次重复默认允许并在 UI 提示，不静默删除；
- [ ] `source_entry_id` 为复测回流预留，不形成循环；
- [ ] 周/月查询索引和导出权限测试；
- [ ] 批量预览不落业务表，确认保存才创建 batch/entries。

## 6.10 import_job、import_row_error、search_document、audit_event 与 idempotency_record

- [ ] `import_job.file_sha256`、mapping、summary、requestedBy、时间和状态完整；
- [ ] `import_row_error` 保存 sheet/row/column/errorCode/rawValue，且限制敏感值长度；
- [ ] 导入执行幂等，同一文件/映射重复提交不会重复发布模板；
- [ ] `search_document(document_type, entity_id)` 机构内唯一；FTS/trigram 索引存在；
- [ ] search payload 只含结果卡必要字段，最终权限仍由 SQL/DataScopePolicy 保证；
- [ ] `audit_event` 只追加、字段脱敏、correlationId 可追踪批任务；
- [ ] `idempotency_record` 同键不同 requestHash 返回 409；IN_PROGRESS 超时恢复策略明确；
- [ ] 搜索投影可从主表重建，不能成为业务真值；
- [ ] 审计、幂等和导入状态均有清理/保留策略与运维指标。

---

# 7. 核心业务测试矩阵

## 7.1 Checklist 与轨道

| Case | 前置 | 操作 | 预期 |
|---|---|---|---|
| EX-01 | track current=8，task8 PENDING | complete8 | task8 COMPLETED，current=9 |
| EX-02 | EX-01 后重复相同 idempotency | complete8 | 返回相同结果，current=9 |
| EX-03 | task8、task9 同日 PENDING | complete9 | current=8，记录9完成但不跨缺口 |
| EX-04 | EX-03 后 complete8 | complete8 | current=10 |
| EX-05 | task8 COMPLETED，后续无完成 | reopen8 | task8 PENDING，current=8 |
| EX-06 | task8、9 已完成 current=10 | reopen8 | 普通流程拒绝，要求纠错 |
| EX-07 | current=end，complete end | complete | track COMPLETED，current=end+1 |
| EX-08 | AD_HOC | complete | 完成，不影响 track |

## 7.2 顺延

| Case | 前置 | 操作 | 预期 |
|---|---|---|---|
| CO-01 | 周一 pending，周二不可、周三可 | day close | 原 CARRIED_OVER，新任务周三 PENDING |
| CO-02 | requires device，周三不可设备，周四可 | day close | 目标周四 |
| CO-03 | locked | day close | 不移动，运行统计 skippedLocked |
| CO-04 | 已完成 | 重复 carryover | no-op |
| CO-05 | horizon 内无日期 | day close | BLOCKED，今日异常 |
| CO-06 | 两 worker 同时 | carryover | 只有一个新实例 |
| CO-07 | 新实例写入失败 | carryover | 原仍 PENDING，事务回滚 |
| CO-08 | 手动目标冲突确认 | carryover | override=true，原因审计 |

## 7.3 模板版本

| Case | 预期 |
|---|---|
| TV-01 发布后改 item | 拒绝 |
| TV-02 create next draft | 新 ID、version+1、itemCode 保留 |
| TV-03 轨道绑定 v1，发布 v2 | 轨道仍 v1 |
| TV-04 历史实例标题 | 使用 snapshot，不随模板改 |
| TV-05 导入指向 published | 不能覆盖，要求新 draft |
| TV-06 checksum | 相同规范内容稳定，相异内容变化 |

## 7.4 权限/租户

| Case | 预期 |
|---|---|
| AU-01 助教读未分配学生 | 404/403 按统一策略 |
| AU-02 搜索未分配学生任务 | 不返回 |
| AU-03 另一组织同 studentCode | 不冲突且不可见 |
| AU-04 VIEWER 勾选 | 403 |
| AU-05 ASSISTANT publish template | 403 |
| AU-06 LEAD skip ordinal | 允许并要求原因 |
| AU-07 导出 | 仅授权范围，审计 |

## 7.5 拖拽/改期

| Case | 预期 |
|---|---|
| RS-01 可学习日 | 成功，只有日期改变 |
| RS-02 不可学习日 | warning，未确认不变 |
| RS-03 设备冲突 | warning/blocked policy |
| RS-04 locked | 普通用户拒绝 |
| RS-05 stale version | 409 + current |
| RS-06 Undo 无后续修改 | 回原日期 |
| RS-07 Undo 后已被他人改 | token 失效，拒绝覆盖 |
| RS-08 键盘移动 | 与拖拽同结果 |

---

# 8. API 契约任务清单

对每个端点执行：

1. OpenAPI path/operationId；
2. 请求/响应 schema；
3. permission；
4. tenant/data scope；
5. idempotency；
6. version/concurrency；
7. audit action；
8. error codes；
9. unit/module/integration tests；
10. generated client；
11. mock fixture；
12. E2E 引用。

核心 operationId 建议：

```text
getContext
getTodayWorkspace
getStudentWorkbench
createStudent
updateStudent
getWeekPlan
saveWeekPlan
createTemplate
replaceTemplateDraftItems
publishTemplate
mountStudentTrack
scheduleTrackItems
createAdHocTask
completeTask
reopenTask
rescheduleTask
carryOverTask
batchApplyTaskInstances
lockTask
unlockTask
getStudentSchedule
getStudentTracks
previewScheduleImpact
applyScheduleImpact
getTemplateUsage
getTemplateItemUsage
searchGlobal
previewVocabularyBatch
createVocabularyBatch
previewTemplateImport
executeTemplateImport
```

命名在首次 OpenAPI 发布后冻结，避免生成客户端方法频繁变化。

---

# 9. 前端组件任务与 Storybook 场景

每个关键组件至少建立以下状态：

## StudentIdentityActions

- 默认；
- 名称超长；
- 可电子/禁电子/需确认；
- 生词 0/99+；
- 只读；
- 小宽度；
- 键盘焦点。

## TaskChecklistRow

- PENDING；
- completing；
- COMPLETED；
- CARRIED_OVER；
- BLOCKED；
- locked；
- track/ad-hoc；
- device conflict；
- stale conflict；
- long title。

## ScheduleCell

- empty available；
- empty unavailable；
- 1/3/10 tasks；
- capacity overflow；
- drag allowed/warning/blocked；
- compact/expanded。

## InlineTaskComposer

- empty；
- template results；
- item results；
- free text；
- loading；
- error；
- no permission；
- keyboard navigation。

## TrackProgress

- NOT_STARTED；
- ACTIVE 1/33；
- ACTIVE 32/33；
- COMPLETED；
- PAUSED；
- no known total；
- version retired warning。

Storybook 只用于组件隔离，不替代真实 API E2E。

---

# 10. 数据迁移与初始数据任务

## MIG-001 模板导入清单

为每个 Excel 列确定：

- templateCode；
- name/shortName；
- subject/category；
- unitLabel；
- defaultDuration；
- defaultRequiresDevice；
- item count；
- 空单元处理；
- 发布前负责人确认。

## MIG-002 学生导入

若后续提供学生表，先建立单独映射，不从“学生测试时间表”盲目推断完整学生资料。测试时间表可辅助识别姓名和可用时间，但源文件目前不支持完整设备条件、学科倾向和当前任务进度；缺失字段必须明确标记待补录。

## MIG-003 当前进度初始化

需要客户提供或助教确认每名学生每条模板当前 ordinal。系统提供导入/批量设置预览；不根据未来排期标题猜测并静默写入。

## MIG-004 对账

迁移后输出：

- 学生数；
- 模板/版本/单元数；
- 轨道数；
- 每轨道 start/current/end；
- 异常/重复/缺失；
- 原文件 hash；
- 操作者确认。

---

# 11. 缺陷与变更管理

## 11.1 缺陷必须携带

- environment/client version/API version；
- requestId/correlationId；
- organization（脱敏）；
- student/task/track ID（内部）；
- 操作步骤；
- 预期/实际；
- 是否涉及数据错乱；
- 审计截图；
- 可重现 fixture。

## 11.2 数据修复

禁止直接在生产手工 UPDATE 后不留记录。修复方式优先级：

1. 业务纠错命令；
2. 经评审的一次性修复 migration/job；
3. 最后才是受控 SQL，必须备份、双人审批、before/after 和审计。

## 11.3 需求变更

影响以下内容必须更新 PRD/SDD/Task：

- 状态机；
- 模板/轨道/实例边界；
- 完成或顺延语义；
- 数据字段与兼容；
- 入口语义；
- 开源许可证；
- 权限范围。

不得只在 Issue 评论中改变核心规则。

---

# 12. 交付物清单

## 产品与设计

- [ ] PRD；
- [ ] 可交互原型；
- [ ] 状态/空/错误/权限页面；
- [ ] 设计 Token；
- [ ] UAT 脚本。

## 后端

- [ ] 模块化单体源码；
- [ ] OpenAPI；
- [ ] Flyway；
- [ ] 模块图；
- [ ] 数据字典；
- [ ] Job/事件；
- [ ] 测试报告。

## 前端/桌面

- [ ] React 应用；
- [ ] Tauri 安装包；
- [ ] 生成客户端；
- [ ] Storybook/组件样例；
- [ ] E2E；
- [ ] 签名更新配置。

## 运维

- [ ] 部署定义；
- [ ] TLS/secret；
- [ ] dashboard/alerts；
- [ ] backup/restore；
- [ ] runbooks；
- [ ] SBOM/NOTICE；
- [ ] release/rollback。

---

# 13. 需求—任务—测试追溯矩阵

本矩阵是迭代计划、测试计划和发布门禁的共同索引。需求完成不能仅凭页面“可点击”，必须由所列任务产物和测试证据共同关闭。

## 13.1 功能与性能需求

| 需求ID | 需求名称/摘要 | 实施任务与测试证据 |
|---|---|---|
| FR-EXEC-001 | 完成 | P2-EXE-007~010/014；测试：事务、幂等、乐观 UI、并发 |
| FR-EXEC-002 | 取消勾选/重新打开 | P2-EXE-011；测试：安全回退与纠错冲突 |
| FR-EXEC-003 | 自动顺延 | P2-EXE-022~030；测试：next available day、链路、重跑 |
| FR-EXEC-004 | 手动顺延/改期 | P2-EXE-015~020；测试：日期拖动不推进 pointer |
| FR-EXEC-005 | 日结时间 | P2-EXE-024~026；测试：misfire、时区、管理员补跑 |
| FR-EXEC-006 | 锁定 | P2-EXE-006/023；测试：锁定阻止自动顺延 |
| FR-EXEC-007 | 状态 | P2-EXE-001/005/012；测试：状态迁移合法性 |
| FR-PROFILE-001 | 姓名入口 | P1-STU-004/005；测试：name action 仅打开资料 |
| FR-PROFILE-002 | 基本信息 | P1-STU-001/002/005；测试：表单校验和权限 |
| FR-PROFILE-003 | 常规周学习模式 | P1-STU-006/007/010；测试：默认全选、分钟、版本 |
| FR-PROFILE-004 | 本周计划覆盖 | P1-STU-008~011；测试：复制常规周/上周、覆盖优先级 |
| FR-PROFILE-005 | 设备条件 | P1-STU-001/005/011；测试：设备标签与有效条件 |
| FR-PROFILE-006 | 学科倾向 | P1-STU-001/005；测试：学科倾向保存与筛选 |
| FR-PROFILE-007 | 变更影响预览 | P1-STU-012、P2-STU-013~016；测试：影响预览、token 失效、部分失败 |
| FR-SCHEDULE-001 | 排期按钮入口 | P1-STU-004、P2-CAL-002；测试：Schedule Button 独立路由 |
| FR-SCHEDULE-002 | 日视图 | P2-CAL-001~003；测试：日 Checklist、容量和编辑 |
| FR-SCHEDULE-003 | 周视图 | P2-CAL-001/004/006；测试：周视图改期 |
| FR-SCHEDULE-004 | 月视图 | P2-CAL-001/005/006；测试：月视图 +N、详情抽屉 |
| FR-SCHEDULE-005 | 轨道进度区 | P1-TRK-004/007、P2-CAL-002；测试：多轨道进度 |
| FR-SEARCH-001 | 搜索范围 | P3-SRC-001~007；测试：学生/模板/单元/日期混合结果 |
| FR-SEARCH-002 | 日期解析 | P3-SRC-005；测试：绝对日期、相对日期、组织时区 |
| FR-SEARCH-003 | 分组结果 | P3-SRC-006/007；测试：分组、键盘导航、空结果 |
| FR-SEARCH-004 | 任务反向查询 | P3-SRC-008/009；测试：模板与具体单元 usage |
| FR-SEARCH-005 | 权限过滤 | P3-SEC-001~003、P3-SRC-006；测试：越权不出现在搜索结果 |
| FR-STUDENT-001 | 工作台布局 | P2-WBK-001~004；测试：日期范围、冻结首列、游标/虚拟化 |
| FR-STUDENT-002 | 学生身份区 | P1-STU-004；测试：姓名/生词/排期三按钮独立 |
| FR-STUDENT-003 | 紧凑视图 | P2-WBK-005/009；测试：紧凑高度与溢出显示 |
| FR-STUDENT-004 | 扩展视图 | P2-WBK-006/007；测试：Expanded Checklist/inline editing |
| FR-STUDENT-005 | 搜索与筛选 | P1-STU-003、P2-WBK-008；测试：姓名/标签/助教筛选 |
| FR-STUDENT-006 | 日期拖拽 | P2-EXE-015~021；测试：拖拽、键盘替代、乐观回滚 |
| FR-STUDENT-007 | 快速添加面板 | P2-WBK-009、P2-EXE-004；测试：最近/收藏/自由文本/模板 |
| FR-TEMPLATE-001 | 模板列表 | P1-CUR-006；测试：搜索/状态/分页 |
| FR-TEMPLATE-002 | 模板创建与编辑 | P1-CUR-002/003；测试：草稿单元连续性和校验 |
| FR-TEMPLATE-003 | Excel 导入 | P1-IMP-001~007；测试：现有 Excel、空列、重复、超限 |
| FR-TEMPLATE-004 | 版本与发布 | P1-CUR-004/005；测试：发布不可变/新草稿/历史 |
| FR-TEMPLATE-005 | 挂载学生 | P1-TRK-002/003；测试：开始 ordinal、重复挂载、权限 |
| FR-TEMPLATE-006 | 轨道进度 | P1-TRK-004/006/007、P2-EXE-007~014；测试：指针不变量 |
| FR-TEMPLATE-007 | 临时任务 | P2-EXE-002/004；测试：自由文本无轨道 next item |
| FR-TEMPLATE-008 | 使用情况 | P3-SRC-008/009；测试：学生、日期、进度反向查询 |
| FR-TODAY-001 | 默认日视图 | P2-TDY-002/003；测试：页面路由、BusinessDate、日期导航 E2E |
| FR-TODAY-002 | 今日统计 | P2-TDY-001/002/007；测试：统计 SQL、筛选回放、500任务性能 |
| FR-TODAY-003 | 按学生聚合 | P2-TDY-001/004；测试：StudentIdentityActions 组件契约 |
| FR-TODAY-004 | 直接 Checklist | P2-TDY-005、P2-EXE-007~011；测试：完成/重开幂等与并发 |
| FR-TODAY-005 | 快速添加 | P2-EXE-002~004、P1-TRK-002/003；测试：临时/模板/指定单元输入 |
| FR-TODAY-006 | 顺延可见性 | P2-EXE-023~028；测试：顺延明细、审计、撤销条件 |
| FR-TODAY-007 | 批量操作 | P2-TDY-008；测试：批量预览、逐项结果、权限、幂等和部分失败 |
| FR-VOCAB-001 | 学生入口 | P3-VOC-005/006；测试：Vocabulary Button 独立入口 |
| FR-VOCAB-002 | 批量录入 | P3-VOC-002~004；测试：批量分词、预览确认、去重 |
| FR-VOCAB-003 | 字段 | P3-VOC-001/004/006；测试：最小必填和可后补字段 |
| FR-VOCAB-004 | 汇总 | P3-VOC-006/007；测试：周/月聚合、复制、导出 |
| FR-VOCAB-005 | 复测闭环 | P3-VOC-008/009；测试：复测批次接口与回库预留 |
| NFR-PERF-001 | 今日工作在 60 名学生、500 条当日任务规模下，正常网络 P95 首屏数据返回不超过 1.5 秒。 | P3-OPS-007/008/010；门禁：Today 60学生/500任务 P95 |
| NFR-PERF-002 | 学生工作台 60 行 × 14 天的数据查询 P95 不超过 2 秒；前端滚动保持可交互。 | P3-OPS-007~009；门禁：Workbench 60×14 查询和滚动 |
| NFR-PERF-003 | 全局搜索在 10 万条搜索文档内 P95 不超过 500ms。 | P3-SRC-001~010、P3-OPS-010；门禁：10万文档搜索 P95 |
| NFR-PERF-004 | 单次复选框、拖拽或快速新增的 API P95 不超过 800ms，不含网络极端情况。 | P3-OPS-010；门禁：complete/reschedule/create P95 |
| NFR-PERF-005 | Excel 导入 5,000 个单元应在异步任务中完成，并持续返回进度。 | P1-IMP-001~007、P3-OPS-012；门禁：5,000单元异步进度 |

## 13.2 业务规则

| 规则ID | 规则摘要 | 任务/测试保障 |
|---|---|---|
| BR-001 | 学生是所有排期、轨道和生词的直接归属对象。 | P1-STU-001、P1-TRK-001、P2-EXE-001、P3-VOC-001；FK/tenant 集成测试 |
| BR-002 | 已发布模板不可原地修改；历史每日任务保存标题、时长和设备要求快照。 | P1-CUR-004/005、P2-EXE-001；版本不可变与快照测试 |
| BR-003 | 同一轨道默认只允许从当前指针开始生成连续单元，禁止无提示跳号。 | P1-TRK-006、P2-EXE-007~010；属性测试 |
| BR-004 | 改期、拖拽和顺延都不推进轨道；只有完成才可能推进。 | P2-EXE-015~030；改期/顺延前后 pointer 断言 |
| BR-005 | 若同一天安排同一轨道的多个连续单元，进度只能推进到第一个未完成单元之前。 | P2-EXE-010/014；多单元连续前缀测试 |
| BR-006 | 未完成单元顺延时，后续尚未开始的单元不得越过它成为当前指针。 | P1-TRK-006、P2-EXE-014/030；未完成阻塞后续测试 |
| BR-007 | 自动顺延选择“下一可学习日”，不是简单日期 +1。 | P2-EXE-022；可用日属性测试 |
| BR-008 | 设备要求必须同时考虑学生默认条件和日期覆盖条件。 | P1-STU-011、P2-STU-013~016；设备冲突测试 |
| BR-009 | 老师手动 override 高于自动排期，但必须记录操作者和原因。 | P2-EXE-016、P3-SEC-004/005；override reason 与审计 |
| BR-010 | 锁定任务不被自动移动。 | P2-EXE-006/023；锁定日结测试 |
| BR-011 | 删除模板、学生或轨道采用归档/停用，历史记录不可物理删除。 | P1 数据迁移、P3-SEC-004；归档与历史查询测试 |
| BR-012 | 同一命令重复提交不得产生重复完成、重复顺延或重复挂载。 | P0-FND-010、P2-EXE-007/015/023；幂等/唯一约束测试 |
| BR-013 | 搜索、统计和导出必须受服务端权限约束。 | P3-SEC-001~003；越权 API/Search/Export 测试 |
| BR-014 | 所有业务日期按组织时区解释；时间戳统一以 UTC 存储。 | P0-FND-008、P2-EXE-024~026；时区/UTC 测试 |
| BR-015 | 自动化操作必须在今日工作中可见，并保留审计记录。 | P2-EXE-025/027/028、P3-SEC-004；自动化可见性 UAT |
| BR-016 | 个性化临时任务允许自由文本，不强制进入模板库。 | P2-EXE-002/004；临时任务 E2E |
| BR-017 | 生词本的录入流程不得要求助教为每个词完成复杂标注；非必填字段可后补。 | P3-VOC-002~006；低输入负担 UAT |
| BR-018 | 模板轨道与每日任务实例必须分离，禁止通过修改历史实例来表达模板更新。 | P1-CUR-001、P1-TRK-001、P2-EXE-001；数据库架构门禁 |

## 13.3 验收场景

| 验收ID | 场景 | 关闭条件 |
|---|---|---|
| AC-001 | 今日工作 | P2-TDY-001~007、P3-UAT-002；Today E2E |
| AC-002 | 入口语义 | P1-STU-004/005、P3-UAT-002；三入口组件/E2E |
| AC-003 | 长期轨道挂载 | P1-TRK-002~004、P3-UAT-002；挂载与进度 E2E |
| AC-004 | 完成推进 | P2-EXE-007~014；完成推进 E2E/并发 |
| AC-005 | 多单元连续推进 | P2-EXE-010/014；连续单元属性/E2E |
| AC-006 | 未完成顺延 | P2-EXE-022~030；顺延 E2E/崩溃恢复 |
| AC-007 | 设备约束 | P1-STU-011、P2-STU-013~016；设备约束测试 |
| AC-008 | 日期拖拽 | P2-EXE-015~021；拖拽 E2E |
| AC-009 | 模板版本 | P1-CUR-004/005；模板版本集成测试 |
| AC-010 | Excel 导入 | P1-IMP-001~007；客户 Excel fixture 验收 |
| AC-011 | 个性化任务 | P2-EXE-002/004；个性化任务 E2E |
| AC-012 | 任务反向查询 | P3-SRC-008~010；任务反向查询 E2E |
| AC-013 | 并发控制 | P2-EXE-007/015/023/029；并发与幂等测试 |
| AC-014 | 自动化透明 | P2-EXE-025/027/028；自动化透明 E2E/UAT |
| AC-015 | 生词周汇总 | P3-VOC-001~009；生词周汇总 E2E |

---

# 14. 七轮任务计划复核

| 轮次 | 审阅目标 | 结果 |
|---|---|---|
| Review 1 | PRD 覆盖 | 每个核心 FR/BR 已映射到 Phase/Epic/验收；补充三入口与表格式录入任务 |
| Review 2 | SDD 架构覆盖 | 模块、表、API、事件、Tauri、Flyway、OpenAPI、Quartz 均有实施任务 |
| Review 3 | 依赖与阶段顺序 | Foundation→Core Domain→Execution→Operationalization，避免 UI 先于正确数据模型 |
| Review 4 | 业务不变量 | 增加完成幂等、连续指针、顺延链、模板不可变、租户隔离测试矩阵 |
| Review 5 | 测试与门禁 | 每阶段退出条件、全局 DoD、属性测试、E2E、性能、安全和恢复演练完整 |
| Review 6 | 开源与桌面风险 | 增加许可证阻断、FullCalendar Premium guard、Tauri capability/签名任务 |
| Review 7 | 上线可运营性 | 增加日志指标、日结 dashboard、runbook、迁移对账、UAT 和数据修复规范 |

---

# 15. 最终里程碑判定

产品不以“所有页面可以点开”作为完成，而以以下四个业务证明作为最终判定：

1. **轨道证明**：同一模板可绑定不同学生、不同版本和不同进度，历史稳定；
2. **执行证明**：勾选完成只推进正确的连续单元，重复/并发不跳号；
3. **顺延证明**：未完成任务到下一可学习日，有完整原/新实例链，自动化可见；
4. **减负证明**：助教能在 Today 和 Student Workbench 内通过“勾、拖、写、挂”完成高频工作，且不需要回到原 Excel 执行同一动作。

只有四项均通过真实助教 UAT，才可以称为助教工作台核心版本完成。

