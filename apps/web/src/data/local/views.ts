//! 只读投影：今日/工作台/排期三个页面视图与全局搜索，一律只读 core。

import type { LocalCore } from "./localCore";
import { nullableText, parseJsonArray, text, type DbRow } from "./rows";
import { datesBetween, formatDate, scheduleWindow, shiftDate } from "./dates";
import { resolveStudyAvailability } from "../../domain/scheduling/availability";

export async function getToday(
  core: LocalCore,
  date?: string,
): Promise<unknown> {
  const businessDate = date ?? formatDate(new Date());
  const students = await core.activeStudents();
  const tasks = await core.tasksBetween(businessDate, businessDate);
  const byStudent = new Map<string, DbRow[]>();
  for (const task of tasks) {
    const studentId = text(task, "student_id");
    byStudent.set(studentId, [...(byStudent.get(studentId) ?? []), task]);
  }
  const groups = students
    .map((student) => ({
      studentId: text(student, "id"),
      studentName: text(student, "name"),
      studentCode: text(student, "student_code"),
      devicePolicy: text(student, "default_device_policy"),
      tasks: (byStudent.get(text(student, "id")) ?? []).map((task) =>
        core.taskSummary(task),
      ),
    }))
    .filter((group) => group.tasks.length > 0);
  const allTasks = groups.flatMap((group) => group.tasks);
  return {
    businessDate,
    metrics: {
      totalStudents: groups.length,
      totalPendingTasks: allTasks.filter((task) => task.status === "PENDING")
        .length,
      totalCompletedTasks: allTasks.filter(
        (task) => task.status === "COMPLETED",
      ).length,
      carriedOverTasks: allTasks.filter(
        (task) => task.status === "CARRIED_OVER",
      ).length,
      blockedTasks: allTasks.filter((task) => task.status === "BLOCKED").length,
      conflictCount: 0,
    },
    students: groups,
  };
}

export async function getWorkbench(
  core: LocalCore,
  from?: string,
  to?: string,
): Promise<unknown> {
  const start = from ?? formatDate(new Date());
  const end = to ?? shiftDate(start, 6);
  const dates = datesBetween(start, end);
  const students = await core.activeStudents();
  const tasks = await core.tasksBetween(start, end);
  const calendars = await core.availabilityCalendars(students, start, end);
  const vocabulary = await core.vocabularyCounts(start, end);
  const statusLabels = await core.storage.select<DbRow>(
    "SELECT id, label, color FROM student_status_label",
  );
  const statusLabelById = new Map(
    statusLabels.map((row) => [
      text(row, "id"),
      {
        id: text(row, "id"),
        label: text(row, "label"),
        color: nullableText(row, "color"),
      },
    ]),
  );
  return {
    range: { from: start, to: end },
    students: students.map((student) => {
      const studentId = text(student, "id");
      const calendar = calendars.get(studentId)!;
      return {
        id: studentId,
        name: text(student, "name"),
        code: text(student, "student_code"),
        // Optional profile columns are included for workbook export. Older
        // databases (before migration v4) simply produce null here.
        classType: nullableText(student, "class_type"),
        examDate: nullableText(student, "exam_date"),
        status: text(student, "status"),
        statusLabel:
          statusLabelById.get(nullableText(student, "status_label_id") ?? "") ??
          statusLabelById.get("00000000-0000-0000-0000-000000000002") ??
          null,
        note: nullableText(student, "note"),
        version: Number(student.version ?? 0),
        devicePolicy: text(student, "default_device_policy"),
        tags: parseJsonArray(student.tags_json),
        vocabularyCountThisWeek: vocabulary.get(studentId) ?? 0,
        days: Object.fromEntries(
          dates.map((date) => {
            const availability = resolveStudyAvailability(calendar, date);
            return [
              date,
              {
                date,
                available: availability.available,
                availableMinutes: availability.availableMinutes,
                availabilitySource: availability.source,
                tasks: tasks
                  .filter(
                    (task) =>
                      text(task, "student_id") === studentId &&
                      nullableText(task, "scheduled_date") === date,
                  )
                  .map((task) => core.workbenchTaskSummary(task)),
              },
            ];
          }),
        ),
      };
    }),
  };
}

export async function getSchedule(
  core: LocalCore,
  studentId: string,
  params?: { from?: string; to?: string; view?: string },
): Promise<unknown> {
  const student = await core.studentRow(studentId);
  const view = params?.view ?? "week";
  const anchorDate = params?.from ?? formatDate(new Date());
  // An explicit `to` wins; otherwise the view decides how wide the window is.
  const window = params?.to
    ? { start: anchorDate, end: params.to }
    : scheduleWindow(anchorDate, view);
  const start = window.start;
  const end = window.end;
  const dates = datesBetween(start, end);
  const tasks = await core.tasksBetween(start, end, studentId);
  const calendar = (
    await core.availabilityCalendars([student], start, end)
  ).get(studentId)!;
  return {
    studentId,
    studentName: text(student, "name"),
    studentCode: text(student, "student_code"),
    devicePolicy: text(student, "default_device_policy"),
    fromDate: start,
    toDate: end,
    view,
    days: dates.map((date) => {
      const availability = resolveStudyAvailability(calendar, date);
      return {
        date,
        available: availability.available,
        availableMinutes: availability.availableMinutes,
        devicePolicy: availability.devicePolicy,
        tasks: tasks
          .filter((task) => nullableText(task, "scheduled_date") === date)
          .map((task) => core.taskSummary(task)),
      };
    }),
  };
}

export async function searchGlobal(
  core: LocalCore,
  query: string,
  limit: number,
): Promise<unknown> {
  const pattern = `%${query.trim().toLocaleLowerCase()}%`;
  if (pattern === "%%") return { query, groups: [], parsedDateHint: null };
  const [students, templates, tasks, vocabulary] = await Promise.all([
    core.storage.select<DbRow>(
      `SELECT id, name, student_code, status FROM student
       WHERE lower(name) LIKE $1 OR lower(student_code) LIKE $1 LIMIT $2`,
      [pattern, limit],
    ),
    core.storage.select<DbRow>(
      `SELECT id, name, template_code, status FROM task_template
       WHERE lower(name) LIKE $1 OR lower(template_code) LIKE $1 LIMIT $2`,
      [pattern, limit],
    ),
    core.storage.select<DbRow>(
      `SELECT id, title_snapshot, scheduled_date, status FROM task_instance
       WHERE lower(title_snapshot) LIKE $1 LIMIT $2`,
      [pattern, limit],
    ),
    core.storage.select<DbRow>(
      `SELECT v.id, v.term_original, v.status, s.name AS student_name
       FROM vocabulary_entry v JOIN student s ON s.id = v.student_id
       WHERE lower(v.term_normalized) LIKE $1 LIMIT $2`,
      [pattern, limit],
    ),
  ]);
  const groups = [
    {
      type: "STUDENT",
      items: students.map((row) => ({
        id: text(row, "id"),
        type: "STUDENT",
        title: text(row, "name"),
        subtitle: text(row, "student_code"),
        status: text(row, "status"),
        payload: null,
      })),
    },
    {
      type: "TEMPLATE",
      items: templates.map((row) => ({
        id: text(row, "id"),
        type: "TEMPLATE",
        title: text(row, "name"),
        subtitle: text(row, "template_code"),
        status: text(row, "status"),
        payload: null,
      })),
    },
    {
      type: "TASK",
      items: tasks.map((row) => ({
        id: text(row, "id"),
        type: "TASK",
        title: text(row, "title_snapshot"),
        subtitle: nullableText(row, "scheduled_date"),
        status: text(row, "status"),
        payload: null,
      })),
    },
    {
      type: "VOCABULARY",
      items: vocabulary.map((row) => ({
        id: text(row, "id"),
        type: "VOCABULARY",
        title: text(row, "term_original"),
        subtitle: nullableText(row, "student_name"),
        status: text(row, "status"),
        payload: null,
      })),
    },
  ].filter((group) => group.items.length > 0);
  return {
    query,
    groups,
    parsedDateHint: /^\d{4}-\d{2}-\d{2}$/.test(query) ? query : null,
  };
}
