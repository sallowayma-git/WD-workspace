# Flowclass → WD 助教工作台二开融合任务书 v1.0

> 文档性质：本地改造执行任务书 / 模块移植索引 / 验收清单  
> 目标仓库：`WD-workspace-main`  
> 代码供体：`flowclass-main`  
> 编制日期：2026-08-19  
> 核心原则：**WD 保持母仓；Flowclass 只作为高价值代码供体。优先 COPY，其次 ADAPT，再次 EXTRACT，明确 DROP。最终产品仅为本地单用户助教工作台。**

---

## 0. 文档使用方式

这份任务书不是产品 PRD，也不是架构愿景文档，而是用于本地逐项执行改造的工程清单。建议实际改造时：

1. 每完成一项任务，直接把对应 `- [ ]` 改成 `- [x]`。
2. 每个模块开始前先看“源文件索引”，不要先凭印象重写。
3. Flowclass 源码进入 WD 时，在文件头保留“源路径 + 改造说明”，方便以后追踪。
4. **不允许同时大改 UI、业务规则和持久化。** 每个阶段只解决一个变量。
5. Spring API 当前已有大量正确业务逻辑，因此在本地化迁移完成前将其保留为 **reference implementation / executable specification**，不要先删除。
6. 最终验收不是“Flowclass 文件搬了多少”，而是：Calendar、矩阵、学习日、顺延四部分和 WD 的 Track / Checklist / Today / Vocabulary 形成一个可用闭环。

### 0.1 任务动作标记

| 标记 | 含义 | 执行要求 |
|---|---|---|
| `COPY` | 源文件整体搬入 WD | 尽量不改内部结构，只改 import / 类型 / 样式依赖 |
| `ADAPT` | 保留主体实现，改业务语义 | 必须列出“保留什么 / 删除什么 / 新增什么” |
| `EXTRACT` | 不搬整个模块，只抽纯算法/交互模式 | 形成 WD 自己的纯函数或 domain service |
| `REFERENCE` | 仅作设计参考 | 不进入最终依赖树 |
| `DROP` | 明确不引入 | 防止后续误把 Flow SaaS 体系带入 |

### 0.2 本次源代码快照

当前收到的是 ZIP 快照，没有 `.git` 历史，因此以 ZIP SHA-256 作为本任务书的来源版本标识：

```text
Flowclass ZIP
54a6579dc6a54e9cc4e5dfb91302001ad0ae9dbaa4ca8eaf171346f58418ee18

WD ZIP
c385d4b584f6c781a30d4009ee5d6106acd9e15add2c8776a266dcb589a469c9
```

若你本地拉取的仓库内容已经变化，应重新记录 commit hash，并把本文件中的源路径索引对齐到本地版本。

---

# 1. 已冻结的产品边界

以下是本次改造必须服从的约束，不再沿用原 SDD 中的在线协作 SaaS 假设。

## 1.1 最终产品是什么

最终产品仅为：

> **助教工作台，一个单机、本地化、轻量化的桌面工具。**

主要工作流：

```text
学生
  ↓
学习日 / 可用时长
  ↓
挂载连续作业模板
  ↓
生成当前任务
  ↓
今日工作 / 学生×日期矩阵 / 单学生日历
  ↓
Checklist 完成
  ├─ 完成：Track 前进，生成下一项
  └─ 未完成：顺延到下一可学习日，Track 不前进
```

## 1.2 明确不做

以下内容不应因为 Flowclass 已有实现而被带入：

- `DROP` 登录、JWT、Refresh Token、Session。
- `DROP` 用户角色、RBAC、权限、安全策略。
- `DROP` 学生用户账号、教师用户账号。
- `DROP` 多机构、Site、Institution、Tenant。
- `DROP` 多设备数据同步、云端同步、离线冲突合并。
- `DROP` 支付、Invoice、Quota、报名、Application。
- `DROP` 教师排课、教室、Location Room。
- `DROP` 班级 Class、班课 ClassLesson 的真实业务语义。
- `DROP` 出勤 Attendance 业务语义。
- `DROP` 邮件、WhatsApp、通知中心、Google Calendar 集成。
- `DROP` Flowclass 学生 Portal / Web Portal。
- `DROP` 对课程售卖、课程容量、报名审批的任何逻辑。

## 1.3 允许借用的 Flowclass 抽象

虽然不做“课程”，但允许使用以下语义映射：

| Flowclass 概念 | WD 二开后的概念 | 说明 |
|---|---|---|
| Course | TaskTemplate | 一条连续作业/任务序列，例如“密卷” |
| recurring lesson | TaskInstance | 某一天应完成的一项作业 |
| StudentSchedule | StudentAvailability / StudyPattern | 学生哪些天可以学习 |
| Delay Following Lesson | Carry Forward Task | 未完成任务顺延 |
| Calendar Event | TaskCalendarEvent | 日历展示适配对象 |
| AttendanceSheet row | Student row | 学生纵轴 |
| AttendanceSheet lesson column | Date column | 日期横轴 |
| Attendance status cell | TaskCell | 一个日期单元格中的 0..N 项作业 |

**重要：只借抽象，不保留 Flowclass 的 Course → Class → ClassLesson → StudentLesson 四层数据模型。**

---

# 2. 目标技术形态

## 2.1 最终目标

```text
Tauri Desktop
    │
    └── React / TypeScript / Vite
           │
           ├── WD 原生业务模块
           │    ├── Today
           │    ├── Student Workbench
           │    ├── TaskTemplate
           │    ├── TaskTrack
           │    ├── Checklist / Execution
           │    ├── Vocabulary
           │    └── Search
           │
           ├── Flowclass 移植模块
           │    ├── Calendar Core
           │    ├── Calendar DnD
           │    ├── Attendance Matrix Shell
           │    ├── Availability UI Pattern
           │    └── Recurrence / Delay Algorithm
           │
           └── Local Data Layer
                └── SQLite
```

### 2.2 过渡期形态

改造期间不要立刻删除 `apps/api`：

```text
WD Web / Tauri
    │
    ├── 新本地 TypeScript domain（逐步增加）
    │
    └── Spring API（暂存）
         └── 作为已实现规则的参考和对照测试
```

只有当本地 TypeScript 版本对 Track / Scheduling / Execution / CarryOver 的行为测试全部通过后，才执行最终的 API 退役。

### 2.3 推荐目标目录

建议在 WD 中增加明确的 Flowclass vendor / adapter 边界：

```text
apps/web/src/
├── app/
├── features/
│   ├── today/
│   ├── workbench/
│   ├── schedule/
│   ├── tasks/
│   ├── templates/
│   ├── planning/
│   ├── vocabulary/
│   └── search/
│
├── vendor/
│   └── flowclass/
│       ├── calendar/
│       │   ├── core/
│       │   ├── views/
│       │   └── README.md
│       ├── matrix/
│       ├── availability/
│       └── provenance.md
│
├── domain/
│   ├── student/
│   ├── task/
│   ├── track/
│   └── scheduling/
│
├── data/
│   ├── repositories/
│   ├── sqlite/
│   └── adapters/
│
└── styles/
    └── flowclass-compat.css
```

**原则：** `vendor/flowclass` 中尽量保持源代码形态；真正的 WD 业务语义转换放到 `features/*/adapters` 或 `domain/*`，不要把所有业务改动直接写进 vendor 文件。

---

# 3. 现有代码事实与改造决策

本节区分“源代码事实”和“本任务书决策”，避免把推断当成原项目已有能力。

## 3.1 Flowclass Calendar

### 源代码事实

Flowclass 自定义 Calendar 主要位于：

```text
flowclass-main/apps/admin/src/components/ui/FullCalendar/
```

当前目录约 2470 行 TSX，包含：

```text
CalendarProvider.tsx
CalendarGrid.tsx
EventProvider.tsx
CalendarDnDContext.tsx
DraggableEvent.tsx
CalendarHeader.tsx
DayViewDropzone.tsx
MinutesDropzone.tsx
MonthViewDropzone.tsx
NDayDropzone.tsx
WeekViewEvents.tsx
views/DayView.tsx
views/NDayView.tsx
views/WeekView.tsx
views/MonthView.tsx
views/YearView.tsx
views/ScheduleView.tsx
views/EventItem.tsx
...
```

其核心状态由 `CalendarProvider`、事件由 `EventProvider`、拖拽由 `react-dnd` 处理；`CalendarGrid` 按 `day/nDays/week/month/year/schedule` 分派不同视图。

### 本任务书决策

Calendar **不是无条件整套采用**，必须先做 PoC。原因：WD 作业目前是“按日期”而不是“按精确时刻”，Flow 的 Day/Week 视图明显包含小时/分钟网格。

因此最终有两个允许结果：

- `CALENDAR-FULL`：Flow Day/Week/Month 改造成本低，全部采用。
- `CALENDAR-PARTIAL`：只采用 Calendar Core / Month / DnD / EventProvider，WD 自己实现日期优先的 Day/Week。

**禁止为了“已经搬了代码”而强行给作业虚构 09:00–09:30 时间段。**

## 3.2 Flowclass AttendanceSheet

### 源代码事实

源文件：

```text
apps/admin/src/pages/AttendanceSheet/index.tsx
apps/admin/src/pages/AttendanceSheet/components/StatusAttendance.tsx
```

其布局已经具备：

- 学生纵向列表；
- 课次横向列表；
- 第一列 `sticky left-0`；
- 横向滚动；
- 学生搜索；
- 每个交叉单元格一个状态组件。

### 本任务书决策

AttendanceSheet 只作为 **Matrix Shell** 复用：

- 保留 sticky 第一列、日期表头、横向滚动、矩阵结构。
- 删除 Course/Class selector。
- 删除 attendance 统计。
- 删除 payment 状态。
- 删除 `StatusAttendance`。
- 单元格改为 WD `TaskCard[]`。
- 保留 WD `StudentWorkbenchPage` 已有 Compact/Expanded、TanStack Virtual 和 Task 业务逻辑。

因此不是“用 AttendanceSheet 替换 WD Workbench”，而是：

```text
Flow AttendanceSheet 的矩阵骨架
+
WD StudentWorkbench 的业务和虚拟化
=
新的 StudentTaskMatrix
```

## 3.3 Flowclass Availability

### 源代码事实

相关前端：

```text
apps/admin/src/pages/Availability/AvailabilityPage.tsx
apps/admin/src/pages/Availability/components/WeekdayList.tsx
apps/admin/src/pages/Availability/components/DateOverride.tsx
apps/admin/src/pages/Availability/components/AddDateOverride.tsx
apps/admin/src/pages/Availability/components/AddTimeModal.tsx
```

Flow 类型：

```ts
SingleRecurringSchedule {
  dayOfWeek
  startTime
  endTime
  isEnabled
}

DateOverride {
  date
  isAvailable
  startTime?
  endTime?
}
```

### 本任务书决策

复用“常规周 + 日期覆盖”的 UI/交互模式，但不保留精确起止时刻作为 P0 必选字段。

WD 目标：

```ts
WeeklyStudyDay {
  dayOfWeek: number
  enabled: boolean
  availableMinutes: number
}

StudyDateOverride {
  date: string
  available: boolean
  availableMinutes?: number
}
```

因此 `WeekdayList` 和 `DateOverride` 为 `ADAPT`，不是直接业务复用。

## 3.4 Flowclass delayFollowingLesson

### 源代码事实

核心后端位于：

```text
apps/api/src/domain/service/class-lesson.service.ts
```

主要函数：

```text
delayFollowingLesson(classLessonId)
recursiveCalculateDateLesson(data)
getNextRecurringLesson(payload)
```

`delayFollowingLesson` 的行为是：

1. 找当前 class lesson；
2. 找相关 student schedule；
3. 对每个 schedule 取最后一个 student lesson；
4. 计算一个后续周期时间；
5. clone student lesson 和 class lesson；
6. 删除当前 lesson。

`recursiveCalculateDateLesson` 当前主要通过固定 gap + unit（如 1 week）向后递归，并检查 class lesson 时间冲突。

### 本任务书决策

只 `EXTRACT` 其模式：**找到下一可用位置 → clone → 保持序列数量/连续性**。

不能原样复制以下语义：

- 不按固定一周，而是按学生学习日寻找下一可用日期；
- 不 clone “最后一个作业”，而是 clone **当前未完成作业**；
- 不删除原作业；原实例必须保留为 `CARRIED_OVER` 历史；
- 不生成 ClassLesson；只生成一个新的 TaskInstance；
- 不推进 Track；只有完成动作推进 Track；
- 不做教师/教室冲突；改为学习日/可用时长/设备规则（如保留）检查。

---

# 4. 模块总索引

## 4.1 Flowclass 需要处理的模块

| 模块 ID | Flow 源模块 | 动作 | 目标 | 优先级 |
|---|---|---|---|---|
| FCL-CAL-CORE | `components/ui/FullCalendar/*` | COPY + ADAPT | 单学生 Calendar | P0 |
| FCL-CAL-DND | `CalendarDnDContext/DraggableEvent/*Dropzone` | COPY + ADAPT | 日历拖动改期 | P0 |
| FCL-CAL-VIEW | `views/Day/Week/Month/...` | PoC 后 COPY/ADAPT | 日/周/月 | P0 |
| FCL-MATRIX | `pages/AttendanceSheet/index.tsx` | ADAPT | 学生×日期工作台 | P0 |
| FCL-ATT-STATUS | `StatusAttendance.tsx` | DROP | 不使用出勤状态 | - |
| FCL-AVAIL | `pages/Availability/*` | ADAPT | 学习日与日期覆盖 | P0 |
| FCL-DELAY | `ClassLessonService.delayFollowingLesson` | EXTRACT | Carry Forward | P0 |
| FCL-NEXT | `recursiveCalculateDateLesson` | EXTRACT | 下一可用学习日算法参考 | P0 |
| FCL-RESCHEDULE | Calendar change-time interaction | REFERENCE/ADAPT | 手动改日期 | P1 |
| FCL-COURSE | Course/Class/Enroll | DROP | 不进入最终模型 | - |
| FCL-AUTH | Auth/User/Institution | DROP | 不进入最终模型 | - |
| FCL-PAYMENT | Invoice/Payment | DROP | 不进入最终模型 | - |
| FCL-NOTIFY | Email/Notification | DROP | 不进入最终模型 | - |

## 4.2 WD 必须保留的模块

| WD 模块 | 当前路径 | 决策 |
|---|---|---|
| Today | `apps/web/src/features/today` | 保留，改接本地数据层 |
| Workbench | `apps/web/src/features/workbench` | 保留业务；吸收 Flow Matrix shell |
| TaskCard | `apps/web/src/features/tasks/TaskCard.tsx` | 保留，作为矩阵/Today/Calendar 共用 Task UI |
| Task Template | `apps/web/src/features/templates` | 保留 |
| Track | `apps/web/src/features/planning` | 保留 |
| Vocabulary | `apps/web/src/features/vocabulary` | 保留 |
| Search | `apps/web/src/features/search` | 保留，后续改 SQLite FTS/普通索引 |
| Student | `apps/web/src/features/students` | 保留并精简 |
| Schedule | `apps/web/src/features/schedule` | 改造成 Flow Calendar 容器 |
| Tauri | `apps/desktop` | 保留并承担本地应用宿主 |

## 4.3 WD 后端参考实现索引

在本地数据层改造完成前，以下 Java 文件作为行为规格，不先删除：

```text
apps/api/src/main/java/com/wonderedu/assistant/planning/application/TrackService.java
apps/api/src/main/java/com/wonderedu/assistant/planning/application/SchedulingService.java
apps/api/src/main/java/com/wonderedu/assistant/execution/application/ExecutionService.java
apps/api/src/main/java/com/wonderedu/assistant/execution/application/TodayService.java
apps/api/src/main/java/com/wonderedu/assistant/execution/application/WorkbenchService.java
apps/api/src/main/java/com/wonderedu/assistant/execution/application/DayCloseService.java
apps/api/src/main/java/com/wonderedu/assistant/student/application/AvailabilityService.java
apps/api/src/main/java/com/wonderedu/assistant/student/application/WeekPlanService.java
apps/api/src/main/java/com/wonderedu/assistant/curriculum/application/TemplateService.java
apps/api/src/main/java/com/wonderedu/assistant/vocabulary/application/VocabularyService.java
apps/api/src/main/java/com/wonderedu/assistant/search/application/SearchService.java
```

---

# 5. Flowclass 文件级移植清单

## 5.1 Calendar Core

### A. 第一批建议直接复制

目标目录建议：

```text
apps/web/src/vendor/flowclass/calendar/
```

- [ ] `FCL-CAL-001 COPY` `CalendarGrid.tsx`
- [ ] `FCL-CAL-002 COPY` `CalendarDnDContext.tsx`
- [ ] `FCL-CAL-003 COPY` `DraggableEvent.tsx`
- [ ] `FCL-CAL-004 COPY` `DayViewDropzone.tsx`
- [ ] `FCL-CAL-005 COPY` `MinutesDropzone.tsx`
- [ ] `FCL-CAL-006 COPY` `MonthViewDropzone.tsx`
- [ ] `FCL-CAL-007 COPY` `NDayDropzone.tsx`
- [ ] `FCL-CAL-008 COPY` `WeekViewEvents.tsx`
- [ ] `FCL-CAL-009 COPY` `views/EventItemWithError.tsx`
- [ ] `FCL-CAL-010 COPY` `views/ColumnViewWrapper.tsx`

这些文件大多是通用展示/拖拽骨架，业务耦合相对低。

### B. 复制后必须改造

- [ ] `FCL-CAL-011 ADAPT` `CalendarProvider.tsx`
  - 删除 `Recoil`。
  - 删除 `fullCalendarStateAtom`。
  - 改为 React context + `useState`。
  - 视图偏好可写 `localStorage`，但不是必需。
  - `currentDate` 继续保留。
  - `enableDragAndDrop` 继续保留。

- [ ] `FCL-CAL-012 ADAPT` `EventProvider.tsx`
  - 删除 `@/data/sample-event`。
  - `CalendarEvent` 改成通用事件类型。
  - 事件数据完全由父级 `events` prop 注入，避免 Provider 内部持有 Flow 示例数据。
  - 暴露 `onMoveEvent(eventId, targetDate/DateTime)` 回调。

- [ ] `FCL-CAL-013 ADAPT` `CalendarHeader.tsx`
  - 删除 `react-i18next`。
  - 删除 `useLanguage`。
  - 删除 URL SearchParams 作为业务状态的强绑定。
  - Button/Select 统一改 Ant Design 或 WD 现有组件。
  - 第一版仅保留：上一周期、下一周期、今天、Day/Week/Month 切换。
  - `Year`、`Schedule`、`nDays` 可在 PoC 后决定。

- [ ] `FCL-CAL-014 ADAPT` `views/EventItem.tsx`
  - 删除 Flow feature flag。
  - 删除 `displayLanguageState`。
  - 删除课程/教师/地点信息。
  - 改成接收 `customItemFn` 或直接调用 WD `TaskCard` 的轻量 Calendar 版本。
  - 禁止直接复制 TaskCard 的全部右键菜单进入月视图，避免过密；月视图仅需 Checkbox、标题、顺延/锁定小标。

- [ ] `FCL-CAL-015 ADAPT` `EventPopover.tsx`
  - 若 Calendar Event 被压缩，Popover 显示完整任务详情。
  - 改用 AntD Popover，避免为了一个组件引入 Flow Radix UI 套件。

### C. 视图 PoC 清单

- [ ] `FCL-CAL-016 POC` `views/MonthView.tsx`
  - 用 1 个学生、30 天、每天 0~5 个 TaskInstance 测试。
  - 验证多任务显示、点击、拖拽、跨月。

- [ ] `FCL-CAL-017 POC` `views/WeekView.tsx`
  - 不给任务虚构真实上课时间。
  - 先尝试 all-day / date block 适配。
  - 若仍强依赖小时网格，标记 `PARTIAL`，不强行复用。

- [ ] `FCL-CAL-018 POC` `views/DayView.tsx`
  - 目标不是 24 小时时间轴，而是“某学生某日全部作业”。
  - 如果 Flow DayView 改造超过“删除时间网格 + 改列表”的程度，则直接由 WD 新写简单列表。

- [ ] `FCL-CAL-019 DECISION` 输出 `CalendarAdoptionDecision.md`
  - 记录 Full / Partial。
  - 记录最终复制文件清单。
  - 记录弃用文件清单。

### D. 默认 DROP 的 Calendar 文件

除非 PoC 证明有直接价值，否则：

- [ ] `FCL-CAL-020 DROP` `views/QuotaAttendance.tsx`
- [ ] `FCL-CAL-021 DROP` `AttendanceIndicatorBar.tsx`
- [ ] `FCL-CAL-022 DROP` `CalendarSidebarContext.tsx`
- [ ] `FCL-CAL-023 DROP` Flow `CalendarSidebar.tsx`
- [ ] `FCL-CAL-024 DROP` `CreateClassFromCalendarModal`
- [ ] `FCL-CAL-025 DROP` `LessonDetail*`
- [ ] `FCL-CAL-026 DROP` `QrCodeView`
- [ ] `FCL-CAL-027 DROP` Google Calendar integration

## 5.2 Calendar 类型改造

Flow 当前 `CalendarEvent` 带大量课程字段。目标新类型建议：

```ts
export type TaskCalendarEvent = {
  id: string;
  taskId: string;
  studentId: string;
  title: string;
  shortTitle?: string | null;
  scheduledDate: string;
  start: Date;
  end: Date;
  status: "PENDING" | "COMPLETED" | "CARRIED_OVER" | "BLOCKED" | "CANCELLED";
  trackId?: string | null;
  itemOrdinal?: number | null;
  locked: boolean;
  carriedOver: boolean;
  durationMinutes?: number | null;
  version?: number;
};
```

- [ ] `FCL-CAL-028` 新建 `taskCalendarAdapter.ts`。
- [ ] `FCL-CAL-029` 实现 `TaskLike -> TaskCalendarEvent`。
- [ ] `FCL-CAL-030` 日历所有事件不得引用 Course/Class/User/Institution 类型。
- [ ] `FCL-CAL-031` 拖拽回调只返回 `taskId + targetDate`，由 domain 决定是否合法。

---

# 6. Flow 样式兼容层任务

Flow Calendar 与 AttendanceSheet 使用大量 Tailwind class；WD 当前主要使用 Ant Design + 自定义 CSS。为了最大化直接复制，不建议把 2000 多行 Tailwind class 手工翻成 CSS。

## 6.1 推荐方案：Tailwind 兼容层，但禁止全局 Preflight

- [ ] `STYLE-001` 在 `apps/web` 增加 Tailwind/PostCSS 依赖，仅用于 vendor Flowclass 区域。
- [ ] `STYLE-002` 新建 `tailwind.config.ts`。
- [ ] `STYLE-003` 设置 `corePlugins.preflight = false`，防止 Tailwind reset 影响 AntD。
- [ ] `STYLE-004` content 至少扫描：

```text
src/vendor/flowclass/**/*.{ts,tsx}
src/features/schedule/**/*.{ts,tsx}
src/features/workbench/**/*.{ts,tsx}
```

- [ ] `STYLE-005` 从 Flow `tailwind.config.ts` 仅复制 Calendar/Matrix 实际使用的颜色 token，不复制完整主题。
- [ ] `STYLE-006` 新建 `flowclass-compat.css`，仅：

```css
@tailwind components;
@tailwind utilities;
```

不要引入 `@tailwind base`。

- [ ] `STYLE-007` 如 Availability 复用 `.box-row-full/.box-col-full`，在 compat CSS 中手工定义这两个类，不复制 Flow `globals.css` 全局规则。
- [ ] `STYLE-008` **禁止复制** Flow `globals.css` 中的 `div { @apply relative; }`、body reset 等全局规则。

## 6.2 依赖最小化

Calendar 移植优先只增加：

```text
react-dnd
react-dnd-html5-backend
dayjs
```

若某个 Flow 文件只为了一个小函数引用 lodash，直接改为原生实现，不新增整个依赖。

明确不因为 Calendar 引入：

```text
recoil
react-query v3
Flow 全套 i18n
Flow 全套 Radix UI
Flow Course selector
Flow hooks/useSchoolData
```

- [ ] `STYLE-009` 输出 `vendor/flowclass/provenance.md`，记录已引入第三方包。
- [ ] `STYLE-010` 完成后运行 WD Web lint/typecheck/test，确认兼容层没有污染现有页面。

---

# 7. AttendanceSheet → StudentTaskMatrix 详细任务

## 7.1 源码索引

```text
Flow:
apps/admin/src/pages/AttendanceSheet/index.tsx
apps/admin/src/pages/AttendanceSheet/components/StatusAttendance.tsx

WD:
apps/web/src/features/workbench/StudentWorkbenchPage.tsx
apps/web/src/features/tasks/TaskCard.tsx
apps/web/src/features/workbench/workbenchApi.ts
```

## 7.2 改造目标

最终矩阵：

```text
┌──────────────┬─────────────┬─────────────┬─────────────┐
│ 学生         │ 8/19 周三   │ 8/20 周四   │ 8/21 周五   │
├──────────────┼─────────────┼─────────────┼─────────────┤
│ Monica       │ □ 密卷08    │             │ □ 807-12    │
│ [电子]       │ □ 单词20    │             │             │
│ [生词][排期] │             │             │             │
├──────────────┼─────────────┼─────────────┼─────────────┤
│ Tim          │ ☑ 长难句07  │ □ 阅读10    │             │
└──────────────┴─────────────┴─────────────┴─────────────┘
```

## 7.3 任务

- [ ] `MAT-001 COPY` 从 AttendanceSheet 复制表头/表体/sticky 第一列结构到新组件 `StudentTaskMatrixShell.tsx`。
- [ ] `MAT-002 DROP` 删除 `CourseAndClassSelector`。
- [ ] `MAT-003 DROP` 删除 `ChartDatePicker` 的月跨度业务，改成 WD weekStart + 7/14 天范围。
- [ ] `MAT-004 DROP` 删除 `AttendanceStatus`。
- [ ] `MAT-005 DROP` 删除 `StatusAttendance.tsx` 依赖。
- [ ] `MAT-006 DROP` 删除 attendance 平均值和 total attendance 卡片。
- [ ] `MAT-007 ADAPT` 横轴从 `classLessons[]` 改为 `dates[]`。
- [ ] `MAT-008 ADAPT` 学生行数据直接使用 WD `WorkbenchStudentRow`。
- [ ] `MAT-009 ADAPT` cell 从 `one studentLesson` 改为 `tasksByDate[date]`。
- [ ] `MAT-010` 每个 cell 渲染 WD `TaskCard`。
- [ ] `MAT-011` Compact：显示前 2 项，其余 `+N`。
- [ ] `MAT-012` Expanded：显示前 5 项或完整高度策略。
- [ ] `MAT-013` 保留 WD `@tanstack/react-virtual` 行虚拟化，不回退为 Flow 普通 map 全量渲染。
- [ ] `MAT-014` 第一列固定，横向日期滚动。
- [ ] `MAT-015` 第一列学生名链接到资料页。
- [ ] `MAT-016` 姓名后显示设备标签。
- [ ] `MAT-017` 添加 `[生词本]` 按钮。
- [ ] `MAT-018` 添加 `[排期]` 按钮。
- [ ] `MAT-019` 在空 cell 支持 `InlineTaskComposer` 或 `+` 快速加临时任务。
- [ ] `MAT-020` 学生搜索保留 Flow “单输入框过滤行”的简单模式。
- [ ] `MAT-021` 周切换继续使用 WD 现有逻辑。
- [ ] `MAT-022` 当任务完成/重开/删除/改期时仅更新受影响 cell，不整页闪烁。
- [ ] `MAT-023` 60 学生 × 14 天 × 平均 3 任务造数测试。
- [ ] `MAT-024` 横向滚动时学生列不漂移。
- [ ] `MAT-025` Compact/Expanded 切换不丢当前周、过滤条件、滚动位置（可接受轻微垂直位置变化，但不能跳回顶部）。

### 7.4 验收门禁

`MATRIX-GATE`：

- 60×14 数据下操作无明显卡顿；
- 第一列固定；
- Task checkbox 可用；
- Task 右键菜单可用；
- 空格添加任务可用；
- 生词/排期入口独立；
- 不存在任何 `Course/Class/Attendance/Payment` 残留文案。

---

# 8. Availability → 学习日编辑器详细任务

## 8.1 源码索引

```text
Flow:
apps/admin/src/pages/Availability/AvailabilityPage.tsx
apps/admin/src/pages/Availability/components/WeekdayList.tsx
apps/admin/src/pages/Availability/components/DateOverride.tsx
apps/admin/src/pages/Availability/components/AddDateOverride.tsx
apps/admin/src/pages/Availability/components/AddTimeModal.tsx
apps/admin/src/types/availability.type.ts

WD:
apps/web/src/features/students/StudentProfilePage.tsx
apps/web/src/features/schedule/StudentSchedulePage.tsx
Java reference:
student/application/AvailabilityService.java
student/application/WeekPlanService.java
```

## 8.2 目标交互

学生默认周：

```text
周一   [开]   120 分钟
周二   [关]
周三   [开]   180 分钟
周四   [关]
周五   [开]    90 分钟
周六   [开]   180 分钟
周日   [关]
```

日期覆盖：

```text
2026-08-22  不可学习
2026-08-29  可学习 240 分钟
```

## 8.3 任务

- [ ] `AVL-001 ADAPT` 复制 `WeekdayList` 视觉结构。
- [ ] `AVL-002` 删除 start/end time picker。
- [ ] `AVL-003` 每日改成 `Switch + availableMinutes InputNumber`。
- [ ] `AVL-004` 默认关闭日 `availableMinutes=0`。
- [ ] `AVL-005` 打开无时长时使用上次值或学生默认值；没有历史时给空值并提示填写，避免偷偷设置 60 分钟。
- [ ] `AVL-006 ADAPT` 复制 `DateOverride` 分组/删除/新增模式。
- [ ] `AVL-007` override 只需要 `date / available / availableMinutes`。
- [ ] `AVL-008 DROP` `ApplyToClass`。
- [ ] `AVL-009 DROP` `AvailabilityList`、多 availability profile。
- [ ] `AVL-010` 每个学生只有一份当前默认周规则即可。
- [ ] `AVL-011` 添加“复制上周”仅作用于某周 override/计划层；默认周本身不被改写。
- [ ] `AVL-012` StudentProfile 中嵌入精简学习条件摘要。
- [ ] `AVL-013` StudentSchedulePage 作为完整编辑页。
- [ ] `AVL-014` 保存后立即影响 `findNextAvailableStudyDate()`。
- [ ] `AVL-015` 写测试：周三任务未完成，周四关闭，周五开启 → next=周五。
- [ ] `AVL-016` 写测试：周五有 override=false → 跳到下一开启日。
- [ ] `AVL-017` 写测试：默认日关闭但 override=true → 允许该日。

---

# 9. Flow 延后算法 → Carry Forward Engine 详细任务

## 9.1 源码索引

Flow：

```text
apps/api/src/domain/service/class-lesson.service.ts
  delayFollowingLesson(...)
  recursiveCalculateDateLesson(...)
  getNextRecurringLesson(...)

apps/admin/src/pages/FullCalendar/DelayFollowingLessons.tsx
apps/admin/src/api/lessonDateTime.ts
  delayFollowingLessons(...)
  fetchNextAvailableRecurringLesson(...)
```

WD 参考：

```text
apps/api/src/main/java/com/wonderedu/assistant/execution/application/ExecutionService.java
apps/api/src/main/java/com/wonderedu/assistant/execution/application/DayCloseService.java
apps/api/src/main/java/com/wonderedu/assistant/student/application/AvailabilityService.java
apps/api/src/main/java/com/wonderedu/assistant/planning/application/SchedulingService.java
```

## 9.2 Flow 逻辑中可以直接借用的结构

保留结构：

```text
读取当前实例
→ 找所属 schedule / 轨道环境
→ 找下一个合法位置
→ clone 一个新实例
→ 持久化
→ 更新旧实例状态
```

不保留 Flow 的“删除当前课次”。

## 9.3 目标函数拆分

建议最终形成 4 个纯/半纯服务：

```ts
resolveEffectiveAvailability(studentId, date)
findNextAvailableStudyDate(studentId, afterDate, taskRequirement)
carryForwardTask(taskId, reason)
previewCarryForward(taskId)
```

### `findNextAvailableStudyDate`

输入：

```ts
{
  studentId,
  afterDate,
  requiresDevice?,
  excludedDates?,
  horizonDays?: 90
}
```

输出：

```ts
{
  date: "2026-08-21",
  source: "WEEKLY_PATTERN" | "DATE_OVERRIDE",
  availableMinutes: 120
} | null
```

### `carryForwardTask`

输入：当前 TaskInstance。

必须原子完成：

```text
旧 task.status = CARRIED_OVER
旧 task.carriedToTaskId = new.id
新 task = clone 当前 task 的业务快照
新 task.status = PENDING
新 task.scheduledDate = nextAvailableDate
新 task.carriedFromTaskId = old.id
Track.currentOrdinal 不变
```

## 9.4 具体任务

- [ ] `DLY-001 REFERENCE` 把 Flow `delayFollowingLesson` 原实现摘录到 `vendor/flowclass/provenance.md`，注明源函数。
- [ ] `DLY-002 EXTRACT` 将 `recursiveCalculateDateLesson` 的“反复向后找下一位置”模式改写为纯 TypeScript 日期扫描。
- [ ] `DLY-003` 不使用 `gap=1 week` 作为默认规则。
- [ ] `DLY-004` 扫描的是学生有效学习日，不是 class time conflict。
- [ ] `DLY-005` 优先检查目标日期的具体 override。
- [ ] `DLY-006` 无 override 时回落默认周规则。
- [ ] `DLY-007` 可选检查 availableMinutes > 0。
- [ ] `DLY-008` 若保留设备规则，设备要求冲突时继续向后找。
- [ ] `DLY-009` 90 天内无可用日期时返回 null，不无限递归。
- [ ] `DLY-010` 改用循环而非无限递归，避免错误规则导致栈问题。
- [ ] `DLY-011` 新任务 clone 当前任务，不 clone Track 最后一项。
- [ ] `DLY-012` clone 时保留 `templateVersionId/itemId/itemOrdinal/title snapshot/duration`。
- [ ] `DLY-013` clone 时生成新 id、更新时间、lineage。
- [ ] `DLY-014` 旧任务不删除。
- [ ] `DLY-015` Track pointer 不变。
- [ ] `DLY-016` 如果 task.locked=true，自动顺延 no-op，并返回明确结果。
- [ ] `DLY-017` 如果 task.status != PENDING，不允许重复顺延。
- [ ] `DLY-018` 增加幂等保护：同一旧 task 不能存在两个有效 carry target。
- [ ] `DLY-019` preview 不写库，只返回预计目标日期。
- [ ] `DLY-020` DayClose 批量调用同一个 `carryForwardTask`，不复制另一套算法。
- [ ] `DLY-021` UI 日结完成后显示“昨日顺延 X 项”。
- [ ] `DLY-022` TaskCard 顺延标签可跳到来源/目标历史（如果 P0 暂不做详情，至少 tooltip 显示来源日期）。

## 9.5 Carry Forward 必测场景

- [ ] `DLY-T01` 周三未完成，周四不可学，周五可学 → 周五。
- [ ] `DLY-T02` 周五未完成，周末不可学，下周一可学 → 下周一。
- [ ] `DLY-T03` 周五默认可学但 override=false → 跳过。
- [ ] `DLY-T04` 默认周日不可学但 override=true → 可落周日。
- [ ] `DLY-T05` locked task → 不移动。
- [ ] `DLY-T06` 已完成 task → 不移动。
- [ ] `DLY-T07` 已顺延 task 再次执行同一命令 → 不创建第二目标。
- [ ] `DLY-T08` 顺延后 Track currentOrdinal 不变。
- [ ] `DLY-T09` 完成顺延后的新 Task → Track 才前进。
- [ ] `DLY-T10` 原历史实例仍可查询。

---

# 10. Course/Lesson → Task 语义改造任务

本项目允许“把作业视作课程”来复用 Flow 的思想，但代码层必须收敛为自己的轻模型。

## 10.1 最终模型

```text
TaskTemplate
  └── TaskTemplateItem [1..N]

StudentTaskTrack
  ├── templateVersionId
  ├── currentOrdinal
  └── status

TaskInstance
  ├── studentId
  ├── trackId?
  ├── templateVersionId?
  ├── itemId?
  ├── itemOrdinal?
  ├── scheduledDate
  ├── status
  ├── carriedFromTaskId?
  └── carriedToTaskId?
```

## 10.2 明确不建立

- [ ] `MODEL-DROP-001` 不建立 `Class`。
- [ ] `MODEL-DROP-002` 不建立 `ClassLesson`。
- [ ] `MODEL-DROP-003` 不建立 `StudentLesson` 双层实例。
- [ ] `MODEL-DROP-004` 不建立 `EnrollCourse`。
- [ ] `MODEL-DROP-005` 不建立 `StudentSchedule` 与课程的外键关系。

## 10.3 对照规则

```text
Flow Course               → WD TaskTemplate
Flow lesson sequence      → WD TaskTemplateItem ordinal
Flow student's course     → WD StudentTaskTrack
Flow lesson occurrence    → WD TaskInstance
Flow delay lesson         → WD CarryForward
Flow attend lesson        → WD Complete Task
```

**但“Attend”只用于理解，不复用 AttendanceStatus。WD 仍然使用 COMPLETED/PENDING。**

---

# 11. Calendar 与 WD 任务引擎集成

## 11.1 页面职责

`StudentSchedulePage` 最终只负责：

1. 选择/读取当前学生；
2. 切 Day/Week/Month；
3. 查询日期范围内 TaskInstance；
4. 转成 `TaskCalendarEvent[]`；
5. 处理点击/完成/拖拽/快速添加；
6. 显示学习日规则入口。

不在 Calendar 页面实现 Track pointer 算法。

## 11.2 任务

- [ ] `INT-CAL-001` `StudentSchedulePage` 删除当前自建日历重复 UI（在 Flow PoC 通过后）。
- [ ] `INT-CAL-002` 加 `TaskCalendarAdapter`。
- [ ] `INT-CAL-003` Calendar event click 打开 Task 详情/菜单。
- [ ] `INT-CAL-004` Calendar checkbox 调用统一 `completeTask()`。
- [ ] `INT-CAL-005` Calendar drag 调用统一 `rescheduleTask()`。
- [ ] `INT-CAL-006` 拖到不可学习日时，由 domain 返回 warning/拒绝，不由 Calendar 自己判断业务真值。
- [ ] `INT-CAL-007` locked task 禁止拖动。
- [ ] `INT-CAL-008` carried-over 来源实例以弱化样式显示历史，不允许当成当前待办重复勾选。
- [ ] `INT-CAL-009` 同日多任务有稳定排序：priority/star/sortOrder/createdAt 规则沿用 WD。
- [ ] `INT-CAL-010` 月视图超过可显示数量时 `+N`。
- [ ] `INT-CAL-011` 任务拖动只改 scheduledDate，不推进 Track。
- [ ] `INT-CAL-012` Track next item 只能由 complete command 创建/激活。

---

# 12. Reschedule 与 Drag 的统一命令

Flow 有独立 `updateTimeLesson` / ChangeEntireLesson 模式；WD 已有 `RescheduleModal` 和 schedule API。最终只保留一个业务命令：

```ts
rescheduleTask(taskId, targetDate, options?)
```

调用来源可以是：

```text
Calendar drag
TaskCard 右键“改期”
矩阵跨日期拖动
RescheduleModal
```

- [ ] `RSC-001` 所有入口统一走同一 service。
- [ ] `RSC-002` 删除“各页面自己改日期”的重复逻辑。
- [ ] `RSC-003` locked task 返回不可移动。
- [ ] `RSC-004` 普通手动改期不改变 task status。
- [ ] `RSC-005` 普通手动改期不改变 Track ordinal。
- [ ] `RSC-006` 目标日不可学习时弹 warning；是否允许强制放置按现有 WD 决策保留。
- [ ] `RSC-007` 手动改期与自动 Carry Forward 在历史字段上可区分。
- [ ] `RSC-008` Calendar 与 Matrix 改期后两边查询结果一致。

---

# 13. 本地化数据层改造任务（与 Flow 移植并行，但晚于 UI PoC）

这一部分不是 Flowclass 源码复用本身，但它是“最终仅本地轻量助教工作台”的必要收尾。

## 13.1 原则

不要一开始就把 Java 全部删掉。按：

```text
Java 规则已实现
→ 为相同行为建立 TS 测试
→ TS domain 实现
→ 本地 repository
→ UI API facade 改接本地实现
→ 回归通过
→ 才删除 Java 对应模块
```

## 13.2 前端 API 兼容策略

为了避免大改页面，建议保留现有 feature API 函数签名：

```text
getToday()
completeTask()
reopenTask()
getWorkbench()
getSchedule()
rescheduleTask()
listStudentTracks()
mountTrack()
listTemplates()
...
```

只是其内部从：

```text
getJson/postJson('/api/...')
```

逐步切换为：

```text
localServices.xxx(...)
```

这样 Today/Workbench/Template/Vocabulary UI 基本不用重写。

## 13.3 SQLite 目标表

建议至少：

```text
student
student_weekly_pattern
student_weekly_pattern_day
student_date_override

task_template
task_template_version
task_template_item
student_task_track
task_instance

vocabulary_entry
app_setting
```

可选：

```text
task_history
import_job
```

删除/不迁移：

```text
organization
user_account
user_role_assignment
identity_session
refresh token
tenant scope tables
```

## 13.4 任务

- [ ] `LOC-001` 新建 `DataAdapter` / repository interfaces。
- [ ] `LOC-002` 选择并锁定 Tauri SQLite 接入方式；优先简单方案，版本在实际实施时锁定。
- [ ] `LOC-003` 建 SQLite migrations。
- [ ] `LOC-004` 将 UUID 保留或统一改 text UUID；不要为了 SQLite 改所有前端 ID。
- [ ] `LOC-005` 移除 organization_id 强制要求。
- [ ] `LOC-006` 移除 created_by/updated_by 用户外键要求；可保留时间字段。
- [ ] `LOC-007` 迁 StudentRepository。
- [ ] `LOC-008` 迁 TemplateRepository。
- [ ] `LOC-009` 迁 TrackRepository。
- [ ] `LOC-010` 迁 TaskInstanceRepository。
- [ ] `LOC-011` 迁 AvailabilityRepository。
- [ ] `LOC-012` 迁 VocabularyRepository。
- [ ] `LOC-013` 迁 Today query。
- [ ] `LOC-014` 迁 Workbench range query。
- [ ] `LOC-015` 迁 Schedule range query。
- [ ] `LOC-016` 迁 Global Search；P0 可普通 LIKE/index，数据量需要时再 FTS5。
- [ ] `LOC-017` `completeTask()` TS parity。
- [ ] `LOC-018` `reopenTask()` TS parity。
- [ ] `LOC-019` `mountTrack()` TS parity。
- [ ] `LOC-020` `scheduleTrackItems()` TS parity。
- [ ] `LOC-021` `carryForwardTask()` TS parity。
- [ ] `LOC-022` DayClose TS parity。
- [ ] `LOC-023` Excel import 迁本地实现；若当前 Java POI 实现稳定，可最后迁，不阻塞 Calendar/Matrix。
- [ ] `LOC-024` 浏览器 dev 使用 in-memory/mock adapter；正式桌面使用 SQLite adapter。

---

# 14. Auth / Tenant / 在线架构清理任务

这些任务必须等本地 data adapter 可用后执行。

- [ ] `CLEAN-001` AppShell 移除 `useAuth()`。
- [ ] `CLEAN-002` 移除 `ADMIN_ROLES` 和管理员导航判断。
- [ ] `CLEAN-003` 日结管理如果仍需要，直接作为普通工具页，不做角色判断。
- [ ] `CLEAN-004` 删除 `features/auth`。
- [ ] `CLEAN-005` 删除 ContextGate/AuthProvider 依赖链。
- [ ] `CLEAN-006` `useBusinessDate()` 改为本地日期/应用设置，不依赖 `/context`。
- [ ] `CLEAN-007` 删除 Web API proxy 配置。
- [ ] `CLEAN-008` Tauri CSP 不再允许 localhost:8080（本地 API 退役后）。
- [ ] `CLEAN-009` 根 `pnpm dev` 改成 Web/Tauri 单体开发，不启动 PostgreSQL/Spring。
- [ ] `CLEAN-010` 根 build 不再包含 `build:api`。
- [ ] `CLEAN-011` 根 check 不再包含 Java API tests；在删除前将核心业务 tests 迁到 Vitest。
- [ ] `CLEAN-012` 最后归档/删除 `apps/api`。
- [ ] `CLEAN-013` 删除 PostgreSQL Docker infra。
- [ ] `CLEAN-014` README 改成本地单机安装/开发说明。

---

# 15. Flowclass 代码来源追踪规范

即使版权授权无问题，也强烈建议保留工程来源追踪，因为后续你还可能从 Flowclass 更新实现。

每个直接移植文件顶部加类似：

```ts
/**
 * Source: Flowclass
 * Original path:
 * apps/admin/src/components/ui/FullCalendar/CalendarGrid.tsx
 * Snapshot: flowclass-main.zip sha256 54a6579d...
 * Adaptations:
 * - removed Flow auth/course dependencies
 * - replaced Flow CalendarEvent with TaskCalendarEvent
 * - adapted styling for WD compatibility layer
 */
```

- [ ] `SRC-001` 新建 `src/vendor/flowclass/provenance.md`。
- [ ] `SRC-002` 逐文件记录原路径。
- [ ] `SRC-003` 记录是否 COPY/ADAPT/EXTRACT。
- [ ] `SRC-004` 记录删除的业务依赖。
- [ ] `SRC-005` 若后续再同步 Flowclass，只对 vendor 目录做 diff，不直接覆盖 features/domain。

---

# 16. 分阶段执行计划

## Phase F0 — 冻结与基线

目标：在搬 Flow 之前锁住 WD 当前行为。

- [ ] `F0-001` 本地建立改造分支，例如 `refactor/flowclass-fusion`。
- [ ] `F0-002` 保存当前 WD 全量测试结果。
- [ ] `F0-003` 给 Track complete/reopen/carry/reschedule 建最小回归测试列表。
- [ ] `F0-004` 保存当前 Today、Workbench、Schedule 页面截图。
- [ ] `F0-005` 保存 Flow Calendar、AttendanceSheet、Availability 对应截图/录屏作为视觉参考。
- [ ] `F0-006` 建 `vendor/flowclass/provenance.md`。

**退出门禁：** 不改业务，只完成可回退基线。

## Phase F1 — Flow 样式与依赖兼容层

- [ ] 完成 `STYLE-001~010`。
- [ ] 搬一个最简单 Flow Calendar 小组件验证 class 生效。
- [ ] 确保 AntD 首页视觉不变。

**退出门禁：** WD 原页面通过；Flow Tailwind utilities 可局部工作。

## Phase F2 — Calendar PoC

- [ ] 完成 `FCL-CAL-001~019`。
- [ ] 使用 mock TaskInstance，不接数据库。
- [ ] 明确 Full / Partial 决策。

**退出门禁：** 得到可以保留的 Calendar 文件清单，不存在“为了复用而复用”。

## Phase F3 — Matrix 融合

- [ ] 完成 `MAT-001~025`。
- [ ] 第一阶段继续使用 WD 当前 workbench API。

**退出门禁：** 新矩阵在现有 WD 后端数据上可完整操作。

## Phase F4 — Availability UI 融合

- [ ] 完成 `AVL-001~017`。
- [ ] 第一阶段继续使用 WD 当前学习日 API/Java 规则。

**退出门禁：** 默认周 + 日期覆盖可以编辑，且能改变后端 next available 结果。

## Phase F5 — Delay Algorithm 提纯

- [ ] 完成 `DLY-001~022`。
- [ ] 先写纯 TS 算法测试，不马上替换后端。
- [ ] 与 Java `AvailabilityService/ExecutionService` 行为对照。

**退出门禁：** TS carry-forward 核心规则通过 DLY-T01~T10。

## Phase F6 — Calendar/Matrix 统一命令

- [ ] 完成 `INT-CAL-*`、`RSC-*`。
- [ ] 完成/重开/改期/顺延只存在一套 domain action。

**退出门禁：** Today、Matrix、Calendar 三个视图对同一任务的状态完全一致。

## Phase F7 — 本地 SQLite 数据层

- [x] 完成 `LOC-001~024`。证据：`apps/web/src/data/local/`、Tauri migration、`pnpm check`、`pnpm verify:desktop`。
- [x] 将页面 feature API facade 逐一切到 local services；正式运行路径使用 SQLite，不依赖 HTTP。

**退出门禁：** 断开 Spring/Postgres 后，Tauri 中可完成核心业务闭环。

## Phase F8 — 清理在线架构

- [x] 完成 `CLEAN-001~014`。证据：`scripts/check-local-runtime.mjs` 报告无 HTTP transport，Auth/Spring/PostgreSQL 运行依赖已退出。

**退出门禁：** 最终启动不依赖 Java、PostgreSQL、localhost API、登录。

## Phase F9 — 完整验收

见第 19 节。当前自动化验收为 AUTO 42 / MANUAL 4 / GAP 0；MANUAL 项仍需用户在桌面窗口确认启动、拖拽和滚动手感。

---

# 17. 推荐实施顺序（按文件）

如果你准备直接打开 IDE 开始改，建议按以下顺序，不要跳着搬：

```text
1. apps/web Tailwind compatibility
2. vendor/flowclass/calendar/CalendarDnDContext.tsx
3. vendor/flowclass/calendar/EventProvider.tsx
4. vendor/flowclass/calendar/CalendarProvider.tsx
5. vendor/flowclass/calendar/DraggableEvent.tsx
6. vendor/flowclass/calendar/MonthView + Dropzone
7. Calendar PoC
8. WeekView PoC
9. DayView PoC
10. features/schedule/taskCalendarAdapter.ts
11. StudentSchedulePage 接 Calendar
12. vendor/flowclass/matrix/StudentTaskMatrixShell.tsx
13. StudentWorkbenchPage 接 Matrix shell
14. vendor/flowclass/availability/WeekdayList.tsx
15. vendor/flowclass/availability/DateOverride.tsx
16. StudentSchedulePage / StudentProfile 接 Availability
17. domain/scheduling/findNextAvailableStudyDate.ts
18. domain/scheduling/carryForwardTask.ts
19. domain/task/rescheduleTask.ts
20. 统一 Today/Matrix/Calendar actions
21. SQLite repositories
22. feature APIs 切 local
23. 删除 auth/api/postgres
```

---

# 18. Flowclass 模块“搬 / 改 / 不搬”最终索引

## 18.1 Calendar

| 源文件/模块 | 决策 | 改造摘要 |
|---|---|---|
| `CalendarGrid.tsx` | COPY | import 改路径 |
| `CalendarDnDContext.tsx` | COPY | 基本可原样 |
| `DraggableEvent.tsx` | COPY+ADAPT | Event 类型改 TaskCalendarEvent |
| `EventProvider.tsx` | ADAPT | 外部 events 注入，去 sample data |
| `CalendarProvider.tsx` | ADAPT | 去 Recoil |
| `CalendarHeader.tsx` | ADAPT | 去 i18n/searchParams，AntD |
| `MonthView.tsx` | POC→COPY/ADAPT | 优先复用 |
| `WeekView.tsx` | POC | 时间网格可能不匹配 |
| `DayView.tsx` | POC | 时间网格可能不匹配 |
| `YearView.tsx` | DROP/P1 | 当前需求不必要 |
| `ScheduleView.tsx` | P1 | 可作为 agenda 候选 |
| `EventItem.tsx` | ADAPT | 映射 TaskCard 轻视图 |
| `QuotaAttendance.tsx` | DROP | Attendance 业务 |
| `AttendanceIndicatorBar.tsx` | DROP | Attendance 业务 |
| `CalendarSidebarContext.tsx` | DROP | WD 有自己的选择/搜索 |

## 18.2 AttendanceSheet

| 源 | 决策 |
|---|---|
| `AttendanceSheet/index.tsx` | ADAPT 成 Matrix shell |
| `StatusAttendance.tsx` | DROP |
| Course/Class selector | DROP |
| Student search | COPY 思路 |
| sticky student column | COPY |
| horizontal scroll | COPY |
| attendance summary | DROP |

## 18.3 Availability

| 源 | 决策 |
|---|---|
| `WeekdayList.tsx` | ADAPT |
| `DateOverride.tsx` | ADAPT |
| `AddDateOverride.tsx` | ADAPT |
| `AddTimeModal.tsx` | DROP/重写分钟输入 |
| `ApplyToClass.tsx` | DROP |
| `AvailabilityList.tsx` | DROP |

## 18.4 Delay

| Flow 实现 | 决策 |
|---|---|
| `delayFollowingLesson` 控制流 | EXTRACT |
| clone pattern | EXTRACT |
| delete current lesson | DROP |
| clone last lesson | DROP |
| fixed weekly gap | DROP |
| conflict recursion pattern | EXTRACT 为 bounded scan |
| `getNextRecurringLesson` preview 概念 | COPY 概念，改为 `previewCarryForward` |

---

# 19. 最终验收清单

## 19.1 基础应用

- [ ] `ACC-001` 启动桌面程序不要求登录。
- [ ] `ACC-002` 不要求 PostgreSQL。
- [ ] `ACC-003` 不要求 Java/Spring 后端。
- [ ] `ACC-004` 所有核心数据保存到本地 SQLite。
- [ ] `ACC-005` 重启程序数据仍在。

## 19.2 学生

- [ ] `ACC-010` 学生列表可搜索。
- [ ] `ACC-011` 姓名进入资料。
- [ ] `ACC-012` 生词本独立入口。
- [ ] `ACC-013` 排期独立入口。
- [ ] `ACC-014` 可设置默认学习日和分钟数。
- [ ] `ACC-015` 可设置具体日期 override。

## 19.3 模板 / Track

- [ ] `ACC-020` 可创建有序 TaskTemplate。
- [ ] `ACC-021` 可挂载到学生。
- [ ] `ACC-022` Track 当前 ordinal 可见。
- [ ] `ACC-023` 完成当前任务推进且只推进一次。
- [ ] `ACC-024` 未完成/改期/顺延均不推进。

## 19.4 Today

- [ ] `ACC-030` 默认今日工作。
- [ ] `ACC-031` 按学生分组。
- [ ] `ACC-032` Checkbox 完成即时刷新。
- [ ] `ACC-033` 临时任务可直接录入。

## 19.5 Workbench Matrix

- [ ] `ACC-040` 学生纵轴、日期横轴。
- [ ] `ACC-041` 第一列 sticky。
- [ ] `ACC-042` 横向滚动。
- [ ] `ACC-043` Compact/Expanded。
- [ ] `ACC-044` 一个 cell 可有多个 TaskCard。
- [ ] `ACC-045` 60×14 数据流畅。

## 19.6 Calendar

- [ ] `ACC-050` 单学生 Day 可用。
- [ ] `ACC-051` 单学生 Week 可用。
- [ ] `ACC-052` 单学生 Month 可用。
- [ ] `ACC-053` 拖动任务可改日期。
- [ ] `ACC-054` 拖动不推进 Track。
- [ ] `ACC-055` locked task 不可拖。
- [ ] `ACC-056` Calendar 不展示 Course/Class/Teacher/Location 残留。

## 19.7 Carry Forward

- [ ] `ACC-060` 未完成任务可顺延到下一学习日。
- [ ] `ACC-061` 跳过不可学习日。
- [ ] `ACC-062` 尊重 date override。
- [ ] `ACC-063` 原任务历史保留。
- [ ] `ACC-064` 新旧 task 有双向 lineage。
- [ ] `ACC-065` Track pointer 不动。
- [ ] `ACC-066` 重复执行不创建多个目标实例。
- [ ] `ACC-067` DayClose 批量结果可见。

## 19.8 三视图一致性

- [ ] `ACC-070` Today 勾选完成后 Matrix 同步。
- [ ] `ACC-071` Matrix 完成后 Calendar 同步。
- [ ] `ACC-072` Calendar 拖动后 Today/Matrix 日期同步。
- [ ] `ACC-073` Carry forward 后三视图均显示新日期。
- [ ] `ACC-074` 来源历史不会被误当当前 PENDING。

## 19.9 本次执行收口附录（2026-08-22）

本附录以当前代码、自动化测试和正式桌面 smoke 为准，补充说明前述迁移清单的实际状态。原清单中的历史 `[ ]` 未逐项改写，不应覆盖本附录和 `docs/migration/flowclass/acceptance.md` 的证据判定。

- F6/F7/F8 的实现已完成：正式 Tauri 运行路径使用本机 SQLite，不依赖 HTTP、Auth、Spring、PostgreSQL 或浏览器服务器。
- `INT-CAL-002` 按验收决策标记为 superseded：排期单元格直接消费 WD `ScheduleDay`，不再复制一层 `TaskCalendarAdapter` 事件模型。
- 用户反馈已落地：学生编号可留空并自动生成；取消批量选择；独立日结页删除且首页直接日结；工作台支持跨学生拖拽；顺延目标可删除；改期直接写入 SQLite 并同步三视图。
- 删除契约已收口：严格校验 `expectedVersion`，历史 `CARRIED_OVER/CANCELLED` 不可物理删除，`PENDING` 顺延目标可删除且会清理 lineage 外键。非破坏性命令（改期/更新/关联/重排）与删除不同：以数据库当前版本为准、last-write-wins，陈旧界面版本不拦截用户操作（见 `acceptance.md` "排期修改直接生效" 产品调整与双向测试）。
- 2026-08-29 二次复核修复：形状合法但不存在的日历日期（如 `2026-02-31`）在数据层以 422 `INVALID_DATE` 拒绝；BLOCKED 任务改期即归位 `PENDING`（PRD §7.1 `BLOCKED --> PENDING` 出口落地，TaskCard 不再误锁、仅禁用勾选）；临时任务创建的幂等重放返回完整任务视图；跨学生改期清空 `parent_task_id`/`linked_parent_task_id`；补 DLY-T08 独立零写入用例。详见 `docs/migration/flowclass/acceptance.md` 产品调整补记（2026-08-29 修复轮）。
- 自动化证据：`pnpm check` 通过，Web 14 个测试文件 / 61 个用例通过，Rust fmt/clippy 通过，`pnpm format:check` 与 `git diff --check` 通过。
- 正式桌面证据：`pnpm build` 与 `pnpm verify:desktop` 通过；exe 启动后真实 SQLite migration 为 version 1、success 1，13 张业务表，`integrity_check=ok`。
- 当前仍保留为 MANUAL：用户实际确认 exe 无登录启动、鼠标拖拽手感、工作台滚动手感。提交策略也不由 agent 擅自决定。

---

# 20. 关键风险与防错清单

## R1：把 Flow Course 模型整体带进来

**风险：** 数据结构重新膨胀为教培 ERP。  
**防错：** 任何 PR 出现 `Class/EnrollCourse/Invoice/Institution` 新依赖，默认视为错误方向，除非有明确 WD 业务理由。

## R2：Calendar 强制使用小时语义

**风险：** 为了适配 Flow Day/Week，给作业制造虚假时间。  
**防错：** Calendar 有 PoC Gate；不合适就 Partial adoption。

## R3：AttendanceSheet 覆盖 WD Virtualization

**风险：** 复用后反而性能下降。  
**防错：** 只取结构，保留 TanStack Virtual。

## R4：照搬 Flow delay 的 delete 行为

**风险：** 丢历史、无法解释顺延。  
**防错：** old=CARRIED_OVER，new=PENDING；禁止删除 old。

## R5：照搬“clone last lesson”

**风险：** 顺延错作业内容。  
**防错：** clone current task snapshot。

## R6：改期推进 Track

**风险：** 密卷08 被拖一天却变成密卷09。  
**防错：** 只有 COMPLETE command 能推进 ordinal。

## R7：过早删除 Java

**风险：** 丢掉已经实现好的边界条件。  
**防错：** 先 parity tests，再退役。

## R8：复制 Flow 全局 CSS

**风险：** AntD 页面大面积样式异常。  
**防错：** Tailwind compat 无 preflight，不复制 globals 全局选择器。

## R9：为了“轻量”把 domain 全写进 React 组件

**风险：** Calendar、Today、Matrix 各自一套业务逻辑。  
**防错：** complete/reschedule/carry/findNextDate 全部放 domain service。

## R10：本地 SQLite 后把事务性忽略

**风险：** 顺延只更新旧任务但新任务没创建。  
**防错：** carryForward、complete+track advance 必须在 SQLite transaction 内执行。

---

# 21. 建议提交粒度

不要一个 commit 搬完所有 Flowclass。推荐：

```text
feat(flow-calendar): add isolated calendar compatibility layer
feat(flow-calendar): port month view with task event adapter
feat(flow-calendar): evaluate week/day adoption
feat(workbench): merge flow attendance matrix shell
feat(availability): port weekday and date override editor
feat(scheduling): extract next available date engine
feat(execution): adapt flow delay pattern to carry-forward
refactor(actions): unify complete/reschedule/carry commands
feat(local-db): add sqlite repositories
refactor(local): switch feature APIs to local services
refactor(app): remove auth and remote API bootstrap
chore: remove spring/postgres runtime
```

每个 commit 都应能构建；不要出现“搬了一半 Calendar，主分支三天不能编译”。

---

# 22. 本地实施时的首批 12 个任务

如果要立刻动手，先只做以下 12 个，不要先改数据库：

- [ ] `START-01` 建融合分支并跑 WD baseline。
- [ ] `START-02` 建 `vendor/flowclass/provenance.md`。
- [ ] `START-03` 加 Tailwind compat（无 preflight）。
- [ ] `START-04` COPY CalendarDnDContext。
- [ ] `START-05` COPY/ADAPT EventProvider。
- [ ] `START-06` ADAPT CalendarProvider 去 Recoil。
- [ ] `START-07` COPY DraggableEvent + MonthView 相关依赖。
- [ ] `START-08` 用 mock TaskCalendarEvent 跑 MonthView。
- [ ] `START-09` 做 WeekView/DayView PoC 并做 Full/Partial 决策。
- [ ] `START-10` 从 AttendanceSheet 抽 StudentTaskMatrixShell。
- [ ] `START-11` 接 WD TaskCard + Workbench 数据。
- [ ] `START-12` 造 60×14 数据验证矩阵。

完成这 12 项后，再进入 Availability 和 Delay。这样可以先证明 Flowclass 最有价值的 UI 是否真的适合 WD，避免先重构底层后才发现视图不合适。

---

# 23. 源文件路径速查索引

## Flowclass — Calendar

```text
apps/admin/src/components/ui/FullCalendar/CalendarProvider.tsx
apps/admin/src/components/ui/FullCalendar/CalendarGrid.tsx
apps/admin/src/components/ui/FullCalendar/EventProvider.tsx
apps/admin/src/components/ui/FullCalendar/CalendarDnDContext.tsx
apps/admin/src/components/ui/FullCalendar/DraggableEvent.tsx
apps/admin/src/components/ui/FullCalendar/CalendarHeader.tsx
apps/admin/src/components/ui/FullCalendar/DayViewDropzone.tsx
apps/admin/src/components/ui/FullCalendar/MinutesDropzone.tsx
apps/admin/src/components/ui/FullCalendar/MonthViewDropzone.tsx
apps/admin/src/components/ui/FullCalendar/NDayDropzone.tsx
apps/admin/src/components/ui/FullCalendar/WeekViewEvents.tsx
apps/admin/src/components/ui/FullCalendar/views/DayView.tsx
apps/admin/src/components/ui/FullCalendar/views/NDayView.tsx
apps/admin/src/components/ui/FullCalendar/views/WeekView.tsx
apps/admin/src/components/ui/FullCalendar/views/MonthView.tsx
apps/admin/src/components/ui/FullCalendar/views/ScheduleView.tsx
apps/admin/src/components/ui/FullCalendar/views/YearView.tsx
apps/admin/src/components/ui/FullCalendar/views/EventItem.tsx
apps/admin/src/components/ui/FullCalendar/views/EventItemWithError.tsx
apps/admin/src/types/fullCalendar.type.ts
apps/admin/src/constants/fullCalendar.ts
apps/admin/src/utils/calendar-drag.utils.ts
```

## Flowclass — Matrix

```text
apps/admin/src/pages/AttendanceSheet/index.tsx
apps/admin/src/pages/AttendanceSheet/components/StatusAttendance.tsx
```

## Flowclass — Availability

```text
apps/admin/src/pages/Availability/AvailabilityPage.tsx
apps/admin/src/pages/Availability/components/WeekdayList.tsx
apps/admin/src/pages/Availability/components/DateOverride.tsx
apps/admin/src/pages/Availability/components/AddDateOverride.tsx
apps/admin/src/pages/Availability/components/AddTimeModal.tsx
apps/admin/src/types/availability.type.ts
```

## Flowclass — Delay / Reschedule

```text
apps/api/src/domain/service/class-lesson.service.ts
apps/api/src/application/admin/class-lesson/class-lesson.controller.ts
apps/api/src/models/student-schedule.entity.ts
apps/api/src/domain/service/student-schedule.service.ts
apps/admin/src/pages/FullCalendar/DelayFollowingLessons.tsx
apps/admin/src/pages/FullCalendar/ChangeEntireLesson.tsx
apps/admin/src/api/lessonDateTime.ts
```

## WD — 核心 UI

```text
apps/web/src/app/App.tsx
apps/web/src/app/AppShell.tsx
apps/web/src/features/today/TodayPage.tsx
apps/web/src/features/workbench/StudentWorkbenchPage.tsx
apps/web/src/features/tasks/TaskCard.tsx
apps/web/src/features/tasks/RescheduleModal.tsx
apps/web/src/features/schedule/StudentSchedulePage.tsx
apps/web/src/features/students/StudentProfilePage.tsx
apps/web/src/features/planning/MountTrackModal.tsx
apps/web/src/features/planning/TrackProgressPanel.tsx
apps/web/src/features/templates/TemplateDetailPage.tsx
apps/web/src/features/vocabulary/VocabularyPage.tsx
apps/web/src/features/search/GlobalSearchDialog.tsx
```

## WD — 核心后端参考

```text
apps/api/src/main/java/com/wonderedu/assistant/planning/application/TrackService.java
apps/api/src/main/java/com/wonderedu/assistant/planning/application/SchedulingService.java
apps/api/src/main/java/com/wonderedu/assistant/execution/application/ExecutionService.java
apps/api/src/main/java/com/wonderedu/assistant/execution/application/TodayService.java
apps/api/src/main/java/com/wonderedu/assistant/execution/application/WorkbenchService.java
apps/api/src/main/java/com/wonderedu/assistant/execution/application/DayCloseService.java
apps/api/src/main/java/com/wonderedu/assistant/student/application/AvailabilityService.java
apps/api/src/main/java/com/wonderedu/assistant/student/application/WeekPlanService.java
apps/api/src/main/java/com/wonderedu/assistant/curriculum/application/TemplateService.java
apps/api/src/main/java/com/wonderedu/assistant/vocabulary/application/VocabularyService.java
apps/api/src/main/java/com/wonderedu/assistant/search/application/SearchService.java
```

---

# 24. Definition of Done

这次融合工程只有同时满足以下条件才算完成：

1. Flow Calendar 已经过真实 PoC，而不是凭代码结构决定采用。
2. Calendar 最终不要求真实课时/教师/教室/班级。
3. Flow AttendanceSheet 的矩阵优势进入 WD，但 WD 的虚拟化、TaskCard、Compact/Expanded 保留下来。
4. Flow Availability 的“常规周 + 日期 override”交互进入 WD，并改成适合学习日/分钟数的模型。
5. Flow `delayFollowingLesson` 的优秀模式被吸收，但其“固定周、clone last、删除 current”错误语义没有进入 WD。
6. 所有任务最终只有一个 `TaskInstance` 真值模型，不出现 ClassLesson/StudentLesson 双层复制。
7. 只有完成动作推进 Track。
8. Today、Matrix、Calendar 对同一 Task 的操作结果一致。
9. 最终桌面程序无登录、无机构、无 Spring、无 PostgreSQL、无远端 API 依赖。
10. Spring 退役前，核心业务规则已通过 TypeScript parity tests。
11. Flow 源码来源索引完整，未来可对 vendor 目录做定向更新。
12. 用户可以通过“勾、拖、写、挂、顺延”完成日常助教任务分配与跟进，不再依赖原 Excel 作为执行真值。

---

# 25. 最终一句执行原则

> **先把 Flowclass 中已经好用的 UI/调度骨架搬过来跑通，再改语义；先保留 WD 已经正确的业务规则，再本地化；不要为了架构漂亮重写已经能工作的代码，也不要为了复用 Flowclass 把不需要的教培 SaaS 复杂度带进来。**
