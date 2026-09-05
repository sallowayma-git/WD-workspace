# Flowclass provenance

This directory contains code adapted from the local Flowclass source snapshot at
`F:\workspace\flowclass-main`. WD remains the owning repository; Flowclass is a
code donor only.

## Snapshot identity

- Task-book ZIP SHA-256: `54a6579dc6a54e9cc4e5dfb91302001ad0ae9dbaa4ca8eaf171346f58418ee18`
- Local directory manifest SHA-256 (2026-08-19): `cb4f93dc625794842c536f34a63d712298c6a92d8ac2133705945cd31d1ebcb2`
- The local source has no `.git` history. The manifest hash covers sorted relative paths and per-file SHA-256 values, excluding generated/dependency directories.
- WD baseline commit: `3b93f5738c72da47d6e43b32f6a5fb531d3d86b4`
- WD migration branch: `codex/flowclass-fusion`

The task-book ZIP hash and local manifest hash describe different artifacts and
are not expected to match. File-level hashes below are the reproducible source
identity for this migration.

## File decisions

Every ported file also carries the same identity as a header comment at the top
of the file itself (`Source` / `Original path` / `Snapshot` / `Source SHA-256` /
`Decision` / `Adaptations`), so provenance survives file moves.

Original paths are relative to the Flowclass repository root.

| Flowclass source path                                              | Source SHA-256                                                     | Decision        | WD result                                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/admin/src/components/ui/FullCalendar/views/MonthView.tsx`    | `dc2195620a406648c3d94643a64baad930f73bb1ee7473438422e7fae2e84247` | ADAPT (shipped) | `calendar/MonthView.tsx` — Monday-first, date-only 42-day grid shell; cells rendered by the caller                                                    |
| `apps/admin/src/pages/AttendanceSheet/index.tsx`                   | `874699e97940cbaca342e49948b014c93ddf3b7be7255c8106d04aec904d37ef` | ADAPT (shipped) | `matrix/StudentTaskMatrixShell.tsx` — matrix shell only; no attendance/course semantics                                                               |
| `apps/admin/src/components/ui/FullCalendar/CalendarProvider.tsx`   | `261c96404a0713fb30e53767715a0c7feee6aa1d62082843559f97d62fdd20fb` | DROP after PoC  | WD's `StudentSchedulePage` owns view/date state; a second calendar state was the duplicate UI `INT-CAL-001` removes                                   |
| `apps/admin/src/components/ui/FullCalendar/EventProvider.tsx`      | `55ed546ac1b2a75d9c5f4aa77b9fc65c645280f407c39ec2bf3e02a95792ecf0` | DROP after PoC  | Task truth is react-query over local SQLite; no second in-memory event store                                                                          |
| `apps/admin/src/components/ui/FullCalendar/CalendarDnDContext.tsx` | `02b152e3acc0888472db0eed018e1aeea674223a20a097f237bd24472be671e1` | DROP after PoC  | The page already owns a `DndContext` with pointer + keyboard sensors                                                                                  |
| `apps/admin/src/components/ui/FullCalendar/DraggableEvent.tsx`     | `7e372bf2544463bf0d7ef557f6f8174ff5c5f86cc847448766a55d12090fb97e` | DROP after PoC  | WD `TaskCard` is richer (checkbox, context menu, priority flag, lineage badges)                                                                       |
| `apps/admin/src/components/ui/FullCalendar/MonthViewDropzone.tsx`  | `a2ca9961d478b8131c30f7def7d1fbda04bd6774e32445d7f00cc0077e1c51ba` | DROP after PoC  | WD `DayCell` is the droppable and carries availability/`+N`/today marking                                                                             |
| `apps/admin/src/pages/Availability/AvailabilityPage.tsx`           | `d4a01fc2f43fd6547515be0e6b1899eea33cece93415cc741bc0f3a9ce0c7c2a` | REFERENCE       | `features/students/WeeklyPatternEditor.tsx` + `WeekPlanEditor.tsx` — weekly pattern + date override interaction only, rewritten for study-day/minutes |
| `apps/api/src/domain/service/class-lesson.service.ts`              | `482703e039e7a9dd897ad77e25af9721b5adf84a44dc5bf2625a8ff4809476a2` | EXTRACT         | `domain/scheduling/*` — control-flow reference only; no class/lesson models copied                                                                    |

Files marked "DROP after PoC" were built, exercised against mock task events and
then removed once the integration slice showed WD's own components were strictly
better. The hashes stay so a future Flowclass sync can tell whether the upstream
implementation changed enough to revisit the decision. Rationale:
`docs/migration/flowclass/CalendarAdoptionDecision.md`.

§5.1A/B 其余未移植文件（随事件层整体 DROP，未进入依赖树）：`CalendarGrid`、
`DayViewDropzone`、`MinutesDropzone`、`MonthViewDropzone`、`NDayDropzone`、
`WeekViewEvents`、`EventItemWithError`、`ColumnViewWrapper`、`CalendarHeader`、
`EventPopover`、`CreateClassFromCalendarModal`、`LessonDetail*`、`QrCodeView`。
这些文件既未逐条进入上方决策表，也不存在于 WD 仓库；登记在此以满足 SRC-002/003
的"无未解释文件"承诺（个别 DROP 项的逐条理由见 `CalendarAdoptionDecision.md`）。

### Third-party dependencies (STYLE-009)

第三方依赖：无新增（react-dnd/dayjs 均未引入；dayjs 仅为 antd 传递依赖）。
§6.2 允许引入的 react-dnd/dayjs 最终一条都没用——拖拽复用已有 @dnd-kit，日期
计算使用原生 `Date`；禁入清单（recoil / react-query v3 / Flow i18n / Radix）
同样零命中。

### Style compatibility layer decision (STYLE-001~005/008)

样式决策注记：Tailwind 兼容层最终以手写 scoped CSS 等价实现
（`flowclass-compat.css`，无 preflight/无全局选择器，全部规则 scope 在
`.flowclass-scope` / `.flowclass-matrix-*` 下）；STYLE-001/002/004/005 视为
superseded，STYLE-003/008 意图由该文件保证。这是有意偏差而非遗漏——引入
Tailwind 会与 AntD reset 冲突并放大风险 R8（全局 CSS 污染）。

WD-authored, not ported (listed so the vendor directory has no unexplained files):

| WD file                                                                | Why it is not a port                                                                                                                         |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `calendar/types.ts`                                                    | `TaskCalendarEvent` is a WD contract; Flow's `fullCalendar.type.ts` was not copied. Also hosts `canMoveCalendarEvent`, the shared move guard |
| `calendar/dateUtils.ts`                                                | Date-only helpers written for WD; Flow's minute/timestamp utils were rejected by the PoC                                                     |
| `flowclass-compat.css`                                                 | Scoped compatibility layer authored for WD; no Flow global CSS or Tailwind preflight was copied (risk R8)                                    |
| `calendar/calendar.test.tsx`, `matrix/StudentTaskMatrixShell.test.tsx` | WD acceptance tests                                                                                                                          |

Explicitly dropped: authentication, tenant/institution, course/class/enrolment,
attendance status, teacher/room/location, payments, notifications, portals and
Google Calendar integration.

## Extracted algorithm reference (DLY-001)

任务书 §9.4 DLY-001 要求把 Flow 的 `delayFollowingLesson` 原实现摘录到本文件并注明
源函数。摘录目的：文件哈希只能证明"源变了"，不能证明"控制流变了"；下面的骨架让
未来的 Flowclass 定向更新可以直接 diff 控制流本身。

来源：`apps/api/src/domain/service/class-lesson.service.ts`
（Source SHA-256 `482703e039e7a9dd897ad77e25af9721b5adf84a44dc5bf2625a8ff4809476a2`）。
以下为剪裁后的关键骨架：repository options、字段过滤等管道细节以 `…` 省略，控制流、
条件与常量保持逐句对应；`//` 中文注记（含 (1)~(4) 步骤号）为 WD 所加，非源码原文。

```ts
async delayFollowingLesson(classLessonId: number) {
  // 原注释意图（源码 doc comment 大意）：把课推到下一个 recurring 槽位；仅
  // RECURRING 班型；在最后一个 student_lesson 之后追加一节；有阻挡则继续后推；
  // 全部落库后取消当前课（当前 student_lesson 与 class_lesson 一并删除）。
  const lesson = await this.classLessonRepository.findOneById(classLessonId, { … })
  const studentLessons = await this.studentLessonRepository.findByEffectiveClassLessonId(
    [lesson.id], { … }
  )
  const studentSchedules = studentLessons.flatMap((d) => d.studentSchedule)
  const exceptFields = ['createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'id', 'changeStartTime', 'changeEndTime']
  for (const studentSchedule of studentSchedules) {
    // 取该生排期中【最后一个】lesson 作为克隆源
    const lastStudentLesson = studentSchedule.studentLessons[studentSchedule.studentLessons.length - 1]
    // (1) 找下一合法位置：固定 gap=1 周，冲突则递归后推
    const { newStartTime, newEndTime } = await this.recursiveCalculateDateLesson({
      gap: 1, unit: 'weeks',
      startTime: lastStudentLesson.startTime, endTime: lastStudentLesson.endTime,
      classId: lastStudentLesson.classId,
    })
    // (2) clone 当前：student lesson 与 class lesson 各一份 shallow 拷贝
    const newStudentLesson = this.studentLessonRepository.create(shallow({ source: lastStudentLesson, … }))
    const newClassLesson = this.classLessonRepository.create({
      …shallow({ source: lastStudentLesson.classLesson, … }),
      startTime: newStartTime, endTime: newEndTime,
    })
    // (3) 持久化新行并回挂引用
    const existingClass = await this.classLessonRepository.findBy({ courseId: classLesson.courseId, classId: classLesson.classId })
    if (!existingClass) return
    const { id } = await this.classLessonRepository.save(newClassLesson)
    if (newStudentLesson.changeClassLessonId) newStudentLesson.changeClassLessonId = id
    else newStudentLesson.classLessonId = id
    newStudentLesson.studentScheduleId = studentSchedule.id
    newStudentLesson.startTime = newStartTime
    newStudentLesson.endTime = newEndTime
    await this.studentLessonRepository.save(newStudentLesson)
    // (4) 更新旧状态：Flow 直接【删除】当前 student_lesson 与 class_lesson
    await this.studentLessonRepository.deleteByEffectiveClassLessonId(lesson.id)
    await this.classLessonRepository.delete({ id: lesson.id })
  }
}

async recursiveCalculateDateLesson(data) {
  const newStartTime = dayjs(data.startTime).add(data.gap, data.unit)
  const newEndTime = dayjs(data.endTime).add(data.gap, data.unit)
  // class time conflict 扫描：同 classId 下已有 lesson 覆盖新时间窗，则再推一个
  // gap 并递归。（delayFollowingLesson 的注释说 block_time，实现查的是同班 lesson
  // 重叠——以实现为准。）
  const existTeacherLesson = await this.classLessonRepository.findOneBy({
    classId: data.classId,
    startTime: LessThanOrEqual(newStartTime.toDate()),
    endTime: MoreThanOrEqual(newEndTime.toDate()),
  })
  if (!existTeacherLesson) return { newStartTime, newEndTime }
  return this.recursiveCalculateDateLesson({ ...data, startTime: newStartTime, endTime: newEndTime })
}

async getNextRecurringLesson(payload) {
  // 预览包装：同一槽位搜索，格式化返回，不落库。
  const { startTime, endTime, classId } = payload
  const { newStartTime, newEndTime } = await this.recursiveCalculateDateLesson({
    gap: 1, unit: 'weeks', startTime, endTime, classId,
  })
  return {
    newStartTime: dayjs(newStartTime).format('YYYY-MM-DDTHH:mm:ss.SSS'),
    newEndTime: dayjs(newEndTime).format('YYYY-MM-DDTHH:mm:ss.SSS'),
  }
}
```

模式注记（EXTRACT = WD 吸收的控制流骨架；DROP = 有意不带的语义）：

| Flowclass 原语义                                                                          | WD 处置与落点                                                                                                                                 |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| EXTRACT (1) 找下一合法位置：加 gap 后探、被占则继续后推，直到落在合法槽位                 | `taskTransitions.ts` `carryForwardTask` 的 targetDate 决策；逐日后推由 `availability.ts` `findNextAvailableStudyDate` 承担（DLY-002/003/004） |
| EXTRACT (2)+(3) clone 当前快照并持久化：shallow 拷贝 + save 新行、回挂引用                | `carryForwardTask` 的 `{...source}` 全字段快照 + 新 id/version，adapter 单事务 INSERT 并双向回填 lineage（DLY-011/012/013；ACC-064）          |
| EXTRACT (4) 更新旧状态：旧行退役、指向新行                                                | 源任务置 `CARRIED_OVER` 并回填 `carriedToInstanceId`——形态从"删除"改为"状态转换 + 血缘"，行本身保留（ACC-063）                                |
| DROP 固定 `gap: 1, unit: 'weeks'`                                                         | 顺延步长改为"下一可用学习日"（学生周模式/date override 决定），无固定周差（DLY-002；R6 无关，仅换步长语义）                                   |
| DROP clone 排期中最后一个 lesson（`lastStudentLesson`）                                   | 只克隆被顺延的当前任务快照本身（DLY-011；风险 R5 未触发）                                                                                     |
| DROP 删除当前 lesson（`deleteByEffectiveClassLessonId` + `classLessonRepository.delete`） | 源行保留为历史；`deleteTask` 拒删 CARRIED_OVER/CANCELLED 行（DLY-014；风险 R4 未触发）                                                        |
| DROP class time conflict 扫描（同 classId 时间窗重叠查询 + 递归）                         | 无班级/教师/教室概念；"不可用"语义 = 非学习日/设备策略不可用，冲突递归改为迭代 continue 扫描（DLY-004/008/010；`findNextAvailableStudyDate`） |

预览侧对应：`getNextRecurringLesson`（纯计算、不落库）的 WD 等价物是
`taskTransitions.ts` 的 `previewCarryForward`——复用同一套选日与可用性规则，但不产生
BLOCKED 副作用、不写库。

记账补充（复核遗留②，对应 DLY-019）：`previewCarryForward` 纯函数已在 domain 层实现
并通过单测，但 UI 的顺延入口暂未接"先预览落点再确认"流程——属显式裁剪而非遗漏，
接线待产品决策（2026-08-28 记）。

## Re-syncing from Flowclass

`SRC-005`: a future Flowclass update must be diffed against this directory only.
Do not overwrite `features/`, `domain/` or `data/` from Flowclass — those are WD
code that merely borrowed a pattern. The procedure is:

1. Re-hash the Flowclass source paths in the table above.
2. Diff only the changed sources against the matching `vendor/flowclass/` file.
3. Re-apply the per-file `Adaptations` list by hand, then update the hashes here
   and in the file headers.

## License notice

Flowclass includes an MIT license with copyright `Copyright (c) 2026
Flowclass`, plus a separate AGPL notice for server distributions. This client
adaptation retains the MIT notice required for copied or substantial portions:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, subject to inclusion of the copyright and permission
> notice. The software is provided "AS IS", without warranty of any kind.
