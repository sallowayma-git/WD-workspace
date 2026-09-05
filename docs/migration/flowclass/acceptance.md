# Flowclass 融合验收矩阵（任务书第 19 节）

任务书 `DocsHarness/04_Flowclass到WD_助教工作台二开融合任务书_v1.0.md` 第 19 节共定义 **46** 个验收项（`ACC-001~005`、`010~015`、`020~024`、`030~033`、`040~045`、`050~056`、`060~067`、`070~074`）。编号不连续是原文如此，不存在 006-009 等条目。

## 判定口径

| 判定       | 含义                                                                       |
| ---------- | -------------------------------------------------------------------------- |
| **AUTO**   | 有自动化测试直接断言该行为；回归时 `pnpm check` 会失败                     |
| **MANUAL** | 实现存在，但只能由人在运行中的桌面程序里确认（进程、窗口、滚动手感、拖拽） |

不使用"已实现即通过"。凡是只能靠读代码相信的，一律记为 MANUAL 并给出复核步骤。

运行全部自动化证据：

```powershell
pnpm check
```

2026-08-27 基线：14 个测试文件、61 个用例、Rust fmt/clippy 全绿，local-runtime 门禁报告 59 个可达源码模块且无 HTTP transport（2026-08-29 复核实测为 61 个可达源码模块）。修复轮后请以 `pnpm check` 实时输出为准（截至 2026-08-29 修复轮，已增至 16 文件 / 92 用例）。

## 19.1 基础应用

| ACC                             | 判定             | 实现                                                                                   | 证据                                                                                                                                                                                          |
| ------------------------------- | ---------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACC-001 启动不要求登录          | MANUAL（有门禁） | `apps/web/src/main.tsx` 无 auth provider；`apps/web/src/app/App.tsx` 无登录路由        | `scripts/check-local-runtime.mjs` 从 `main.tsx` 递归遍历 import 图，可达 `features/auth/*` 即失败；`data/runtime.test.ts` 断言首屏取数不调用 `fetch`。人工复核：启动 exe 应直接进入今日工作台 |
| ACC-002 不要求 PostgreSQL       | AUTO             | `apps/desktop/src-tauri/migrations/0001_local_core.sql`；预加载 `sqlite:assistant.db`  | `data/runtime.test.ts`："uses the Tauri SQLite storage inside the desktop runtime"；`sqliteLocalDataAdapter.test.ts` 全部用例跑在真实 migration 上                                            |
| ACC-003 不要求 Java/Spring      | MANUAL（有门禁） | `apps/api` 已删除；根 `package.json` 无 api/gradle 脚本；CI 无 Java job                | `pnpm check:web` 的 local-runtime 门禁（已加入 `.github/workflows/ci.yml`）。人工复核：不启动任何其他进程，直接运行 exe                                                                       |
| ACC-004 核心数据写入本地 SQLite | AUTO             | `data/local/sqliteLocalDataAdapter.ts`；`apps/desktop/src-tauri/src/local_database.rs` | `sqliteLocalDataAdapter.test.ts`："runs the student-template-track execution flow atomically"                                                                                                 |
| ACC-005 重启后数据仍在          | AUTO             | `local_database.rs` 使用 `app_config_dir` + `create_if_missing` + WAL                  | `sqliteLocalDataAdapter.test.ts`："persists local task data across a database reopen"（关闭文件库再打开，跳过 migration 仍可读）                                                              |

## 19.2 学生

| ACC                              | 判定 | 实现                                                                                                            | 证据                                                                                                                                                                 |
| -------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACC-010 学生列表可搜索           | AUTO | `features/students/StudentListPage.tsx` 搜索框 + adapter 的 `LIKE` 查询                                         | `StudentListPage.test.tsx`："searches the local student list by the typed term"（断言检索词进入本地查询，而非只过滤已渲染的表格）                                    |
| 产品调整：学生编号可留空         | AUTO | `StudentListPage.tsx` 不要求填写编号；`sqliteLocalDataAdapter` 在本地生成唯一编号                               | 学生列表测试与 SQLite 学生创建测试；界面提示留空自动生成                                                                                                             |
| 产品调整：取消批量选择           | AUTO | 页面不提供批量任务选择或批量操作入口，任务仅保留逐项 Checkbox                                                   | `StudentWorkbenchPage`、`TodayPage` 与 `TaskCard` 源码审计；无 `rowSelection`/批量选择 UI                                                                            |
| ACC-011 姓名进入资料             | AUTO | `StudentListPage.tsx` 姓名列链接                                                                                | `StudentListPage.test.tsx`：`打开 林同学 资料` 指向 `/students/{id}/profile`                                                                                         |
| ACC-012 生词本独立入口           | AUTO | `StudentListPage.tsx`、`TodayPage.tsx`、`StudentWorkbenchPage.tsx` 各有独立链接                                 | `StudentListPage.test.tsx`：`林同学 生词本` 指向 `/students/{id}/vocabulary`                                                                                         |
| ACC-013 排期独立入口             | AUTO | 同上                                                                                                            | `StudentListPage.test.tsx`：`林同学 排期` 指向 `/students/{id}/schedule`                                                                                             |
| ACC-014 可设置默认学习日和分钟数 | AUTO | `features/students/WeeklyPatternEditor.tsx` + `AvailabilityDayRow.tsx`；`saveWeeklyPattern` 退休旧版本并写 7 行 | `AvailabilityDayRow.test.tsx`（关闭日归零、重开恢复最近正值）；`sqliteLocalDataAdapter.test.ts` 的周模式写入与顺延结果                                               |
| ACC-015 可设置具体日期 override  | AUTO | `features/students/WeekPlanEditor.tsx`；`saveWeekPlan` 支持 `BASE_PATTERN`/`PREVIOUS_WEEK`/`MANUAL`             | `sqliteLocalDataAdapter.test.ts`："stores specific-date overrides and lets them beat the weekly pattern"（关掉开放的周三、打开关闭的周六，并验证 schedule 投影跟随） |

## 19.3 模板 / Track

| ACC                                  | 判定 | 实现                                                                                                                                                        | 证据                                                                                                                                                                                                      |
| ------------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACC-020 可创建有序 TaskTemplate      | AUTO | `features/templates/TemplateDetailPage.tsx` 保存时重排 ordinal；`replaceVersionItems`/`publishVersion`；DB 唯一约束 `UNIQUE (template_version_id, ordinal)` | `sqliteLocalDataAdapter.test.ts`：挂轨后 `itemOrdinal` 为 `[1, 2]`                                                                                                                                        |
| ACC-021 可挂载到学生                 | AUTO | `features/planning/MountTrackModal.tsx`；`mountTrack`                                                                                                       | `sqliteLocalDataAdapter.test.ts`：`mountTrack` 后 `currentOrdinal` 为 1                                                                                                                                   |
| ACC-022 Track 当前 ordinal 可见      | AUTO | `features/planning/TrackProgressPanel.tsx` 渲染 `currentOrdinal/endOrdinal`                                                                                 | `TrackProgressPanel.test.tsx`："shows the track current ordinal against its end ordinal"                                                                                                                  |
| ACC-023 完成当前任务推进且只推进一次 | AUTO | `domain/task/taskTransitions.ts` 幂等键短路 + 连续前缀推进；`completeTask` 单事务                                                                           | `taskTransitions.test.ts`："advances only a continuous completed track prefix"、"treats repeated keyed completion as an idempotent no-op"；`sqliteLocalDataAdapter.test.ts` 同键重复完成后 ordinal 仍为 2 |
| ACC-024 未完成/改期/顺延均不推进     | AUTO | 改期与顺延的返回类型不含 track；SQL 语句列表不含 `student_task_track`                                                                                       | `taskTransitions.test.ts`："reschedules without changing the track ordinal"；`sqliteLocalDataAdapter.test.ts` 改期后与顺延后各断言一次 ordinal 未动                                                       |

## 19.4 Today

| ACC                           | 判定 | 实现                                                                | 证据                                                                                              |
| ----------------------------- | ---- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| ACC-030 默认今日工作          | AUTO | `TodayPage.tsx` 用 `useBusinessDate()`（本机日历日）                | `TodayPage.test.tsx`："opens on the local business date and groups tasks by student"              |
| ACC-031 按学生分组            | AUTO | `TodayPage.tsx` 每个学生一张卡                                      | 同上（断言甲学生的卡里没有乙学生的任务）                                                          |
| ACC-032 Checkbox 完成即时刷新 | AUTO | `TodayPage.tsx` 乐观更新 + `invalidateTaskViews`                    | `TodayPage.test.tsx`："completes a task from its checkbox and immediately reflects the new state" |
| ACC-033 临时任务可直接录入    | AUTO | `features/today/InlineTaskComposer.tsx`（Today 与矩阵空单元格共用） | `TodayPage.test.tsx`："creates an ad-hoc task inline for one student"                             |

## 19.5 Workbench Matrix

| ACC                                 | 判定           | 实现                                                                                                       | 证据                                                                                                              |
| ----------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| ACC-040 学生纵轴、日期横轴          | AUTO           | `StudentWorkbenchPage.tsx` 学生固定列 + 每日一列                                                           | `StudentWorkbenchPage.test.tsx`：表头为 1 + 7 列，且每个日期都出现                                                |
| ACC-041 第一列 sticky               | AUTO           | `vendor/flowclass/matrix/StudentTaskMatrixShell.tsx` 固定左列 `position: sticky`                           | `StudentWorkbenchPage.test.tsx`：断言渲染出的学生单元格 `position: sticky; left: 0`                               |
| ACC-042 横向滚动                    | AUTO（布局）   | `StudentTaskMatrixShell.tsx` 的 `scroll={{x}}` 与 `minWidth`；`flowclass-compat.css` 的 `overflow-x: auto` | `StudentWorkbenchPage.test.tsx`：内容宽 1300px，宽于视口。真实滚动手感另需人眼确认                                |
| ACC-043 Compact/Expanded            | AUTO           | `StudentWorkbenchPage.tsx` 密度配置（紧凑 2 张 / 扩展 5 张）                                               | `StudentWorkbenchPage.test.tsx`：紧凑隐藏第 3 张并显示 `+1`，切扩展后出现且 `+1` 消失                             |
| ACC-044 一个 cell 可有多个 TaskCard | AUTO           | 同上，单元格内纵向堆叠                                                                                     | 同上（同一周一单元格内两张卡同时可见）                                                                            |
| ACC-045 60x14 数据流畅              | AUTO（虚拟化） | `StudentTaskMatrixShell.tsx` 使用 TanStack Virtual                                                         | `StudentTaskMatrixShell.test.tsx`："virtualizes a 60 by 14 matrix instead of mounting all rows"。帧率另需人眼确认 |

## 19.6 Calendar

| ACC                                           | 判定                | 实现                                                                                                      | 证据                                                                                                                                                                                                                  |
| --------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACC-050 单学生 Day 可用                       | AUTO                | `StudentSchedulePage.tsx` 日视图；本地 adapter 按视图收窄窗口                                             | `sqliteLocalDataAdapter.test.ts`："scopes each schedule view to the window that view actually shows"（day 为 1 天）；`StudentSchedulePage.test.tsx` 视图切换断言                                                      |
| ACC-051 单学生 Week 可用                      | AUTO                | 同上；周视图窗口对齐到 ISO 周一                                                                           | 同上（`2026-08-20` 周四对应窗口 `08-17` 至 `08-23`）                                                                                                                                                                  |
| ACC-052 单学生 Month 可用                     | AUTO                | 月视图由移植的 `vendor/flowclass/calendar/MonthView.tsx` 排版，单元格仍是 WD `DayCell`                    | 同上（month 为 42 天完整网格）；`StudentSchedulePage.test.tsx`："draws the month view with the ported Flowclass grid shell"；`calendar.test.tsx` 网格与表头                                                           |
| ACC-053 拖动任务可改日期                      | MANUAL（命令 AUTO） | `StudentSchedulePage.handleDragEnd` 调 `taskActions.reschedule`；`rescheduleTask` 单事务                  | 改期命令本身 AUTO：`taskTransitions.test.ts`："reschedules without changing the track ordinal"；`sqliteLocalDataAdapter.test.ts` 改期后 `scheduledDate` 变更。**指针拖拽手势未在 jsdom 中模拟**，需人工复核           |
| ACC-054 拖动不推进 Track                      | AUTO                | 改期路径不写 `student_task_track`                                                                         | `taskTransitions.test.ts` 与 `sqliteLocalDataAdapter.test.ts`（同 ACC-024）                                                                                                                                           |
| ACC-055 locked task 不可拖                    | AUTO                | `useDraggable({ disabled })` + `handleDragEnd` 用 `canMoveCalendarEvent` 拦截 + SQL `AND locked = 0` 兜底 | `StudentSchedulePage.test.tsx`："refuses to arm a drag on a locked task"；`calendar.test.tsx`："is the single move guard for locked tasks and no-op moves"；`taskTransitions.test.ts`："rejects moving a locked task" |
| ACC-056 无 Course/Class/Teacher/Location 残留 | AUTO                | `TaskCalendarEvent` 只含任务字段；Flow 的考勤/课程 UI 全部 DROP                                           | `StudentSchedulePage.test.tsx`："shows no course, class, teacher or location wording anywhere in a view"（逐视图扫描页面文本，命中即失败）                                                                            |

## 19.7 Carry Forward

| ACC                                  | 判定 | 实现                                                                               | 证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ---- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACC-060 未完成任务可顺延到下一学习日 | AUTO | `domain/task/taskTransitions.ts` 的 `carryForwardTask`；`TaskContextMenu` 顺延项   | `taskTransitions.test.ts`："carries the current snapshot and preserves bidirectional lineage"；`TaskContextMenu.test.tsx`："enables carry only when the task is eligible"                                                                                                                                                                                                                                                                                                                                                             |
| ACC-061 跳过不可学习日               | AUTO | `domain/scheduling/availability.ts` 的 `findNextAvailableStudyDate`（90 天上限）   | `taskTransitions.test.ts`："skips a closed Thursday and lands on an open Friday"；`sqliteLocalDataAdapter.test.ts` 周三源任务落到周五                                                                                                                                                                                                                                                                                                                                                                                                 |
| ACC-062 尊重 date override           | AUTO | `availability.ts` 中 override 优先于周模式                                         | `taskTransitions.test.ts` 三个 override 用例；`sqliteLocalDataAdapter.test.ts` 的 override 用例                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ACC-063 原任务历史保留               | AUTO | 源置 `CARRIED_OVER`，从不删除                                                      | `sqliteLocalDataAdapter.test.ts` 的 lineage 自连接断言                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ACC-064 新旧 task 有双向 lineage     | AUTO | `carried_from_instance_id` 与 `carried_to_instance_id` 在同一事务内回填            | 同上（两个方向都断言）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ACC-065 Track pointer 不动           | AUTO | 顺延事务只写 `task_instance`                                                       | `sqliteLocalDataAdapter.test.ts`：顺延**之后**重新读取 track，`currentOrdinal` 仍为 2                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ACC-066 重复执行不创建多个目标实例   | AUTO | 复用既有 target + DB 唯一约束 `uq_task_carry_target`                               | `taskTransitions.test.ts`："reuses an existing target instead of duplicating it"；重跑日结 `scanned` 为 0                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ACC-067 日结从首页执行               | AUTO | 独立日结管理页已删除；`TodayPage.tsx` 的首页数字卡片右侧直接调用 `triggerDayClose` | adapter 级证据：`sqliteLocalDataAdapter.test.ts`："runs day close from a stable local candidate snapshot"（`triggerDayClose` 快照扫描、锁定/未来任务排除、重跑 `scanned` 为 0）；`AppShell.test.tsx`："keeps the three frozen top-level navigation meanings distinct" 断言无"日结管理"独立入口。首页按钮→`triggerDayClose` 的页面级断言未在 `TodayPage.test.tsx` 中覆盖。首页"执行日结"返回汇总一句话（顺延/无可用学习日/失败计数）；顺延明细卡按项可查（原日期、目标日期、学生、任务、原因、执行时间与撤销入口）；不渲染逐项运行日志 |

## 19.8 三视图一致性

| ACC                                           | 判定                                      | 实现                                                                                            | 证据                                                                                                                                      |
| --------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| ACC-070 Today 勾选完成后 Matrix 同步          | AUTO                                      | Today 的全部任务 mutation 统一走 `invalidateTaskViews`                                          | `taskActions.test.ts`："refreshes every projection of the shared task truth"；`sqliteLocalDataAdapter.test.ts` 三视图读到同一条 task 真值 |
| ACC-071 Matrix 完成后 Calendar 同步           | AUTO                                      | 矩阵的 `invalidate()` 同样走 `invalidateTaskViews`                                              | 同上                                                                                                                                      |
| ACC-072 Calendar 拖动后 Today/Matrix 日期同步 | MANUAL（命令链 AUTO，拖拽手势需人工复核） | `StudentSchedulePage` 的 mutation `onSettled` 调 `invalidateTaskViews`                          | 同上。命令链（`taskActions.test.ts` 四视图统一失效断言）为 AUTO；拖拽手势本身同 ACC-053 为 MANUAL，故整行记 MANUAL                        |
| ACC-073 Carry forward 后三视图均显示新日期    | AUTO                                      | Today/Workbench/Schedule 共用 `task_instance` 真值与同一 `tasksBetween` 查询                    | `sqliteLocalDataAdapter.test.ts`：顺延后分别取三个投影，断言目标任务的 `status`/`scheduledDate`/`version` 完全一致                        |
| ACC-074 来源历史不会被误当当前 PENDING        | AUTO                                      | `scheduleApi` 补齐 `carriedOver`；`TaskCard` 对 history 行禁用勾选、弱化样式、禁用菜单与拖拽    | `StudentSchedulePage.test.tsx`："keeps a carried-over source visible but not tickable"；日结候选查询只取 `PENDING`，重跑 `scanned` 为 0   |
| 产品调整：工作台跨学生拖拽                    | AUTO（命令）                              | `StudentWorkbenchPage.tsx` 的学生-日期单元格均可 drop；跨学生时任务脱离原 Track 并转为 AD_HOC   | `workbenchDrag.ts` 测试跨学生目标学生及锁定/历史/同格拒绝；`sqliteLocalDataAdapter.test.ts` 断言 student/source/track 字段                |
| 产品调整：顺延任务可删除                      | AUTO                                      | 本地删除前清理顺延 lineage 外键；历史来源行保持不可误删，PENDING 目标可删                       | SQLite 删除/lineage 测试、过期 `expectedVersion` 测试与 `TaskCard` 菜单规则测试                                                           |
| 产品调整：排期修改直接生效                    | AUTO                                      | 本地 adapter 忽略陈旧界面版本，排期页不显示冲突确认或 `Task status does not allow rescheduling` | SQLite 陈旧 version 改期测试；`StudentSchedulePage` 不再渲染冲突 Alert/Modal                                                              |

## 产品调整补记（2026-08-28）

对应审计报告 `audit-2026-08-27.md` §4.1 的 AVL-006/AVL-007 ⚠️ 项与 §4.2 的 DLY-007 ⚠️ 项。三条均为记录在案的有意偏离或未启用的可选项，不计 GAP，也不改变上表任何 ACC 的判定。

| 记录                            | 形态         | 说明                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AVL-006 日期覆盖编辑形态        | 有意简化     | 日期覆盖编辑采用"整周替换式"周计划层：`WeekPlanEditor` 一次编辑 7 天（周一~周日），保存时 `saveWeekPlan` 整体替换该周的 override 行（DELETE+INSERT），而非 Flow Availability 的按日期单条增删模式。本产品以整周为覆盖计划的交互单位（`BASE_PATTERN`/`PREVIOUS_WEEK`/`MANUAL`），单日增删不单列入口 |
| AVL-007 override 持久层字段     | 功能超集     | 持久层 `student_date_override` 表在 domain 模型 `StudyDateOverride`（date/available/availableMinutes，另含可选 devicePolicy）之外，还含 `device_policy_override`、`source_type`、`note` 列（`0001_local_core.sql`），用于记录编辑来源与备注。domain 层只消费其子集，多余列不构成行为分叉           |
| DLY-007 availableMinutes>0 检查 | 可选项未启用 | `findNextAvailableStudyDate` 只检查 `available` 与设备策略，未启用任务书 §9.4 具体任务（DLY-007 复选框）标注为可选的"availableMinutes>0"检查；UI 层提示填写分钟数。启用会改变顺延落点语义（available=1 但 minutes=0 的日子将由"可落"变为"跳过"），留待产品决策 |

## 产品调整补记（2026-08-29 修复轮）

对应二次复核审计 `audit-2026-08-29-rereview.md` 判定的一条 P1 数据完整性缺陷、BLOCKED 状态机缺口与一条 P3 一致性问题，以及临时任务幂等契约的裁决。均已修复并补回归用例。

| 记录                                       | 形态           | 说明                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 临时任务创建幂等契约                        | 契约修正       | adapter 级 key 去重保留为纵深防御：同 key 重放现在返回完整任务视图（此前返回 `{taskId}`，任何持有稳定 key 的调用方重试都会拿到残缺形状）。key 仍由 UI 每次提交新生成——单机单用户下真实的重复提交向量（连击）已由 composer 的 pending 态阻断，而由载荷派生稳定 key 会吞掉用户故意创建的第二个同名任务。BR-012 字面只覆盖完成/顺延/挂载，不延伸到创建命令。测试："replays an ad-hoc creation with the same idempotency key as the full task view" |
| 无效日历日期拒绝（INVALID_DATE）            | 缺陷修复       | 两处 `parseDate`（adapter 与 availability）增加 round-trip 校验：`2026-02-31`/`04-31`/非闰年 `02-29`/`13-01`/`00-10` 一律 422 拒绝；`createAdHocTask`/`rescheduleTask`/`duplicateTask`/`createSubTask` 入口显式校验。修复前脏行原样入库后对排期/今日视图永远不可见，却仍被日结的 `scheduled_date <=` 字符串比较扫入，并经 `shiftDate` 规范化产生日期不自洽的顺延 lineage。测试："rejects calendar-impossible dates before anything is written"、taskTransitions 的 round-trip 用例 |
| BLOCKED 出口（PRD §7.1 落地）               | 缺陷修复       | `BLOCKED --> PENDING（人工重新安排）`此前在实现中不存在：改期不回置状态，任务一旦 BLOCKED 永远完成不了。现在改期命令（domain + adapter SQL）对 BLOCKED 显式归位 PENDING（落点即使是关闭日也照做并记 override）；`TaskCard` 不再把 BLOCKED 误当 locked——右键菜单/拖拽/优先级/删除恢复可用，仅禁用勾选完成（BLOCKED 不可完成也不可重开），并显示"阻塞"标签。测试："unblocks a BLOCKED task by rescheduling it back to PENDING"（adapter + domain 双层） |
| 跨学生父子指针清理                          | 一致性修复     | 跨学生改期与既有"脱离原 Track"规则对齐：`parent_task_id`/`linked_parent_task_id` 一并清空，避免把一个学生的子任务/关联关系挂到另一个学生的主任务上。测试："clears parent pointers when a task moves to another student"                                                                                                                                                    |
| DLY-T08 独立用例                            | 测试补强       | 顺延后 Track 零写入断言（`current_ordinal` 与行 `version` 均不变）独立成用例，不再只依赖 "runs the student-template-track execution flow atomically" 内的 ACC-065 等效证据。测试："leaves the track row untouched when a task is carried forward (DLY-T08)"                                                                                                                   |

以上修复不改写 19.1~19.8 的 ACC 判定：新增断言全部落在既有 ACC 覆盖之外（幂等重放形状、日历有效性、BLOCKED 出口、跨学生父子指针），属于矩阵盲区的回归补齐。

## 汇总

| 判定   | 数量                                    |
| ------ | --------------------------------------- |
| AUTO   | 42                                      |
| MANUAL | 4（ACC-001、ACC-003、ACC-053、ACC-072） |
| GAP    | 0                                       |

MANUAL 4 逐项口径：ACC-001/ACC-003 是 exe 进程级复核（无法靠 jsdom/静态门禁证明）；ACC-053/ACC-072 的改期命令链全部 AUTO，但指针拖拽手势无法在 jsdom 中模拟，故整行记 MANUAL，需按下方步骤 3 人工复核。

ACC-042 与 ACC-045 的布局与虚拟化有自动断言，只有"滚动手感/帧率"这一主观维度需要人眼确认，因此计入 AUTO，但在下方复核清单中保留一条（滚动手感属于 ACC-042 的复核清单项，不计入 MANUAL 数量）。

## MANUAL 项的复核步骤

在桌面程序里按顺序执行，全部通过才算 F9 收口：

1. **ACC-001 / ACC-003** — 不启动任何其他进程，直接运行
   `apps/desktop/src-tauri/target/release/assistant_desktop.exe`。
   期望：无登录界面，直接进入今日工作台；任务管理器中没有 java 或 postgres 进程。
2. **ACC-005 复核** — 新建一个学生，关闭程序，重新打开，学生仍在。
3. **ACC-053 / ACC-072** — 打开某学生排期的周视图，用鼠标把一张任务卡拖到另一天。
   期望：卡片落到新日期；切到今日工作台与学生工作台，同一任务显示的日期已更新；Track 序号未变。
4. **ACC-055 复核** — 对一张 locked 任务卡尝试拖动。期望：拖不起来，而不是拖完再报错。
5. **ACC-042 / ACC-045 复核** — 学生工作台横向滚动 14 天，滚动应跟手；60 名学生时纵向滚动不卡顿。

## 已知边界（不是 GAP，是记录在案的产品选择）

见 `docs/adr/ADR-002-local-desktop-runtime.md` 的"未决产品选择"一节：导入 job 仅存活于单次会话、日结不落 run 记录、全局搜索用 LIKE、Calendar 采用 Partial、无自动备份。
