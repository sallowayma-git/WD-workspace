# 二次复核审计（2026-08-29）

针对 2026-08-29 提出的三类缺陷（临时任务幂等重试返回形状、无效日历日期入库、BLOCKED 拖拽绕过）、三项契约问题、以及测试/文档/发布债务，做逐条复核；并以 `DocsHarness/` 为基线判断当前是否达到可交付。

复核时的仓库状态：`HEAD = 3b93f57`（2026-08-19 00:36），工作树 274 条变更（185 D / 57 M / 31 ?? / 1 R）。

实测门禁（本次复核现场执行，非引用旧记录）：

| 门禁          | 命令                                   | 结果                                                                |
| ------------- | -------------------------------------- | ------------------------------------------------------------------- |
| local-runtime | `node scripts/check-local-runtime.mjs` | `local-runtime-ok (61 reachable source modules, no HTTP transport)` |
| Web lint      | `eslint . --max-warnings 0`            | 0 problem                                                           |
| Web 测试      | `vitest run`                           | **16 files / 84 tests，全绿**，28.4s                                |

---

## 1. P1 临时任务幂等重试返回错误的数据形状

**结论：缺陷存在，但原触发链不成立；真实问题比报告的更根本——幂等保护事实上不存在。**

### 代码事实（已确认）

- `apps/web/src/data/local/sqliteLocalDataAdapter.ts:1245-1279`
  - 首次创建：`return this.getTaskView(id)`（1278），返回完整任务行视图。
  - 幂等分支：`if (existing.found) return existing.value`（1248-1249）。
  - 而幂等记录只写入 `{ taskId: id }`（1274-1276）。
  - → 同一 `idempotencyKey` 第二次调用返回 `{ taskId: "..." }`。
- `apps/web/src/features/today/taskApi.ts:59` 用 `adHocTaskSchema.parse(value)` 解析；`{ taskId }` 缺 `id`、`studentId`、`titleSnapshot` 等必填字段，zod 必然抛错。

**与既有模式的对比（这是本条最硬的证据）**：同一个文件里其余幂等命令都做对了——

| 命令                          | 幂等分支                                       | 做法                                      |
| ----------------------------- | ---------------------------------------------- | ----------------------------------------- |
| `mountTrack` (:1051-1054)     | `return this.getTrack(String(existing.value))` | 存标量 id，重放时**重新读视图**           |
| `undoCarryover` (:1569)       | `return existing.value`                        | 存的就是完整响应对象 (:1577-1583, :1599)  |
| `completeTask` (:1744)        | `return existing.value`                        | 存的就是完整响应对象 (:1754-1757, :1813)  |
| **`createAdHocTask` (:1249)** | `return existing.value`                        | **只存了 `{taskId}`，重放时未重新读视图** |

即 `createAdHocTask` 是四条幂等命令里唯一偏离既有模式的一条，属于明确的一致性问题，一行即可修复（对齐 `mountTrack`：`return this.getTaskView(taskId)`）。

### 对"最小触发"的修正

原报告称"使用同一个幂等键连续调用两次 `createAdHocTask`"。经核：

- `taskApi.createAdHocTask` 的导出签名是 `(input: Omit<CreateAdHocTaskRequest, "idempotencyKey">)`（:51），**不允许调用方传 key**；
- key 在函数内部每次调用都 `crypto.randomUUID()` 重新生成（:55）。

所以**经由 UI/feature 层无法复用同一个 key**，原报告描述的"第二次返回 `{taskId}` 导致前端 schema 解析失败"当前只可能由直接调用 adapter 的代码或测试触发（`InlineTaskComposer` → `createMutation` → `taskApi.createAdHocTask` 这条链走不到）。

### 但这暴露了更严重的问题

键每次重新生成 ⇒ **幂等保护名存实亡**。真正的重试场景（写库已成功但 Promise 失败、UI 重发、未来接入离线队列）携带的是**新 key**，不会命中 `idempotency_record`，结果是重复创建任务。也就是说：

- 报告担心的"返回形状错误"：当前不可达，但代码确实错；
- 报告没意识到的"幂等根本没生效"：当前可达，且直接违背 `DocsHarness/03` BR-012 / `02` BR-012 的精神（"同一命令重复提交不得产生重复…"；BR-012 字面只覆盖完成/顺延/挂载，临时任务创建是其自然延伸，且 `taskApi.ts:32-34` 自己就是按 BR-012 写的注释）。

**严重度**：维持 P1。理由不是"会返回错形状"，而是"BR-012 对临时任务创建未真正落地，且幂等分支形状错误会在任何引入 key 复用的改动后立刻变成线上故障"。

**修复建议（二选一，不能维持现状）**

1. 幂等分支改为 `return this.getTaskView(taskId)`；同时把 `idempotencyKey` 的生成上移到"用户意图层"（composer 一次输入生成一次，重试复用），使幂等真正生效；或
2. 认定本地单用户不需要创建幂等，则删除 `idempotencyKey` 字段、幂等记录与 BR-012 注释，并在文档中废止。

**测试缺口确认**：`sqliteLocalDataAdapter.test.ts` 14 个用例中，幂等只覆盖 `completeTask`（:250-255 用同一个 `completionKey`），无任何"同 key 二次调用 `createAdHocTask`"断言。

---

## 2. P1 无效日历日期可以写入数据库

**结论：完全存在，且后果比原报告更重。**

### 代码事实（已确认）

`parseDate` 有两份重复实现，都只做正则 + `new Date(y, m-1, d)`：

- `apps/web/src/data/local/sqliteLocalDataAdapter.ts:103-107`
- `apps/web/src/domain/scheduling/availability.ts:31-35`

JavaScript 的 `Date` 构造器对越界字段做静默进位。本机实测（node v26.4.0）：

| 输入         | 规范化结果   | 是否应拒绝          |
| ------------ | ------------ | ------------------- |
| `2026-02-31` | `2026-03-03` | 是                  |
| `2026-04-31` | `2026-05-01` | 是                  |
| `2026-02-29` | `2026-03-01` | 是（2026 非闰年）   |
| `2025-02-29` | `2025-03-01` | 是                  |
| `2026-13-01` | `2027-01-01` | 是                  |
| `2026-00-10` | `2025-12-10` | 是（月份 0 未拦截） |

**全部被静默接受。**

### 后果链（比"看不见"更重，已逐段核过）

1. 写入：`createAdHocTask` :1264 用 `requiredString(input, "scheduledDate")` 直写 SQLite，无任何日历有效性校验 → 库里存的是原样字符串 `2026-02-31`。
2. 排期不可见：`getSchedule` :1703 `datesBetween(start, end)` 生成的日期串永远合法；:1724 用 `task.scheduled_date === date` 字符串精确匹配 → 该任务**永远不落入任何 day 单元**。
3. Today 不可见：`getToday` :1607 `tasksBetween(businessDate, businessDate)` 同样取不到。
4. **日结会误扫它**：`triggerDayClose` 候选查询 :1432-1435 是 `scheduled_date <= $1 AND status='PENDING' AND locked=0` 的**字符串比较**——`"2026-02-31" < "2026-08-29"` 成立，脏行会被扫进日结。
5. **顺延会生成日期不自洽的 lineage**：`carryForwardTask` :1291-1292 用 `shiftDate(sourceSnapshot.scheduledDate, 90)`，而 `shiftDate` → `parseDate` 会把 `2026-02-31` 规范化成 `2026-03-03` 再算窗口 → 产生"来源行 02-31 / 目标行 03-xx"的顺延记录，历史链日期自相矛盾。

所以完整后果是：**数据库有行 → 排期/Today 都看不见 → 但日结会扫到它并产生日期不自洽的顺延记录**。助教既发现不了，也没法从 UI 清理。

### 可达性

UI 侧 antd DatePicker / `<input type="date">` 一般不产生 `02-31`；改期/跨学生拖拽的 `targetDate` 由单元格日期生成，也是合法日期。所以当前**经 UI 难以触发**，但数据层完全不设防。可达的旁路包括：Excel 导入解析出的日期串（`sqliteLocalDataAdapter.test.ts:1186` 那条导入用例走的正是外部日期源）、未来 Tauri 深链/脚本、以及任何直接调 adapter 的代码。

**严重度**：维持 P1（数据完整性）。

**修复建议**：两处 `parseDate` 加 round-trip 校验（`formatDate(parseDate(v)) !== v` → 抛 `ApiError(422, …, "INVALID_DATE")`）；在 `createAdHocTask` / `rescheduleTask` 入口对 `scheduledDate`、`targetDate` 显式校验。成本极低。

**测试缺口确认**：16 文件 / 84 用例全部使用真实日期，无 `02-31` / `04-31` / 闰年 `02-29` 的 round-trip 断言。

---

## 3. P2 BLOCKED 任务可以绕过卡片禁用逻辑被拖拽改期

**结论：原判定不成立（改判）。但同一区域存在一条更严重的、原报告未发现的缺陷。**

### 先裁决：文档到底要求 BLOCKED 能不能改期

| 来源                                           | 内容                                                |
| ---------------------------------------------- | --------------------------------------------------- |
| `DocsHarness/01` §7.1 状态机（:724）           | `BLOCKED --> PENDING: 人工重新安排`                 |
| `DocsHarness/01` §7.3 异常表（:749）           | 找不到下一可学习日 → 任务标记 BLOCKED，进入今日异常 |
| `DocsHarness/02` §9.4 `rescheduleTask`（:950） | **仅允许 PENDING/BLOCKED**                          |
| `DocsHarness/02` §9.4 `lockTask`（:964）       | 只有 PENDING/BLOCKED 可锁定                         |

→ **改期 BLOCKED 是文档明确要求的动作**，而且是 BLOCKED 唯一的出口（这是它存在的意义：任务卡在没有可学习日的地方，靠助教手动挪走）。

### 因此逐层判定

| 层             | 位置                                  | 行为                                                      | 判定     |
| -------------- | ------------------------------------- | --------------------------------------------------------- | -------- |
| domain         | `taskTransitions.ts:135-151`          | 只拒 `locked` / `CARRIED_OVER` / `CANCELLED`              | **正确** |
| 后端 SQL       | `sqliteLocalDataAdapter.ts:1892-1898` | `WHERE id=? AND version=? AND locked = 0`，无 status 条件 | **正确** |
| Schedule 拖拽  | `StudentSchedulePage.tsx:1370`        | `immovable = task.locked \|\| task.carriedOver === true`  | **正确** |
| Workbench 拖拽 | `StudentWorkbenchPage.tsx:813`        | 同上                                                      | **正确** |
| 卡片           | `TaskCard.tsx:123`                    | `locked = task.locked \|\| task.status === "BLOCKED"`     | **错误** |

原报告把"拖拽不拦 BLOCKED"当缺陷，方向反了——**拖拽是对的，卡片是错的**。

### 由此定位出两条真缺陷

**（a）P2 — `TaskCard.tsx:123` 误锁 BLOCKED，关掉了文档要求的唯一出口**

`:123` 之后：`actionable = !locked && !history`（:128）→ `menuItems` 传入 `locked: !actionable`（:137）→ 右键菜单的"改期"被禁用；`:171` 优先级切换也禁用。于是 PRD §7.1 的 `BLOCKED --> PENDING: 人工重新安排` 在卡片 UI 上**无路可走**，只剩拖拽这一条未在文档中说明的旁路。这正是原报告观察到的"卡片禁用但能拖"现象的根因——不一致是真实的，只是错在卡片那一侧。

**（b）P1 — BLOCKED 在实现里是单向终止状态，永远回不到 PENDING**（原报告未发现）

- `taskTransitions.ts` 的 `rescheduleTask` 返回值沿用 `...task`（:167-177），**不改变 `status`**；
- `sqliteLocalDataAdapter.ts:1892` 的 UPDATE 注释明写"状态不在 SET 里：改期不改变完成状态，也不推进 Track"，SET 列表确实不含 status；
- 全库检索 `SET status = 'PENDING'` 只有两处：`undoCarryover`（:1586，仅 `CARRIED_OVER → PENDING`）与 `reopenTask`（:1836，仅 `COMPLETED → PENDING`），**都不覆盖 BLOCKED**；
- 而 `carryForwardTask` 只接受 `status === "PENDING"`（:253），BLOCKED 也进不了顺延。

→ 任务一旦 BLOCKED，即使被拖到有效日期，也仍带 `BLOCKED` 状态：仍计入 `blockedTasks`（adapter :1637 / `TodayPage.tsx:523` 的红色指标），`TaskDetailDrawer`（:36）仍显示"已阻塞"红标，且永远无法完成。**PRD §7.1 的 `BLOCKED --> PENDING` 边在实现中不存在。**

**修复建议**

1. `TaskCard.tsx:123` 去掉 `|| task.status === "BLOCKED"`，改为只对 BLOCKED 关闭"勾选完成"（BLOCKED 确实不可完成），保留改期与菜单；
2. `rescheduleTask`（domain + adapter SQL）对 `status === "BLOCKED"` 的输入显式落到 `PENDING`，落点应是"改期成功即解除阻塞"；
3. 补测试：`BLOCKED + locked=false` 可改期、改期后 `status === "PENDING"`。

**测试缺口确认**：`taskTransitions.test.ts` 与 adapter 测试覆盖了 `locked`、`CARRIED_OVER`、`CANCELLED`、stale version，无一条覆盖 `BLOCKED + locked=false` 的改期或改期后状态归位。

### 附带：今日异常队列属于范围声明，不计 GAP

PRD §7.3 的"进入今日异常"与 SDD §11（`02:1173` `GET /today/exceptions`）在 `DocsHarness/04` 与 `ADR-002` 的本地范围内均无对应——`04` 全文未提异常队列，`ADR-002` "未决产品选择" 也未提。前端只有 `TodayPage.tsx:523` 的一个 blocked 计数，没有可操作的异常列表。这属于 04 已收窄的范围，记为文档/范围声明债，不计 GAP。

---

## 4. 契约问题

### 4.1 `currentVersion()` 乐观锁 —— 不是漂移，是已记录的产品决策

**代码事实确认**（`sqliteLocalDataAdapter.ts:1731-1739` 注释解释得很清楚）：

| 命令                          | 版本来源                                                  |
| ----------------------------- | --------------------------------------------------------- |
| `updateTask` (:1923)          | `currentVersion()` — 数据库当前版本                       |
| `linkMainTask` (:2026)        | `currentVersion()`                                        |
| `reorderTask` (:2117)         | `currentVersion()`                                        |
| `rescheduleTask` (:1868-1910) | 事务内读到的行版本                                        |
| **`deleteTask` (:2047)**      | **`requiredNumber(input, "expectedVersion")` — 严格校验** |

**但这不是契约漂移**，而是已被文档与测试双向下锚的明确规则：**破坏性命令（删除）严格校验 `expectedVersion`；非破坏性命令（改期/更新/关联/重排）以数据库当前版本为准、last-write-wins。**

证据：

- `docs/migration/flowclass/acceptance.md:111` 已作为"产品调整：排期修改直接生效"记录在案；
- 测试双向下锚：`sqliteLocalDataAdapter.test.ts:765` "applies a move even when the caller passes a stale version" + `:736` "does not delete a task when delete version is stale"。

**残留问题只是文档层面**：`DocsHarness/04` §19.9（:1423）只写了"删除契约已收口：严格校验 expectedVersion"，没有对称说明非破坏性命令的宽松策略，读者容易误以为全局严格。建议在该句补一句"改期/更新/关联/重排为 last-write-wins，见 acceptance.md 产品调整"。**文档债，不是缺陷。**

### 4.2 跨学生拖拽保留 `parentTaskId` / `linkedParentTaskId` —— 建议从"待产品确认"改判为 P3 一致性缺陷

**代码事实确认**：`sqliteLocalDataAdapter.ts:1892-1898` 的 SET 列表清空了 `track_id`、`template_version_id`、`template_item_id`，**未动 `parent_task_id` 与 `linked_parent_task_id`**。

原报告列为"待产品语义确认"。但不宜再挂着：`taskTransitions.ts:132-133` 的注释已确立原则——"跨学生移动时，任务会脱离原 Track，转成独立临时任务；原 Track 指针不推进也不回退，避免把一个学生的轨道实例挂到另一个学生"。**代码自己已经按"脱离原学生结构关系"清了 track 三列，漏掉父子两列违反的是它自己声明的规则**，只是没写成产品条款。

→ 建议改判 P3，确定性修复：跨学生时一并置 `parent_task_id = NULL`、`linked_parent_task_id = NULL`（或按产品决定级联搬迁整棵子树）；并补断言。

测试侧确认：`:812` "moves an ad-hoc task to another student" 只断言 `student_id`/`scheduled_date`，`:864` 只断言 track 脱离，**均无父子关系断言**。

### 4.3 `runtimePlatformAdapter` 永远返回浏览器适配器 —— 保留 MANUAL

**确认**：`apps/web/src/lib/platform/runtimePlatformAdapter.ts:6-8` 无条件 `return browserPlatformAdapter`；该目录下只有 `browserPlatformAdapter.ts`、`PlatformAdapter.ts`、`runtimePlatformAdapter.ts`，**不存在 Tauri 实现**。文件保存依赖 `<a download>`、剪贴板依赖浏览器 API。

**注意与数据层区分**：`apps/web/src/data/runtime.ts:17-23` 是另一层，它正确按 `__TAURI_INTERNALS__` 在 `TauriSqliteStorage` / `BrowserSqliteStorage` 之间切换，没有问题。两者不要混淆。

Tauri WebView2 下 `<a download>` 与 `navigator.clipboard` 的实际行为无法静态定性，**维持 MANUAL**，需在桌面程序里手工验收导入/导出/复制三条路径。

---

## 5. 测试 / 文档 / 发布债务

### 5.1 测试债务（确认）

当前 16 文件 / 84 用例全绿（实测 28.4s）。缺 4 类回归：

1. 同 `idempotencyKey` 二次调用 `createAdHocTask` 的返回形状与无副作用；
2. 非法日历日期（`02-31` / `04-31` / 非闰年 `02-29` / `13-01` / `00-10`）的 round-trip 拒绝；
3. `BLOCKED + locked=false` 的改期路径，及改期后状态归位为 `PENDING`；
4. 跨学生拖拽后 `parent_task_id` / `linked_parent_task_id` 的清理。

另有 1 类保留 MANUAL：真实 Tauri WebView 下的导入/导出/复制。

### 5.2 文档债务（确认，并新增 2 条）

| 项                                     | 现状                                                                                                                                                          | 处置                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/runbooks/local-development.md:9` | 写 "Node 20+ / pnpm"；根 `package.json:7` 与 README 要求 `>=24.15.0`                                                                                          | **照文档做会失败**。实测本机默认 PATH 的 node 是 v22.22.2（不满足 engines），系统 node v26.4.0 才满足。建议改为 `Node >= 24.15.0` 并注明"不要使用 22.x"                     |
| `DocsHarness/04` §19.9:1423            | 只写"删除严格校验 expectedVersion"，未说明非破坏性命令宽松                                                                                                    | 补一句对称说明                                                                                                                                                              |
| `acceptance.md:20`                     | 记 "59 个可达源码模块"，实测 61                                                                                                                               | 该行已注明"以 `pnpm check` 实时输出为准"，可接受漂移，但建议同步为 61                                                                                                       |
| `baseline.md` F0~F5 收口               | 已有（2026-08-28）：F0-004 跳过不可补、F0-005 部分完成（仅 Calendar PoC 两张截图，缺 AttendanceSheet/Availability）、F1 等效完成、F3/F4 门禁失效、F5 等效完成 | 残余：**DLY-T08 无独立用例**，仅以 `sqliteLocalDataAdapter.test.ts` "runs the student-template-track execution flow atomically" 内的 ACC-065 断言作等效证据，弱于零写入断言 |

### 5.3 发布债务（确认）

- `HEAD = 3b93f57`（2026-08-19 00:36，"fix(backend): path/body taskId guard…"），**不含**本地 SQLite / Tauri 迁移。
- 工作树 274 条变更：185 条删除（整个 `apps/api` Spring/Java 栈）、57 条修改、31 条未跟踪、1 条重命名。
- 桌面产物存在：`apps/desktop/src-tauri/target/release/assistant_desktop.exe`，说明 `pnpm build` 跑过。
- → **fresh clone 从该 HEAD 无法重建当前产品**。提交策略按 `DocsHarness/04` §19.9 的约定由用户决定，本次未擅自提交。

---

## 6. 对照 DocsHarness 的交付就绪度判定

### 6.1 基线层级

`DocsHarness/04` 是现行基线（取代 01/02/03 的在线栈部分）。其 §19.9 明确规定："原清单中的历史 `[ ]` 未逐项改写，不应覆盖本附录和 `docs/migration/flowclass/acceptance.md` 的证据判定。"

→ 因此真正的判定基线 = **04 §16 的 F0~F9 阶段门禁 + `acceptance.md` 的 46 项 ACC**，而不是 04 §16 里那些未勾选的复选框。

### 6.2 F0~F9 逐段现状

| 阶段               | 状态               | 依据                                                                                                                                                                |
| ------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F0 冻结与基线      | 部分完成           | F0-001/002/003/006 有产物（`baseline.md`、`provenance.md`、回归用例）；**F0-004 永久不可补**（旧页面依赖已删的 Spring+PostgreSQL）；F0-005 仅 Calendar PoC 两张截图 |
| F1 样式兼容层      | 等效完成           | 手写 scoped CSS 等价达成 R8 意图，非 STYLE-001 原文 Tailwind 方案（已 superseded）                                                                                  |
| F2 Calendar PoC    | 完成               | 截图 + Partial adoption 决策 + 哈希现场复核吻合                                                                                                                     |
| F3 Matrix 融合     | 等效完成           | 过渡期门禁"在现有 WD 后端数据上可完整操作"随后端退役失效，以最终 SQLite 验收为准                                                                                    |
| F4 Availability UI | 等效完成           | 同上                                                                                                                                                                |
| F5 Delay 提纯      | 等效完成（弱证据） | TS 算法与测试在库；与 Java 行为对照仅有基线日单侧证据；**DLY-T08 缺独立用例**                                                                                       |
| F6 统一命令        | 完成               | 04 §19.9 明载；三视图同源有测试                                                                                                                                     |
| F7 本地 SQLite     | 完成               | 实测 local-runtime 61 模块无 HTTP transport                                                                                                                         |
| F8 清理在线架构    | 完成               | `apps/api` 已删，无 Java/PostgreSQL 依赖                                                                                                                            |
| F9 完整验收        | **未收口**         | AUTO 42 / MANUAL 4 / GAP 0，**MANUAL 4 无用户签字记录**                                                                                                             |

### 6.3 判定：**当前不可交付**

不是因为自动化没过（自动化全绿），而是四件事：

1. **F9 的 4 项 MANUAL 复核没有签字证据。**
   `acceptance.md` §"MANUAL 项的复核步骤"列了 5 步（exe 无登录启动 / 重启数据仍在 / 鼠标拖拽改期 / locked 拖不动 / 滚动手感），仓库内没有任何执行结果记录。exe 存在只证明构建跑过，不证明这 5 步被验过。这是 04 §19.9 自己点名"仍需用户在桌面窗口确认"的部分，也是唯一能证明"这是能用的桌面程序而非能跑的测试集"的证据。

2. **本次复核新增/改判的 3 条真实缺陷全部落在 46 项 ACC 矩阵之外。**
   ACC 矩阵 GAP=0 只说明"矩阵覆盖到的都过了"，而这 46 项里**没有**临时任务创建幂等、**没有**日期合法性、**没有** BLOCKED 状态出口。矩阵盲区不等于产品无缺陷。

3. **F0 的回退基线不完整，而它恰恰是当前最需要的。**
   F0-004 永久缺失、F0-005 只有 2/5 张截图；同时 HEAD 落后工作树 274 个变更、fresh clone 不可重建。没有提交就没有可回退基线，风险敞口是全开的。

4. **`docs/runbooks/local-development.md:9` 的 Node 版本错误会让接手人直接踩坑。**
   照文档准备 Node 20/22 会在 `engines` 校验处失败。这是"照文档做会失败"级别的文档错误，交付前必须改。

### 6.4 建议的最小放行路径

按依赖顺序，前三步是硬门槛：

1. **把工作树提交掉**（184 条删除 + 其余修改，可拆成"退役在线栈"与"本地 SQLite/Tauri 落地"两个提交），让 HEAD 可重建当前产品。提交策略需用户拍板。
2. **修 P1 三条**：无效日期校验（半天）、临时任务幂等契约（半天，含决定"要幂等"还是"废止幂等"）、BLOCKED 改期后归位 PENDING（半天，含 `TaskCard:123` 去误锁）。
3. **补 4 类回归用例**，让这三条成为 AUTO 而非"靠人记得"。
4. **执行并签字 MANUAL 5 步**，把结果写进 `acceptance.md` 的复核清单。
5. 顺手改 `local-development.md` 的 Node 版本、`04` §19.9 的 expectedVersion 对称说明、补 DLY-T08 独立用例。

---

## 7. 与上一轮审计（audit-2026-08-27）的差异

| 项                  | 上一轮           | 本次                                                                |
| ------------------- | ---------------- | ------------------------------------------------------------------- |
| 临时任务幂等        | 未提出           | 新增：形状错误 + 幂等事实上未生效                                   |
| 无效日历日期        | 未提出           | 新增：可入库 + 日结误扫 + lineage 日期不自洽                        |
| BLOCKED 拖拽        | 未提出           | **改判为不成立**；另发现 BLOCKED 无出口（P1）与 TaskCard 误锁（P2） |
| currentVersion 契约 | 记为"契约漂移点" | 改判为已记录的产品决策（acceptance.md + 双向测试），降级为文档债    |
| 跨学生父子关系      | 记为"待产品确认" | 改判为 P3 一致性缺陷（违反代码自述原则）                            |
| Node 版本文档       | 未提出           | 新增                                                                |
| 发布债务            | 已记录           | 复核确认（274 条变更 / HEAD 3b93f57）                               |
