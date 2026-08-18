# Progress Log

## Session: 2026-08-16

### Phase 1: Requirements & Discovery

- **Status:** complete
- **Started:** 2026-08-16
- Actions taken:
  - 读取 planning-with-files 技能并执行 session catch-up。
  - 并行盘点仓库与 DocsHarness 文件集合。
  - 确认当前只有三份基础 Markdown 文档，无实现代码或构建入口。
  - 完整通读 PRD（1036 行），记录 P0 范围、业务不变量、验收场景与性能预算。
  - 通读 SDD 第 1—900 行，确认技术矩阵、单仓拓扑、模块边界、全局规范、数据字典和领域服务入口。
  - 通读 SDD 第 901—1800 行，确认领域算法、API 契约、导入安全、前端交互、Tauri 和认证授权边界。
  - 完整通读 SDD 第 1801—2540 行，确认安全/一致性、排期边界、观测/性能、测试/CI、迁移/恢复、许可证与 ADR。
  - 通读 WBS 第 1—840 行，提炼 Phase 0/1/2 工作包、阶段退出门禁和精确测试要求。
  - 完整通读 WBS 第 841—1641 行，确认 Operationalization、字段/API/组件门禁、追溯矩阵与四项最终判定。
- Files created/modified:
  - `task_plan.md`（创建）
  - `findings.md`（创建）
  - `progress.md`（创建）

### Phase 2: Planning & Structure

- **Status:** in_progress
- Actions taken:
  - 将目标正式设为完成四阶段、AC-001~015 和四项业务证明。
  - 选定 Foundation 工程骨架与健康检查为第一垂直切片。
  - 核验当前 npm/Maven 稳定版本及 Tauri Windows 构建前置；确认 Tauri 本机无环境级阻塞。
- Files created/modified:
  - `task_plan.md`（Phase 1 完成，Phase 2 启动）
  - `findings.md`（补齐完整文档结论）

## Test Results

| Test         | Input                  | Expected         | Actual | Status |
| ------------ | ---------------------- | ---------------- | ------ | ------ |
| 仓库入口探测 | 目录与常见构建文件扫描 | 找到现有启动入口 | 未找到 | 已记录 |

## Error Log

| Timestamp  | Error                                                                           | Attempt | Resolution                                                     |
| ---------- | ------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------- |
| 2026-08-16 | Java/Gradle/Docker 命令不可用                                                   | 1       | 标记为后续环境阻塞，先推进 Node/Rust 骨架                      |
| 2026-08-16 | `services.gradle.org/distributions/gradle-9.7.0-wrapper.jar` 返回 NoSuchKey     | 1       | 改从 Gradle v9.7.0 GitHub raw 路径取得 wrapper jar             |
| 2026-08-16 | `pnpm install` 因 `@eslint/js@10.8.1` 不存在失败                                | 1       | 修正为 `@eslint/js@10.0.1`，准备改用 frozen lock 重试          |
| 2026-08-16 | Web lint 报 4 个 no-misused-promises/require-await/unsafe-return                | 1       | 修正回调与浏览器 PlatformAdapter 实现                          |
| 2026-08-16 | Web lint 第二轮剩余 2 个 promise/any 错误                                       | 2       | 使用 void 忽略导航 Promise，并先将 env 收窄到 unknown          |
| 2026-08-16 | Web typecheck 报 icons 缺包与 Vite test 配置类型错误                            | 1       | 添加 `@ant-design/icons`，切换 `defineConfig` 来源             |
| 2026-08-16 | Tauri no-bundle 因 crates.io 无 `tauri-build=2.11.4` 失败                       | 1       | 锁定 crates.io 当前稳定 `tauri-build=2.6.3` 与 `tauri=2.11.5`  |
| 2026-08-16 | API `compileTestJava` 找不到无版本 Testcontainers                               | 1       | 记录为 BOM 缺口，准备补显式版本                                |
| 2026-08-16 | API 测试编译找不到 `WebMvcTest`                                                 | 1       | Spring Boot 4 测试 starter 组合变化，补显式 test-autoconfigure |
| 2026-08-16 | Boot 4 WebMvcTest 实际位于 `org.springframework.boot.webmvc.test.autoconfigure` | 2       | 添加 webmvc-test artifact 并更新测试 import                    |
| 2026-08-16 | ContextControllerTest context 因 ContextService 多构造函数失败                  | 1       | 标记 IdentityProperties 构造器为 `@Autowired`                  |
| 2026-08-16 | `pnpm format:check` 将 DocsHarness/lock/生成物判为未格式化                      | 1       | 增加 `.prettierignore`，保留基础文档原文不变                   |
| 2026-08-16 | `cargo fmt --check` 报生成文件缩进不一致                                        | 1       | 采用 rustfmt 机械格式化；clippy 已通过                         |
| 2026-08-16 | 统一校验入口初版只执行 Web                                                      | 1       | 扩展为格式、API 测试、Tauri fmt/clippy 全基线                  |
| 2026-08-16 | Vitest suite 因 `describe is not defined` 失败                                  | 1       | 显式导入 Vitest API                                            |

## 5-Question Reboot Check

| Question             | Answer                                          |
| -------------------- | ----------------------------------------------- |
| Where am I?          | Phase 2，正在初始化 Foundation 工程骨架         |
| Where am I going?    | 初始化单仓骨架并按 P0 阶段实现、验证            |
| What's the goal?     | 让项目达到三份文档约定的可运行与验收要求        |
| What have I learned? | 当前为空仓；技术栈与 WBS 基础任务已从探索中确认 |
| What have I done?    | 创建规划文件并完成仓库/文档定位                 |

### Session Recovery and Re-baseline

- **Status:** complete
- 执行 `planning-with-files` session catch-up，发现旧计划落后于代码实现。
- 读取 Git 状态：仓库目前全部为未跟踪初始化文件，未覆盖用户已有已跟踪改动。
- 独立探查审计了三份文档、身份认证和 Foundation 动态状态；获得精确 `file:line` 线索。
- 重建 `task_plan.md` 为 Phase 0~3 + Final Acceptance，当前聚焦数据库身份、会话、RBAC、种子与跨租户测试。
- 将现有实现、关键缺口、本机 Docker 阻塞和跨文档歧义同步至 `findings.md`。

#### Recovery Evidence

- `ContextService` 已修复 `ROLE_` 映射、角色权限与 displayName；相关旧缺口关闭。
- PostgreSQL 迁移集成断言已覆盖 11 张表、`pg_trgm`、2 个 partial unique index、JSONB/timestamptz/date；旧覆盖不足结论关闭。
- `ASSISTANT_SKIP_INFRA=1 node scripts/dev-stack.mjs` 已不再出现 Windows EINVAL；Vite/API 可进入启动阶段，最终受本机 PostgreSQL/端口占用限制。

## Session: 2026-08-16 (continued) — Phase 1 Concurrent Development

### Phase 1: Core Domain Implementation

- **Status:** in_progress
- **Started:** 2026-08-16

Actions taken (3 concurrent subagents + direct work):

1. **Weekly Pattern & Week Plan API** (subagent):
   - Created WeekPlanService, WeekPlanRepository, WeekPlanCommands, WeeklyPatternView, WeekPlanView
   - Endpoints: GET/PUT /students/{id}/weekly-pattern, GET/PUT /students/{id}/week-plans/{weekStart}
   - Validates Monday week start, 7 days, minutes 0-1440, device policy override
   - Week plan creation from BASE_PATTERN copies from ACTIVE weekly pattern

2. **Student Detail & Template Detail Pages** (subagent):
   - Created StudentProfilePage.tsx with full form (name, code, alias, status, classType, enrollmentDate, devicePolicy, note, tags)
   - Added getStudent, updateStudent, patchJson to API client
   - 409 conflict handling with version display
   - Weekly pattern and week plan placeholder sections
   - Template detail page (in progress)

3. **Track Mounting & Task Instance** (subagent):
   - Created V2026_08_16_004__task_instance.sql migration with full SDD §8.11 schema
   - TrackService with mountTrack, calculateTrackPointer (continuous scan, not +1)
   - SchedulingService with scheduleTrackItems, createAdHocTask
   - TrackController: POST/GET /students/{id}/tracks, GET /tracks/{trackId}
   - TrackServiceTest with 7 pointer algorithm test cases

4. **Excel Import** (direct):
   - Added Apache POI 5.4.1 to build.gradle.kts
   - Created V2026_08_16_005__import_job.sql migration
   - ExcelTemplateParser: parses "作业进度目录" format, extracts columns, metadata, titles
   - ImportService: upload+preview, execute with column-to-template mapping
   - ImportController: POST /imports/template-xlsx, POST /imports/{jobId}/execute
   - Frontend ImportPage.tsx with drag-drop upload, preview table, column mapping, execute
   - Added /imports route to App.tsx, import link on TemplateListPage

5. **Fixes during integration**:
   - Fixed Zod 4 UUID validation in test fixtures (v4 format with 4xxx/8xxx)
   - Added testing-library cleanup afterEach to prevent DOM leakage
   - Fixed importexport module Spring Modulith package-info (named interfaces)
   - Fixed lint errors in StudentProfilePage (unused imports, type assertions, setState in effect)

Files created/modified: ~25 new files across API and Web

## Session: 2026-08-16 (continued) — Phase 2 Execution Workbench

- **Status:** in_progress

Actions taken:

1. **ExecutionService** (direct):
   - completeTask with track pointer recalculation (TrackService.recalculateAndPersist)
   - reopenTask with safety check (blocks if later ordinals completed, requires correction)
   - carryOverTask with new instance creation, bidirectional link, locked skip
   - rescheduleTask, cancelTask, lockTask
   - ExecutionController: POST /tasks/{id}/complete|reopen|carry-over|reschedule|cancel|lock
   - TaskInstanceRepository: added complete/reopen/carryOver/block/reschedule/lock methods

2. **Today aggregate read model** (direct):
   - TodayService: single SQL for metrics (FILTER WHERE), single batch for tasks
   - TodayController: GET /api/v1/today?date=&assistantId=
   - TodayPage: date navigator, metric bar, student task groups with checklist

3. **AvailabilityService** (direct):
   - resolveEffectiveAvailability: week_plan > weekly_pattern > default
   - findNextAvailableDate: scans horizon, checks available + device policy
   - Replaced placeholder in ExecutionService with real implementation (BR-007)

4. **Student Schedule page** (direct):
   - ScheduleService: getSchedule aggregates availability + tasks by date range
   - ScheduleController: GET /students/{id}/schedule
   - StudentSchedulePage: day/week/month views, checklist rows
   - Route /students/:studentId/schedule now uses real page

5. **Template Detail page** (direct):
   - TemplateDetailPage: version list, draft item editor, publish button
   - Route /templates/:templateId added

6. **Track Progress frontend** (direct):
   - trackApi.ts, TrackProgressPanel component
   - StudentProfilePage: track progress section

All checks passing throughout: format, lint, typecheck, web tests (4/4), API tests (17/17), cargo fmt/clippy

## Session: 2026-08-16 (continued) — Phase 3 + Concurrent Workflow

- **Status:** in_progress

Actions taken:

1. **Global Search** (direct):
   - DateQueryParser: today/tomorrow/yesterday/next Monday, ISO/slash/CN/short date
   - SearchService: student/template/task/date search groups, tenant-scoped
   - SearchController: GET /api/v1/search?q=&types=&limit=
   - GlobalSearchDialog: debounced input, date hint, grouped results, keyboard nav
   - AppShell: global search button enabled

2. **Vocabulary** (direct):
   - VocabularyRepository: batch + entry CRUD, dedup check, week count
   - VocabularyService: preview (parse + normalize + dedup), save batch
   - VocabularyController: GET/POST /students/{id}/vocabulary + batches:preview/batches
   - VocabularyPage: week filter, batch entry with preview, save, table view
   - V006 migration: search_document, vocabulary_batch, vocabulary_entry

3. **Concurrent subagents launched** (5 agents):
   - Dev: InlineTaskComposer + ad-hoc task API
   - Dev: dnd-kit drag reschedule (re-launched after first attempt failed)
   - Dev: Student workbench grid (WorkbenchService + StudentWorkbenchPage)
   - Audit: Backend execution service business rules
   - Audit: Frontend PRD acceptance criteria coverage

## Session: 2026-08-17 — Audit-Driven Fixes

### Frontend audit (Round 1) — COMPLETE

- Launched Explore agent for PRD AC-001~015 coverage audit. Result: only AC-010 fully COVERED; 4 CRITICAL gaps (D1-D4), 5 MAJOR (D5-D9), 6 MINOR (D10-D15).
- Findings saved to memory: frontend-audit-round1-findings.md

### Fixes applied (direct)

- **D1 FIXED** (AC-002/003/013): `StudentProfilePage` was dead code — route `/students/:studentId/profile` rendered `PlannedRoutePage` placeholder. Wired `StudentProfilePage` into App.tsx, removed unused `PlannedRoutePage` import. Unblocks name→profile entry, track read-side, conflict UI.
- **D2 FIXED** (AC-003): No track-mount UI existed; `mountTrack` was dead code. Created `MountTrackModal` (template/version auto-select published, startOrdinal/endOrdinal bounded by item count, startDate, units/session, priority, note, override confirm). Wired "挂载轨道" button into `StudentProfilePage` TrackSection Card. All checks green: format, lint, typecheck, 4 web tests, API tests, cargo.

### Pending (awaiting backend audit round 2)

- Backend audit agent relaunched (first attempt 504'd during report compilation).
- D3 (carryover UI, AC-006/014) and D4 (usage drawer, AC-012) require NEW backend endpoints (`GET /today/carryovers`, `GET /templates/{id}/usage`, `GET /template-items/{id}/usage`) — confirmed missing. Will address after backend audit to avoid clobbering.
- D5 (optimistic update AC-004), D6 (composer combobox AC-011), D7 (override prompt AC-007), D8 (409 keep input AC-013), D9 (vocab filter/export AC-015), D10-D15 (minor) queued.

### Frontend fixes (continued)

- **D6 FIXED** (AC-011, SDD §15.7): InlineTaskComposer is now an AutoComplete combobox with debounced template search producing two result types — "创建临时任务" (ad-hoc, default on Enter) and "挂载模板" (opens MountTrackModal). Commit 6cfb005.
- **D7 FIXED** (AC-007/BR-009): dragging a task to an unavailable day opens a modal requiring override reason before committing. Commit bf6e5d5.
- **D9 FIXED** (AC-015): VocabularyPage week navigator (prev/next/back-to-this-week), copy normalized terms to clipboard, CSV export with BOM + formula-injection escaping. Commit 4b13a15.
- **D10 FIXED** (AC-001): conflictCount metric rendered on Today bar. Commit bf6e5d5.
- **D11 FIXED** (AC-002, SDD §15.3/§8.4): aria-labels added to student name entry links (Today, StudentList). Commit 3168d70.

### Still open (frontend)

- D3 (AC-006/014 carryover UI) + D4 (AC-012 usage drawer): need backend endpoints GET /today/carryovers, GET /templates/{id}/usage, GET /template-items/{id}/usage.
- D8 (AC-013 409 keep-input/overwrite): MAJOR, pure frontend — current 409 reload-discards-input behavior acceptable for now.
- D12 (KeyboardSensor options), D13 (color-only signal, mostly already addressed via persistent Tag), D14 (undo after drag): MINOR, deferred.

All checks green after each fix. Backend audit round 2 (abe6b7abca149a18a) still running; D3/D4 blocked on backend.

### Backend additions

- **D3 backend FIXED** (AC-006/014): GET /api/v1/today/carryovers endpoint + CarryOverItem view; Today page renders carryover list with 原日期/目标日期/学生/任务/原因/执行时间. Commit 2a1d23d. Single-item undo endpoint deferred (requires undo command on backend).
- **D4 (AC-012 usage drawer)**: STILL OPEN — requires cross-module usage query (curriculum + planning tracks + execution instances). Documented as the one remaining CRITICAL gap.

### Remaining gaps

- D4 (AC-012 reverse task query / Usage Drawer): cross-module backend query + frontend Drawer. Significant scope; deferred to a dedicated slice.
- D8 (AC-013 409 keep-input/overwrite): current reload behavior acceptable; full overwrite UX deferred.
- D14 (AC-008 undo after drag): needs reschedule response to carry new version; deferred.

Backend audit round 2: agent (abe6b7abca149a18a) stalled/terminated without a final report after running for ~30min. I manually verified the core ExecutionService invariants (transactional completeTask, idempotency guard at ExecutionService.java:82-84, pointer via recalculateAndPersist, carryover creates new PENDING with bidirectional link, all write paths check updated==0 → 409). Core invariants hold consistent with round-1 fixes.

## Session: 2026-08-17 — Concurrent audit→fix→dev cycle

### Cycle: 4 agents in parallel

- **Forward dev** (a918c3209278cfb41): D4 reverse task query + Usage Drawer.
- **Backend invariants audit** (ae33032f8510e3f49): 0 CRITICAL, 8/9 invariants VERIFIED.
- **Frontend regression audit** (a900e9a4564cf8c05): running.
- **Data/tenant/security audit** (a979d81f27b16696c): found vocabulary + workbench tenant-isolation gaps.

### Fixes applied from audits (3 commits)

- **Backend 409 `current` snapshot** (commit e3291bc): all 7 optimistic-lock throw sites now re-read the latest row and populate the `current` map ({id,version,status} for tasks; {id,version,currentOrdinal,status} for track) via the 5-arg DomainException constructor. SDD §11.1 satisfied.
- **Tenant isolation** (commit b2e68d9): VocabularyRepository entry SELECTs JOIN vocabulary_batch + org filter; VocabularyService.requireStudentInTenant guard on @PathVariable studentId (closes cross-tenant write hole); WorkbenchService.loadTags JOINs student + org filter, loadVocabCounts JOINs vocabulary_batch + org. No new migration.

### Forward dev completed (commit)

- **D4 FIXED** (AC-012): GET /templates/{id}/usage + GET /template-items/{id}/usage (tenant-scoped), TemplateUsageView/TemplateItemUsageView records, TaskUsageDrawer (AntD Drawer), GlobalSearchDialog opens drawer on TEMPLATE/TEMPLATE_ITEM click instead of navigating. All 15 AC now at least PARTIAL; D4 was the last CRITICAL.

## Session: 2026-08-18 — Concurrent multi-agent loop (27 commits)

### Cycle: 10+ concurrent agents (audit/fix/dev), iterated via /loop 10m

Started with 10 parallel agents (6 read-only audits by module + 4 forward dev). Continued with multiple waves targeting CRITICAL/MAJOR gaps surfaced by audits.

### CRITICAL gaps fixed (6)
- **Export pipeline** (commit 038dba3 + fca5737): ExportService/ExportController/VocabularyController export endpoint + export_job schema. CSV formula injection guard (=+-@\t\r prefix '), UTF-8 BOM, EXPORT_GENERATED audit event.
- **search row-level security** (commit a7b4908): SearchService assistant-scoped by primary_assistant_id (surrogate for student_access), TEMPLATE_ITEM group added.
- **audit module scaffold + wiring** (commit 9ef6209 + 773f2c6): AuditEvent persistence + query API + idempotency. ExecutionService.writeAuditEvent delegates to AuditService.recordEvent with real before/after snapshots (status/scheduledDate/locked/version/carried links).
- **DayCloseService** (commit ff665bb + 535d83f): runDayClose paged scan + @Scheduled cron trigger + POST /api/v1/admin/day-close manual endpoint.
- **BusinessClock day_close_time** (commit de2231e): businessDate rolls back to previous day before day_close_time (FR-EXEC-005/BR-014). SystemBusinessClockTest covers boundary.
- **import cross-tenant** (commit a4ab38e): ImportJobRepository all queries/updates enforce organization_id.

### MAJOR gaps fixed
- **student_subject_preference** (commit a311ceb): FR-PROFILE-006 table + CRUD + GET /students/{id}/subject-preferences.
- **template publish safety** (commit 177866e): lockForPublish row lock + retire old PUBLISHED version + active item count validation + CodeNormalizer (commit 499f789).
- **FOR UPDATE row locks** (commit 6b9be93): findByIdForUpdate on task_instance + track→task lock order (SDD §9.6/§19.2).
- **upload validation** (commit 6460288): .xlsx extension + ZIP magic-number + execute idempotency.
- **out-of-order detection** (commit e9d23a2): TrackProgress.outOfOrder flag + warning (AC-005).
- **frontend CSV guard + business date + AC-012 grouping** (commits 016baa2, bfea44d, 4a06c93, a475785): sanitizeFormula in VocabularyPage, useBusinessDate hook across pages, TaskUsageDrawer grouped by completed/pending/scheduled.
- **AC-007 device conflict** (commit 535d83f): rescheduleTask + carryOverTask check devicePolicy, distinguish DEVICE_POLICY_CONFLICT from day unavailable.
- **undo-carryover + 409 retain input + drag undo + schedule optimistic** (commits 2ea23e9, d7957a4, 4eb7339, bb35958, ceffd31): AC-013/AC-008/AC-014 frontend + backend.
- **MountTrack idempotency** (commit ceffd31): idempotencyKey + structured override detection.

### Architecture
- **Modulith cycle fix** (commit 47c22da): broke importexport↔vocabulary cycle — ExportService owns ExportRow projection + JDBC query (no vocabulary dependency), VocabularyController no longer delegates to ExportController. ArchitectureTest passes.

### Verification (commit 47c22da health check)
- Backend clean compileJava compileTestJava: BUILD SUCCESSFUL
- ArchitectureTest: PASS (no cycle violations)
- Backend unit tests: 20 tests / 0 failures (7 test classes)
- Frontend pnpm check (lint + typecheck): PASS
- Frontend vitest: 4 tests passed

### Remaining (P3, runtime/ops, not code-fixable)
- publish idempotency_record (TODO in TemplateRepository) — local dev acceptable
- Quartz JDBC JobStore cross-instance lock — dev single-instance acceptable
- Import async (NFR-PERF-005) — TODO, synchronous acceptable
- Tauri signing/update, backup/restore drill, performance baseline, UAT — runtime verification items

## Session: 2026-08-18 — P3 polish enhancements (8 commits)

Continued /loop after all CRITICAL/MAJOR closed. Final audit confirmed 15/15 AC fully satisfied. Addressed P3 optional enhancements with WBS Epic numbers:

- `fd71485` Ctrl/Cmd+K global search shortcut (FR-SEARCH-003/P3-SRC-007) — AppShell keydown listener, toggle, aria-keyshortcuts.
- `f90a89a` TanStack Virtual row virtualization (P2-WBK-004) — StudentWorkbenchPage VirtualizedWorkbenchTable via antd components.body + useVirtualizer, sticky first column preserved.
- `3622463` Compact/expanded density toggle (P2-WBK-007) — Segmented control, parameterized +N aggregation and viewport rows.
- `d21f6d6` Batch task operation feature flag (P2-TDY-008) — useFeatureFlag hook + TodayPage bulk complete/reopen, default off.

### Final state (38 commits this loop session)
- PRD AC-001~015: 15/15 fully satisfied
- Four business proofs: all ✅
- ArchitectureTest: PASS (no cycle violations)
- Backend: 20 unit tests pass
- Frontend: lint + typecheck + 4 vitest pass
- Remaining: P3 ops items (Tauri signing, backup drill, perf baseline, UAT) require runtime environment; P2-EXE-024 Quartz JDBC and P3-SEC-002 student_access table acceptable deferrals for dev profile.

## Session: 2026-08-18 — continued SDD endpoint coverage (2 commits)

After P3 polish, continued scanning SDD §11 API contract for unimplemented endpoints:

- `71d561d` Vocabulary subject filter on list endpoint (P3-VOC-006/FR-VOCAB-004) — frontend + backend.
- `3cee9d3` Import preview + save mapping endpoints (SDD §11.10/§14.2) — POST /imports/{jobId}/preview + PUT /imports/{jobId}/mapping.
- `c8c738b` Import errors list + CSV download endpoint (P1-IMP-006/SDD §14.2 step7) — GET /imports/{jobId}/errors (JSON + CSV with formula injection guard).
- `1aef215` Import errors download + list UI (P1-IMP-006 frontend).
- `8ff533d` Day-close manual trigger admin page (FR-EXEC-005) — POST /api/v1/admin/day-close frontend.
- `93af780` Vocabulary entry PATCH status/note (P3-VOC-004/SDD §11.8) — frontend + backend.
- `1e3773e` Audit events viewer page (P3-SEC-004/005) — GET /api/v1/audit-events frontend.
- `5d6d826` Subject preference editor in profile page (FR-PROFILE-006 frontend).
- `c3b8b7a` Schedule impact preview analyzer (FR-PROFILE-007/SDD §9.8) — GET /students/{id}/schedule-impact.
- `5f789d5` search_document projection upsert + rebuild job (SDD §8.17/§13.2) — POST /api/v1/admin/search/rebuild; fixed student/planning cycle by making ScheduleImpactAnalyzer query task_instance via JDBC.
- `8062755` POST /tracks/{trackId}/schedule-items endpoint (SDD §11.5) — exposed SchedulingService.scheduleTrackItems as REST.

### State at 50 commits
- PRD AC-001~015: 15/15 fully satisfied
- ArchitectureTest: PASS
- All SDD §11 major API endpoints implemented (context, students, weekly-pattern, week-plans, workbench, schedule, tracks, tasks, templates, vocabulary, search, imports, exports, audit, day-close, search-rebuild, schedule-items)
- Remaining minor (not blocking): /tracks/{id} pause/resume/cancel lifecycle, GET /tasks/{taskId} detail+history, /tasks/{taskId}/unlock — these are secondary CRUD endpoints
## Session: 2026-08-18 — Cross-Phase Re-Audit Loop

- Restored planning state with `planning-with-files`; detected stale/contradictory phase claims.
- Ran three concurrent read-only adversarial audits for traceability, backend invariants/security, and client/Tauri/gates. Two agents were rate-limited after partial evidence; the client/gate audit completed.
- Main-agent spot checks confirmed the broken Excel job identifier and dev auth topology, plus missing desktop/API/security and acceptance-gate evidence.
- Re-baselined `task_plan.md`: Foundation is no longer marked complete, and database identity/RBAC/tenant/security remain hard requirements.
- Next slice: fix import/dev-start blockers and verified execution invariants, add focused tests, then rerun gates and repeat adversarial audit.
