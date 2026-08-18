export const meta = {
  name: "phase2-concurrent",
  description: "Concurrent development and adversarial audit for Phase 2",
  phases: ["dev", "audit"],
};

const basePrompt = `You are working on the 助教工作台 (Teaching Assistant Workstation) project at F:\\workspace\\TeachingAssistantWorkstation.
This is a pnpm monorepo: apps/web (React 19/Vite/TS strict), apps/api (Spring Boot 4.1/Modulith), apps/desktop (Tauri 2).
Read the SDD at DocsHarness/02_助教工作台_SDD_开发设计与架构_v1.0.md and PRD at DocsHarness/01_助教工作台_PRD_需求与竞品研究_v1.0.md for specs.
Run \`node scripts/gradle.mjs test\` from project root to verify API compilation.
Run \`pnpm --dir apps/web check\` to verify web lint/typecheck.
Do NOT modify database migration files. Do NOT touch authentication/security code.`;

parallel([
  // ---- DEV TASK 1: InlineTaskComposer + ad-hoc task API ----
  phase("dev", () =>
    agent(
      `${basePrompt}

TASK: Build the InlineTaskComposer component and wire up the ad-hoc task creation API.

Read SDD §15.7 (InlineTaskComposer) and PRD FR-TODAY-005 / FR-TEMPLATE-007.

1. Backend: Check apps/api/src/main/java/com/wonderedu/assistant/planning/application/SchedulingService.java for createAdHocTask.
   Add a controller endpoint POST /api/v1/tasks for ad-hoc task creation if missing.
   The endpoint accepts: studentId, scheduledDate, title, durationMinutes?, requiresDevice?, locked?, note?.
   It should call SchedulingService.createAdHocTask.

2. Frontend: Create apps/web/src/features/today/InlineTaskComposer.tsx:
   - A combobox/input supporting free-text task creation
   - Shows "创建临时任务: {input}" as first suggestion
   - On Enter, creates an ad-hoc task via POST /api/v1/tasks
   - After save, clears input and keeps focus for continuous entry
   - Uses TanStack Query mutation, shows error on failure
3. Add InlineTaskComposer to TodayPage inside each student group card.
4. Add the API client function in a new apps/web/src/features/today/taskApi.ts.

Study patterns in apps/web/src/features/today/todayApi.ts and TodayPage.tsx.
After implementing, run pnpm --dir apps/web check and node scripts/gradle.mjs test. Fix all errors.`,
      { model: "sonnet", subagent_type: "general-purpose" },
    ),
  ),

  // ---- DEV TASK 2: dnd-kit drag reschedule ----
  phase("dev", () =>
    agent(
      `${basePrompt}

TASK: Implement drag-and-drop reschedule for the student schedule page using dnd-kit.

Read SDD §15.5 (拖拽架构) and PRD FR-STUDENT-006 / AC-008.

1. Install dnd-kit: Run \`pnpm --dir apps/web add @dnd-kit/core @dnd-kit/sortable\` and \`pnpm install\`.
2. Update apps/web/src/features/schedule/StudentSchedulePage.tsx:
   - Make task items draggable using useDraggable from @dnd-kit/core
   - Make day cards droppable using useDroppable
   - On drop, call rescheduleTask(taskId, version, targetDate) from scheduleApi.ts
   - Show visual feedback: allowed (normal border), warning (when day unavailable), blocked (when locked)
   - Use DragOverlay for drag preview
   - After successful reschedule, invalidate the schedule query
   - Handle 409 conflict errors with an Alert
3. Add a keyboard-accessible "移到下一天" button as alternative to drag per SDD §15.5
4. Colors must not be the only signal — use text/icons too (PRD §8.4)

Study existing schedule page structure in apps/web/src/features/schedule/.
After implementing, run pnpm --dir apps/web check. Fix all errors.`,
      { model: "sonnet", subagent_type: "general-purpose" },
    ),
  ),

  // ---- DEV TASK 3: Student Workbench Grid ----
  phase("dev", () =>
    agent(
      `${basePrompt}

TASK: Build the multi-student workbench grid page (Student Workbench).

Read PRD FR-STUDENT-001~007 and SDD §15.2 (StudentWorkbenchPage component tree) and §15.4 (StudentScheduleGrid).

1. Backend: Create a WorkbenchService in apps/api/src/main/java/com/wonderedu/assistant/execution/application/WorkbenchService.java:
   - GET /api/v1/workbench/students?from=&to=&density= returns student rows with day cells
   - Each student row: id, name, code, devicePolicy, tags, vocabularyCountThisWeek
   - Each day cell: availability (available, minutes), tasks (id, shortTitle, status, version)
   - Use a single SQL batch query for all students + tasks (no N+1)
   - Default 7 days, max 31 days
   - Create WorkbenchController in execution/web/, WorkbenchViews in execution/api/

2. Frontend: Create apps/web/src/features/workbench/:
   - workbenchApi.ts: API client with Zod schemas
   - StudentWorkbenchPage.tsx:
     - Toolbar: student search, density switch (compact/expanded), date range navigator
     - Student rows with frozen first column (student identity: name→profile link, vocabulary link, schedule link)
     - Date columns showing task summaries
     - Compact view: 2-3 shortTitles + status dots + +N
     - Expanded view: checkboxes, full titles, duration
   - Add route /workbench to App.tsx, add nav link in AppShell.tsx

3. The three entry points (name→profile, vocabulary, schedule) must be independent per AC-002.

Study existing patterns in apps/web/src/features/today/ and apps/web/src/features/students/.
After implementing, run pnpm --dir apps/web check and node scripts/gradle.mjs test. Fix all errors.`,
      { model: "sonnet", subagent_type: "general-purpose" },
    ),
  ),

  // ---- AUDIT TASK 1: Backend execution service audit ----
  phase("audit", () =>
    agent(
      `${basePrompt}

TASK: Adversarial audit of the ExecutionService and related backend code.

Read SDD §9.6 (ExecutionService), §19.1-19.3 (transaction/lock/deadlock), and WBS §7.1 (test matrix EX-01..EX-08, CO-01..CO-08).

Audit these files for correctness:
1. apps/api/src/main/java/com/wonderedu/assistant/execution/application/ExecutionService.java
   - Does completeTask use optimistic version check? Does it recalculate track pointer?
   - Is the complete+pointer+audit in one transaction? (SDD §19.1)
   - Does reopenTask correctly block when later ordinals are completed?
   - Does carryOverTask create bidirectional link? Does it skip locked tasks?
   - Is there a FOR UPDATE lock on task_instance? (SDD §19.2 says there should be)
   - Does it use idempotency keys? (BR-012)
2. apps/api/src/main/java/com/wonderedu/assistant/execution/application/TodayService.java
   - Is the metrics SQL correct? Does it use FILTER (WHERE)?
   - Are all queries tenant-scoped?
3. apps/api/src/main/java/com/wonderedu/assistant/execution/application/ScheduleService.java
   - Is the date range validated? Is it tenant-scoped?
4. apps/api/src/main/java/com/wonderedu/assistant/student/application/AvailabilityService.java
   - Does findNextAvailableDate correctly check availability AND device policy?
   - Is the priority correct: week_plan > weekly_pattern > default?
5. apps/api/src/main/java/com/wonderedu/assistant/planning/application/TrackService.java
   - Does calculateTrackPointer scan from currentOrdinal continuously?
   - Does it handle: single, multi, out-of-order, end+1?

Report findings as a numbered list with file:line, what spec requires, what code does, severity (CRITICAL/MAJOR/MINOR). Do NOT fix anything.`,
      { model: "sonnet", subagent_type: "Explore" },
    ),
  ),

  // ---- AUDIT TASK 2: Frontend AC coverage audit ----
  phase("audit", () =>
    agent(
      `${basePrompt}

TASK: Adversarial audit of the frontend against PRD acceptance criteria.

Read PRD §10 (AC-001~015) and SDD §15.1 (routes), §15.3 (StudentIdentityActions).

Audit these files:
1. apps/web/src/app/App.tsx — Are all required routes present? Is /today the default?
2. apps/web/src/features/today/TodayPage.tsx — Does it satisfy AC-001? Student groups with checklist?
3. apps/web/src/features/students/StudentListPage.tsx — Does it satisfy AC-002 (three independent entry points)?
4. apps/web/src/features/students/StudentProfilePage.tsx — Does it cover FR-PROFILE-002 fields?
5. apps/web/src/features/schedule/StudentSchedulePage.tsx — Day/week/month views per FR-SCHEDULE-002~004?
6. apps/web/src/features/importexport/ImportPage.tsx — Does it satisfy AC-010?
7. apps/web/src/features/templates/TemplateDetailPage.tsx — Draft editing and publishing?
8. apps/web/src/features/planning/TrackProgressPanel.tsx — Shows current/total per AC-003?
9. apps/web/src/lib/api/http.ts — 401 refresh? 409 conflicts? Idempotency-Key?

Report findings as a numbered list with file:line, what PRD/SDD requires, what code does or is missing, severity (CRITICAL/MAJOR/MINOR). Do NOT fix anything.`,
      { model: "sonnet", subagent_type: "Explore" },
    ),
  ),
]);
