// @vitest-environment node
/// <reference types="node" />
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { ApiError } from "../../lib/api/ApiError";
import * as studentApi from "../../features/students/studentApi";
import { setDataAdapterForTests } from "../runtime";
import type {
  LocalQueryResult,
  LocalSqlStatement,
  LocalStorage,
} from "./LocalStorage";
import { SqliteLocalDataAdapter } from "./sqliteLocalDataAdapter";

function sqliteValue(value: unknown): string | number | null {
  if (value == null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "string") return value;
  return JSON.stringify(value);
}

function nodeStatement(sql: string, values: unknown[]) {
  const orderedValues: unknown[] = [];
  const normalizedSql = sql.replace(/\$(\d+)/g, (_match, index: string) => {
    orderedValues.push(values[Number(index) - 1]);
    return "?";
  });
  return { sql: normalizedSql, values: orderedValues.map(sqliteValue) };
}

class NodeSqliteStorage implements LocalStorage {
  readonly database: DatabaseSync;

  constructor(databasePath = ":memory:", initializeMigration = true) {
    this.database = new DatabaseSync(databasePath);
    if (!initializeMigration) return;
    for (const file of [
      "0001_local_core.sql",
      "0002_sequence_long_task.sql",
      "0003_sequence_invariants.sql",
    ]) {
      const migrationUrl = new URL(
        `../../../../desktop/src-tauri/migrations/${file}`,
        import.meta.url,
      );
      this.database.exec(readFileSync(migrationUrl, "utf8"));
    }
  }

  select<TRow extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<TRow[]> {
    const statement = nodeStatement(sql, values);
    return Promise.resolve(
      this.database.prepare(statement.sql).all(...statement.values) as TRow[],
    );
  }

  execute(sql: string, values: unknown[] = []): Promise<LocalQueryResult> {
    const statement = nodeStatement(sql, values);
    const result = this.database
      .prepare(statement.sql)
      .run(...statement.values);
    return Promise.resolve({
      rowsAffected: Number(result.changes),
      lastInsertId: Number(result.lastInsertRowid),
    });
  }

  transaction(statements: LocalSqlStatement[]): Promise<number[]> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const changes = statements.map((statement) => {
        const normalized = nodeStatement(statement.sql, statement.values ?? []);
        const result = this.database
          .prepare(normalized.sql)
          .run(...normalized.values);
        const rowsAffected = Number(result.changes);
        if (
          statement.expectedRowsAffected != null &&
          rowsAffected !== statement.expectedRowsAffected
        ) {
          throw new Error(
            `expected ${statement.expectedRowsAffected} affected rows, got ${rowsAffected}`,
          );
        }
        return rowsAffected;
      });
      this.database.exec("COMMIT");
      return Promise.resolve(changes);
    } catch (error) {
      this.database.exec("ROLLBACK");
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}

class InterleavedSqliteStorage extends NodeSqliteStorage {
  afterIdempotencyMiss?: () => Promise<void>;

  override async select<TRow extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<TRow[]> {
    const rows = await super.select<TRow>(sql, values);
    if (
      sql.includes("FROM idempotency_record") &&
      rows.length === 0 &&
      this.afterIdempotencyMiss
    ) {
      const commit = this.afterIdempotencyMiss;
      this.afterIdempotencyMiss = undefined;
      await commit();
    }
    return rows;
  }
}

describe("SqliteLocalDataAdapter", () => {
  let storage: NodeSqliteStorage | undefined;

  afterEach(() => {
    setDataAdapterForTests(null);
    storage?.database.close();
    storage = undefined;
  });

  it("returns student API views after creating and editing a profile", async () => {
    storage = new NodeSqliteStorage();
    setDataAdapterForTests(new SqliteLocalDataAdapter(storage));

    const created = await studentApi.createStudent({
      name: "Profile contract",
      classType: "Test class",
      defaultDevicePolicy: "ALLOWED",
      subjectPreferences: [
        { subjectCode: "ENGLISH", priority: 1, targetRatio: 100, note: null },
      ],
    });
    expect(created).toMatchObject({
      studentCode: "S001",
      name: "Profile contract",
      classType: "Test class",
      defaultDevicePolicy: "ALLOWED",
      subjectPreferences: [{ subjectCode: "ENGLISH", targetRatio: 100 }],
    });
    await expect(studentApi.getStudent(created.id)).resolves.toEqual(created);

    const updated = await studentApi.updateStudent(created.id, {
      name: "Edited profile",
      alias: "Alias",
      status: "PAUSED",
      defaultDevicePolicy: "NOT_ALLOWED",
      classType: "Updated class",
      enrollmentDate: "2026-09-07",
      note: "Saved from the profile form",
      tags: [{ code: "PILOT", name: "Pilot" }],
      subjectPreferences: [],
      expectedVersion: created.version,
    });
    expect(updated).toMatchObject({
      studentCode: "S001",
      name: "Edited profile",
      defaultDevicePolicy: "NOT_ALLOWED",
      enrollmentDate: "2026-09-07",
      tags: [{ code: "PILOT", name: "Pilot" }],
      subjectPreferences: [],
      version: created.version + 1,
    });
    await expect(studentApi.getStudent(created.id)).resolves.toEqual(updated);
    await expect(studentApi.listStudents("Edited")).resolves.toMatchObject({
      items: [updated],
      total: 1,
    });
  });

  it("runs the student-template-track execution flow atomically", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);

    const student = (await adapter.createStudent({
      studentCode: "S001",
      name: "林同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    await adapter.saveWeeklyPattern(student.id, {
      effectiveFrom: "2026-08-17",
      days: Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: index < 5,
        availableMinutes: index < 5 ? 120 : 0,
        devicePolicyOverride: null,
      })),
    });

    const template = (await adapter.createTemplate({
      templateCode: "PAPER",
      name: "密卷",
      subjectCode: "ENGLISH",
      unitLabel: "套",
      defaultRequiresDevice: false,
    })) as { id: string };
    const detail = (await adapter.getTemplateDetail(template.id)) as {
      versions: Array<{ id: string; status: string }>;
    };
    const draft = detail.versions.find(
      (version) => version.status === "DRAFT",
    )!;
    await adapter.replaceVersionItems(draft.id, {
      items: [
        {
          ordinal: 1,
          itemCode: "P01",
          title: "密卷 01",
          shortTitle: "密卷01",
          durationMinutes: 90,
          requiresDevice: false,
          contentRef: null,
          instructions: null,
          active: true,
        },
        {
          ordinal: 2,
          itemCode: "P02",
          title: "密卷 02",
          shortTitle: "密卷02",
          durationMinutes: 90,
          requiresDevice: false,
          contentRef: null,
          instructions: null,
          active: true,
        },
      ],
      changeNote: "initial",
    });
    await adapter.publishVersion(draft.id);

    const track = (await adapter.mountTrack({
      studentId: student.id,
      idempotencyKey: crypto.randomUUID(),
      templateId: template.id,
      templateVersionId: draft.id,
      startOrdinal: 1,
      endOrdinal: 2,
      startDate: "2026-08-17",
      defaultUnitsPerSession: 1,
      priority: 50,
      schedulingPolicy: "MANUAL",
      createFirstInstance: true,
    })) as { id: string; currentOrdinal: number };
    expect(track.currentOrdinal).toBe(1);

    const initialSchedule = (await adapter.getSchedule(student.id, {
      from: "2026-08-17",
      to: "2026-08-21",
      view: "week",
    })) as {
      days: Array<{
        date: string;
        tasks: Array<{ id: string; status: string; version: number }>;
      }>;
    };
    const firstTask = initialSchedule.days[0].tasks[0];
    const completionKey = crypto.randomUUID();
    await Promise.all([
      adapter.completeTask({
        taskId: firstTask.id,
        expectedVersion: firstTask.version,
        idempotencyKey: completionKey,
      }),
      adapter.completeTask({
        taskId: firstTask.id,
        expectedVersion: firstTask.version,
        idempotencyKey: completionKey,
      }),
    ]);

    const advancedTrack = (await adapter.getTrack(track.id)) as {
      currentOrdinal: number;
    };
    expect(advancedTrack.currentOrdinal).toBe(2);
    const pendingRows = await storage.select<{ count: number }>(
      `SELECT COUNT(*) AS count FROM task_instance
       WHERE track_id = $1 AND status = 'PENDING'`,
      [track.id],
    );
    expect(pendingRows[0].count).toBe(1);

    const scheduleAfterComplete = (await adapter.getSchedule(student.id, {
      from: "2026-08-17",
      to: "2026-08-21",
      view: "week",
    })) as typeof initialSchedule;
    const secondTask = scheduleAfterComplete.days
      .flatMap((day) => day.tasks)
      .find((task) => task.status === "PENDING")!;
    await adapter.rescheduleTask({
      taskId: secondTask.id,
      expectedVersion: secondTask.version,
      targetDate: "2026-08-19",
      overrideReason: "家长确认",
    });
    expect(
      ((await adapter.getTrack(track.id)) as { currentOrdinal: number })
        .currentOrdinal,
    ).toBe(2);

    const carried = (await adapter.carryForwardTask({
      sourceTaskId: secondTask.id,
      reason: "未完成",
    })) as { sourceTaskId: string; targetTaskId: string; targetDate: string };
    expect(carried).toMatchObject({
      sourceTaskId: secondTask.id,
      targetDate: "2026-08-20",
    });
    const lineage = await storage.select<{
      source_status: string;
      carried_to_instance_id: string;
      target_status: string;
      carried_from_instance_id: string;
    }>(
      `SELECT source.status AS source_status, source.carried_to_instance_id,
              target.status AS target_status, target.carried_from_instance_id
       FROM task_instance source
       JOIN task_instance target ON target.id = source.carried_to_instance_id
       WHERE source.id = $1`,
      [secondTask.id],
    );
    expect(lineage[0]).toMatchObject({
      source_status: "CARRIED_OVER",
      carried_to_instance_id: carried.targetTaskId,
      target_status: "PENDING",
      carried_from_instance_id: secondTask.id,
    });

    // ACC-065: carrying a task forward must not advance the track pointer.
    // Only a COMPLETE command may move the ordinal.
    expect(
      ((await adapter.getTrack(track.id)) as { currentOrdinal: number })
        .currentOrdinal,
    ).toBe(2);

    const today = (await adapter.getToday("2026-08-20")) as {
      businessDate: string;
      students: Array<{
        studentId: string;
        tasks: Array<{
          id: string;
          status: string;
          scheduledDate: string;
          carriedFromDate: string | null;
          version: number;
        }>;
      }>;
    };
    const workbench = (await adapter.getWorkbench(
      "2026-08-17",
      "2026-08-21",
    )) as {
      range: { from: string; to: string };
      students: Array<{
        id: string;
        days: Record<
          string,
          {
            tasks: Array<{
              id: string;
              status: string;
              scheduledDate: string;
              carriedFromDate: string | null;
              version: number;
            }>;
          }
        >;
      }>;
    };
    const schedule = (await adapter.getSchedule(student.id, {
      from: "2026-08-17",
      to: "2026-08-21",
      view: "week",
    })) as {
      fromDate: string;
      toDate: string;
      days: Array<{
        date: string;
        tasks: Array<{
          id: string;
          status: string;
          scheduledDate: string;
          carriedFromDate: string | null;
          version: number;
        }>;
      }>;
    };
    const todayTask = today.students
      .find((item) => item.studentId === student.id)
      ?.tasks.find((task) => task.id === carried.targetTaskId);
    const workbenchTask = workbench.students
      .find((item) => item.id === student.id)
      ?.days["2026-08-20"]?.tasks.find(
        (task) => task.id === carried.targetTaskId,
      );
    const scheduleTask = schedule.days
      .find((day) => day.date === "2026-08-20")
      ?.tasks.find((task) => task.id === carried.targetTaskId);
    expect(today).toMatchObject({ businessDate: "2026-08-20" });
    expect(workbench).toMatchObject({
      range: { from: "2026-08-17", to: "2026-08-21" },
    });
    expect(schedule).toMatchObject({
      fromDate: "2026-08-17",
      toDate: "2026-08-21",
    });
    // DLY-022 数据侧：三个投影同源（同一 tasksBetween 查询），顺延目标任务
    // 必须带回来源日期 2026-08-19（源行改期后的原排期日），驱动 TaskCard
    // 的"由 YYYY-MM-DD 顺延"tooltip。
    for (const task of [todayTask, workbenchTask, scheduleTask]) {
      expect(task).toMatchObject({
        id: carried.targetTaskId,
        status: "PENDING",
        scheduledDate: "2026-08-20",
        carriedFromDate: "2026-08-19",
        version: 0,
      });
    }

    await expect(
      adapter.reopenTask({
        taskId: firstTask.id,
        expectedVersion: firstTask.version + 1,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "TASK_REOPEN_REQUIRES_CORRECTION",
    } satisfies Partial<ApiError>);
  });

  it("orders same-day tasks by star, priority, then sort order (INT-CAL-009)", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = (await adapter.createStudent({
      studentCode: "S-ORD",
      name: "排序同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };

    const createOn = (title: string) =>
      adapter.createAdHocTask({
        studentId: student.id,
        scheduledDate: "2026-09-01",
        title,
        idempotencyKey: crypto.randomUUID(),
      }) as Promise<{ id: string }>;
    const plain = await createOn("普通任务");
    const high = await createOn("高优先");
    const starredLow = await createOn("星标低优");
    const starredHigh = await createOn("星标高优");
    await adapter.updateTask(high.id, { priority: "HIGH", expectedVersion: 0 });
    await adapter.updateTask(starredLow.id, {
      priority: "LOW",
      star: true,
      expectedVersion: 0,
    });
    await adapter.updateTask(starredHigh.id, {
      priority: "HIGH",
      star: true,
      expectedVersion: 0,
    });

    const expected = [starredHigh.id, starredLow.id, high.id, plain.id];
    const today = (await adapter.getToday("2026-09-01")) as {
      students: Array<{ tasks: Array<{ id: string }> }>;
    };
    expect(today.students[0].tasks.map((task) => task.id)).toEqual(expected);
    // 三视图同源：排期页走同一条 tasksBetween 查询，同日顺序必须一致。
    const schedule = (await adapter.getSchedule(student.id, {
      from: "2026-09-01",
      to: "2026-09-01",
      view: "day",
    })) as { days: Array<{ tasks: Array<{ id: string }> }> };
    expect(schedule.days[0].tasks.map((task) => task.id)).toEqual(expected);
  });

  it("reports the stored source status when a carry-forward reuses an existing target", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = (await adapter.createStudent({
      studentCode: "S-REUSE",
      name: "复用同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    await adapter.saveWeeklyPattern(student.id, {
      effectiveFrom: "2026-09-01",
      days: Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: true,
        availableMinutes: 120,
        devicePolicyOverride: null,
      })),
    });
    const source = (await adapter.createAdHocTask({
      studentId: student.id,
      scheduledDate: "2026-09-01",
      title: "脏状态源",
      idempotencyKey: crypto.randomUUID(),
    })) as { id: string };
    const first = (await adapter.carryForwardTask({
      sourceTaskId: source.id,
      reason: "未完成",
    })) as { targetTaskId: string; targetDate: string; status: string };
    expect(first.status).toBe("CARRIED_OVER");

    // 脏状态：源行被异常复位 PENDING，而 lineage 与顺延目标仍完好。再次
    // 顺延时 domain 原样复用既有目标、不产生任何写语句——响应必须如实
    // 反映库内源行的真实状态，而不是硬编码 CARRIED_OVER（审计 E MINOR-5）。
    await storage.execute(
      "UPDATE task_instance SET status = 'PENDING' WHERE id = $1",
      [source.id],
    );
    const second = (await adapter.carryForwardTask({
      sourceTaskId: source.id,
      reason: "未完成",
    })) as {
      targetTaskId: string | null;
      targetDate: string | null;
      status: string;
    };
    expect(second).toMatchObject({
      targetTaskId: first.targetTaskId,
      targetDate: first.targetDate,
      status: "PENDING",
    });
  });

  it("runs day close from a stable local candidate snapshot", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = (await adapter.createStudent({
      studentCode: "S002",
      name: "周同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    await adapter.saveWeeklyPattern(student.id, {
      effectiveFrom: "2026-08-17",
      days: Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: index === 4,
        availableMinutes: index === 4 ? 120 : 0,
        devicePolicyOverride: null,
      })),
    });

    const source = (await adapter.createAdHocTask({
      studentId: student.id,
      scheduledDate: "2026-08-19",
      title: "需要顺延",
      locked: false,
      idempotencyKey: crypto.randomUUID(),
    })) as { id: string };
    await adapter.createAdHocTask({
      studentId: student.id,
      scheduledDate: "2026-08-18",
      title: "锁定任务",
      locked: true,
      idempotencyKey: crypto.randomUUID(),
    });
    await adapter.createAdHocTask({
      studentId: student.id,
      scheduledDate: "2026-08-20",
      title: "未来任务",
      locked: false,
      idempotencyKey: crypto.randomUUID(),
    });

    const summary = (await adapter.triggerDayClose("2026-08-19")) as {
      scanned: number;
      carried: number;
      blocked: number;
      failed: number;
    };
    expect(summary).toMatchObject({
      scanned: 1,
      carried: 1,
      blocked: 0,
      failed: 0,
    });

    const lineage = await storage.select<{
      source_status: string;
      target_status: string;
      target_date: string;
    }>(
      `SELECT source.status AS source_status, target.status AS target_status,
              target.scheduled_date AS target_date
       FROM task_instance source
       JOIN task_instance target ON target.id = source.carried_to_instance_id
       WHERE source.id = $1`,
      [source.id],
    );
    expect(lineage[0]).toEqual({
      source_status: "CARRIED_OVER",
      target_status: "PENDING",
      target_date: "2026-08-21",
    });

    await expect(adapter.triggerDayClose("2026-08-19")).resolves.toMatchObject({
      scanned: 0,
      carried: 0,
      failed: 0,
    });
  });

  it("catches up the day close that nobody ran while the app was closed", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = (await adapter.createStudent({
      studentCode: "S-REC",
      name: "补日结同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    await adapter.saveWeeklyPattern(student.id, {
      effectiveFrom: "2026-08-17",
      days: Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: true,
        availableMinutes: 120,
        devicePolicyOverride: null,
      })),
    });
    // 关着的这几天各积了一项，启动时应该一次全扫掉。
    for (const scheduledDate of ["2026-08-19", "2026-08-20", "2026-08-21"]) {
      await adapter.createAdHocTask({
        studentId: student.id,
        scheduledDate,
        title: `落下的 ${scheduledDate}`,
        locked: false,
        idempotencyKey: crypto.randomUUID(),
      });
    }

    const first = (await adapter.reconcileStartup("2026-08-22")) as {
      ran: boolean;
      previousDate: string | null;
      summary: { scanned: number; carried: number; failed: number } | null;
    };
    expect(first.ran).toBe(true);
    expect(first.previousDate).toBeNull();
    expect(first.summary).toMatchObject({ scanned: 3, carried: 3, failed: 0 });

    // 同一天再开一次不重复扫，也不再出声。
    const second = (await adapter.reconcileStartup("2026-08-22")) as {
      ran: boolean;
      previousDate: string | null;
      summary: unknown;
    };
    expect(second).toMatchObject({
      ran: false,
      previousDate: "2026-08-22",
      summary: null,
    });

    // 顺延后的任务落在 22 号之后，下一天的补日结才会再管它们。
    const pending = await storage.select<{ scheduled_date: string }>(
      `SELECT scheduled_date FROM task_instance WHERE status = 'PENDING'
       ORDER BY scheduled_date`,
    );
    expect(pending.every((row) => row.scheduled_date > "2026-08-22")).toBe(
      true,
    );
  });

  it("deletes both ends of a carry-forward chain and rolls the track pointer back", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = (await adapter.createStudent({
      studentCode: "S-DEL",
      name: "删除同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    await adapter.saveWeeklyPattern(student.id, {
      effectiveFrom: "2026-08-17",
      days: Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: true,
        availableMinutes: 120,
        devicePolicyOverride: null,
      })),
    });
    const template = (await adapter.createTemplate({
      templateCode: "DEL",
      name: "删除卷",
      subjectCode: "ENGLISH",
      unitLabel: "套",
      defaultRequiresDevice: false,
    })) as { id: string };
    const detail = (await adapter.getTemplateDetail(template.id)) as {
      versions: Array<{ id: string; status: string }>;
    };
    const draft = detail.versions.find((v) => v.status === "DRAFT")!;
    await adapter.replaceVersionItems(draft.id, {
      items: [1, 2].map((ordinal) => ({
        ordinal,
        itemCode: `D0${String(ordinal)}`,
        title: `删除卷 0${String(ordinal)}`,
        shortTitle: `删除0${String(ordinal)}`,
        durationMinutes: 60,
        requiresDevice: false,
        contentRef: null,
        instructions: null,
        active: true,
      })),
      changeNote: "initial",
    });
    // publishVersion 是原地把 draft 转为 PUBLISHED，返回的是模板摘要而不是版本。
    await adapter.publishVersion(draft.id);
    const track = (await adapter.mountTrack({
      idempotencyKey: crypto.randomUUID(),
      studentId: student.id,
      templateId: template.id,
      templateVersionId: draft.id,
      startOrdinal: 1,
      endOrdinal: 2,
      startDate: "2026-08-17",
      defaultUnitsPerSession: 1,
      priority: 50,
      schedulingPolicy: "MANUAL",
      createFirstInstance: true,
    })) as { id: string };

    type Task = { id: string; version: number; status: string };
    const firstTask = (
      (await adapter.getSchedule(student.id, {
        from: "2026-08-17",
        view: "week",
      })) as { days: Array<{ tasks: Task[] }> }
    ).days.flatMap((d) => d.tasks)[0];

    // 顺延产生一条 TRACK 来源的目标任务，并建立双向 lineage。
    const carried = (await adapter.carryForwardTask({
      sourceTaskId: firstTask.id,
      reason: "未完成",
    })) as { targetTaskId: string };
    expect(carried.targetTaskId).toBeTruthy();

    // 删除顺延目标。源任务的 carried_to 指针仍指着它，且它的 source_type 是
    // TRACK —— 这两点原先各自都会让删除失败。
    const target = (await adapter.getSchedule(student.id, {
      from: "2026-08-17",
      view: "month",
    })) as { days: Array<{ tasks: Task[] }> };
    const targetTask = target.days
      .flatMap((d) => d.tasks)
      .find((task) => task.id === carried.targetTaskId)!;
    await expect(
      adapter.deleteTask(targetTask.id, {
        expectedVersion: targetTask.version,
      }),
    ).resolves.toBeUndefined();

    const remaining = await storage.select<{ c: number }>(
      `SELECT COUNT(*) AS c FROM task_instance WHERE id = $1`,
      [carried.targetTaskId],
    );
    expect(remaining[0].c).toBe(0);
    // 对侧指针已清空，源行本身保留为历史。
    const source = await storage.select<{
      carried_to_instance_id: string | null;
      status: string;
    }>(
      `SELECT carried_to_instance_id, status FROM task_instance WHERE id = $1`,
      [firstTask.id],
    );
    expect(source[0]).toMatchObject({
      carried_to_instance_id: null,
      status: "CARRIED_OVER",
    });

    // 来源行已经是历史记录，即使对侧引用已清理，也不能被物理删除。
    const sourceRow = await storage.select<{ version: number }>(
      `SELECT version FROM task_instance WHERE id = $1`,
      [firstTask.id],
    );
    await expect(
      adapter.deleteTask(firstTask.id, {
        expectedVersion: sourceRow[0].version,
      }),
    ).rejects.toMatchObject({
      code: "TASK_NOT_DELETABLE",
    } satisfies Partial<ApiError>);

    // 轨道指针仍保留，且历史来源仍在数据库中。
    const trackAfter = (await adapter.getTrack(track.id)) as {
      currentOrdinal: number;
    };
    expect(trackAfter.currentOrdinal).toBe(1);
    const sourceStillExists = await storage.select<{ id: string }>(
      `SELECT id FROM task_instance WHERE id = $1`,
      [firstTask.id],
    );
    expect(sourceStillExists).toHaveLength(1);
  });

  it("edits task text across all views and rejects stale edits", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = (await adapter.createStudent({
      name: "编辑同学",
      defaultDevicePolicy: "ALLOWED",
    })) as {
      id: string;
    };
    const task = (await adapter.createAdHocTask({
      studentId: student.id,
      scheduledDate: "2026-09-10",
      title: "原任务",
      note: "原备注",
      idempotencyKey: crypto.randomUUID(),
    })) as { id: string };
    await storage.execute(
      "UPDATE task_instance SET short_title_snapshot = '原简称' WHERE id = $1",
      [task.id],
    );
    await expect(
      adapter.updateTask(task.id, {
        title: "阅读复盘",
        note: "保留重点",
        expectedVersion: 0,
      }),
    ).resolves.toMatchObject({
      titleSnapshot: "阅读复盘",
      shortTitleSnapshot: null,
      note: "保留重点",
      version: 1,
    });
    await expect(
      adapter.updateTask(task.id, { title: "过期输入", expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: "LOCAL_DATABASE_ERROR" });
    const today = (await adapter.getToday("2026-09-10")) as {
      students: Array<{ tasks: unknown[] }>;
    };
    expect(today.students[0].tasks[0]).toMatchObject({
      title: "阅读复盘",
      note: "保留重点",
    });
    const workbench = (await adapter.getWorkbench(
      "2026-09-10",
      "2026-09-10",
    )) as { students: Array<{ days: Record<string, { tasks: unknown[] }> }> };
    expect(workbench.students[0].days["2026-09-10"].tasks[0]).toMatchObject({
      title: "阅读复盘",
      note: "保留重点",
    });
    const schedule = (await adapter.getSchedule(student.id, {
      from: "2026-09-10",
      view: "day",
    })) as { days: Array<{ tasks: unknown[] }> };
    expect(schedule.days[0].tasks[0]).toMatchObject({
      title: "阅读复盘",
      note: "保留重点",
    });
    await expect(
      adapter.updateTask(task.id, { note: "", expectedVersion: 1 }),
    ).resolves.toMatchObject({ titleSnapshot: "阅读复盘", note: "" });
  });

  it("keeps sequence definitions out of course selectors and searches", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const course = (await adapter.createTemplate({
      name: "阅读 Day",
      unitLabel: "项",
    })) as { id: string };
    await adapter.createLongTask({ sampleTitle: "阅读 Day 1" });
    for (const query of [undefined, "Day"]) {
      const result = (await adapter.listTemplates(query)) as {
        items: Array<{ id: string }>;
      };
      expect(result.items.map((item) => item.id)).toEqual([course.id]);
    }
    await expect(adapter.listTemplates("LT-")).resolves.toMatchObject({
      items: [],
    });
  });

  it("does not delete a task when delete version is stale", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = (await adapter.createStudent({
      studentCode: "S-DELETE-VERSION",
      name: "删除版本同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    const task = (await adapter.createAdHocTask({
      idempotencyKey: crypto.randomUUID(),
      studentId: student.id,
      scheduledDate: "2026-08-18",
      title: "版本保护删除",
    })) as { id: string };

    await adapter.updateTask(task.id, { title: "已更新", expectedVersion: 0 });
    await expect(
      adapter.deleteTask(task.id, { expectedVersion: 0 }),
    ).rejects.toMatchObject({
      code: "LOCAL_DATABASE_ERROR",
    } satisfies Partial<ApiError>);
    const remaining = await storage.select<{ id: string; version: number }>(
      `SELECT id, version FROM task_instance WHERE id = $1`,
      [task.id],
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0].version).toBe(1);
  });

  it("applies a move even when the caller passes a stale version", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = (await adapter.createStudent({
      studentCode: "S-STALE",
      name: "陈旧同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    await adapter.saveWeeklyPattern(student.id, {
      effectiveFrom: "2026-08-17",
      days: Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: true,
        availableMinutes: 120,
        devicePolicyOverride: null,
      })),
    });
    const task = (await adapter.createAdHocTask({
      idempotencyKey: crypto.randomUUID(),
      studentId: student.id,
      scheduledDate: "2026-08-18",
      title: "会被改两次",
    })) as { id: string };

    // 先改一次，让数据库版本前进，前端手里的 version 变成陈旧值。
    await adapter.rescheduleTask({
      taskId: task.id,
      expectedVersion: 0,
      targetDate: "2026-08-19",
    });

    // 单机单用户下，陈旧版本只代表界面缓存过期，不是冲突。第二次操作必须直接生效，
    // 而不是弹"任务状态已变化"要用户再确认一遍。
    await expect(
      adapter.rescheduleTask({
        taskId: task.id,
        expectedVersion: 0,
        targetDate: "2026-08-20",
      }),
    ).resolves.toBeNull();
    const rows = await storage.select<{ scheduled_date: string }>(
      `SELECT scheduled_date FROM task_instance WHERE id = $1`,
      [task.id],
    );
    expect(rows[0].scheduled_date).toBe("2026-08-20");
  });

  it("moves an ad-hoc task to another student", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const pattern = {
      effectiveFrom: "2026-08-17",
      days: Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: true,
        availableMinutes: 120,
        devicePolicyOverride: null,
      })),
    };
    const from = (await adapter.createStudent({
      studentCode: "S-FROM",
      name: "甲同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    const to = (await adapter.createStudent({
      studentCode: "S-TO",
      name: "乙同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    await adapter.saveWeeklyPattern(from.id, pattern);
    await adapter.saveWeeklyPattern(to.id, pattern);

    const adHoc = (await adapter.createAdHocTask({
      idempotencyKey: crypto.randomUUID(),
      studentId: from.id,
      scheduledDate: "2026-08-18",
      title: "可以换人的临时任务",
    })) as { id: string };

    await expect(
      adapter.rescheduleTask({
        taskId: adHoc.id,
        expectedVersion: 0,
        targetDate: "2026-08-19",
        targetStudentId: to.id,
      }),
    ).resolves.toBeNull();
    const moved = await storage.select<{
      student_id: string;
      scheduled_date: string;
    }>(`SELECT student_id, scheduled_date FROM task_instance WHERE id = $1`, [
      adHoc.id,
    ]);
    expect(moved[0]).toMatchObject({
      student_id: to.id,
      scheduled_date: "2026-08-19",
    });
  });

  it("refuses to move a track task to another student and keeps the row intact", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const pattern = {
      effectiveFrom: "2026-08-17",
      days: Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: true,
        availableMinutes: 120,
        devicePolicyOverride: null,
      })),
    };
    const from = (await adapter.createStudent({
      studentCode: "S-TRACK-FROM",
      name: "轨道甲同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    const to = (await adapter.createStudent({
      studentCode: "S-TRACK-TO",
      name: "轨道乙同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    await adapter.saveWeeklyPattern(from.id, pattern);
    await adapter.saveWeeklyPattern(to.id, pattern);

    const template = (await adapter.createTemplate({
      templateCode: "TRACK-MOVE",
      name: "跨学生轨道测试",
      subjectCode: "ENGLISH",
      unitLabel: "项",
      defaultRequiresDevice: false,
    })) as { id: string };
    const detail = (await adapter.getTemplateDetail(template.id)) as {
      versions: Array<{ id: string; status: string }>;
    };
    const draft = detail.versions.find(
      (version) => version.status === "DRAFT",
    )!;
    await adapter.replaceVersionItems(draft.id, {
      items: [
        {
          ordinal: 1,
          itemCode: "MOVE-01",
          title: "跨学生任务",
          shortTitle: "跨学生",
          durationMinutes: 30,
          requiresDevice: false,
          contentRef: null,
          instructions: null,
          active: true,
        },
      ],
      changeNote: "cross-student reschedule test",
    });
    await adapter.publishVersion(draft.id);

    const track = (await adapter.mountTrack({
      studentId: from.id,
      idempotencyKey: crypto.randomUUID(),
      templateId: template.id,
      templateVersionId: draft.id,
      startOrdinal: 1,
      endOrdinal: 1,
      startDate: "2026-08-18",
      defaultUnitsPerSession: 1,
      priority: 50,
      schedulingPolicy: "MANUAL",
      createFirstInstance: true,
    })) as { id: string; currentOrdinal: number };
    expect(track.currentOrdinal).toBe(1);

    const tasks = await storage.select<{
      id: string;
      student_id: string;
      track_id: string | null;
      template_version_id: string | null;
      template_item_id: string | null;
      item_ordinal: number | null;
      source_type: string;
      scheduled_date: string;
      version: number;
    }>(
      `SELECT id, student_id, track_id, template_version_id, template_item_id,
              item_ordinal, source_type, scheduled_date, version
         FROM task_instance
        WHERE track_id = $1 AND status = 'PENDING'`,
      [track.id],
    );
    expect(tasks).toHaveLength(1);
    const task = tasks[0];

    await expect(
      adapter.rescheduleTask({
        taskId: task.id,
        expectedVersion: task.version,
        targetDate: "2026-08-19",
        targetStudentId: to.id,
      }),
    ).rejects.toMatchObject({
      code: "TRACK_TASK_CROSS_STUDENT",
    } satisfies Partial<ApiError>);

    const untouched = await storage.select<{
      student_id: string;
      scheduled_date: string;
      source_type: string;
      track_id: string | null;
      item_ordinal: number | null;
      version: number;
    }>(
      `SELECT student_id, scheduled_date, source_type, track_id, item_ordinal,
              version
         FROM task_instance WHERE id = $1`,
      [task.id],
    );
    expect(untouched[0]).toEqual({
      student_id: from.id,
      scheduled_date: "2026-08-18",
      source_type: "TRACK",
      track_id: track.id,
      item_ordinal: 1,
      version: task.version,
    });

    // 同一个学生内改期不受影响：轨道关系原样保留。
    await expect(
      adapter.rescheduleTask({
        taskId: task.id,
        expectedVersion: task.version,
        targetDate: "2026-08-19",
      }),
    ).resolves.toBeNull();
    const moved = await storage.select<{
      student_id: string;
      scheduled_date: string;
      source_type: string;
      track_id: string | null;
      item_ordinal: number | null;
      manual_override: number;
    }>(
      `SELECT student_id, scheduled_date, source_type, track_id, item_ordinal,
              manual_override
         FROM task_instance WHERE id = $1`,
      [task.id],
    );
    expect(moved[0]).toEqual({
      student_id: from.id,
      scheduled_date: "2026-08-19",
      source_type: "TRACK",
      track_id: track.id,
      item_ordinal: 1,
      manual_override: 1,
    });
    expect(
      ((await adapter.getTrack(track.id)) as { currentOrdinal: number })
        .currentOrdinal,
    ).toBe(1);
  });

  it("replays an ad-hoc creation with the same idempotency key as the full task view", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = (await adapter.createStudent({
      studentCode: "S-IDEM",
      name: "幂等同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    const key = crypto.randomUUID();
    const first = (await adapter.createAdHocTask({
      idempotencyKey: key,
      studentId: student.id,
      scheduledDate: "2026-08-18",
      title: "同一个意图",
    })) as {
      id: string;
      studentId: string;
      status: string;
      titleSnapshot: string;
    };
    expect(first.status).toBe("PENDING");

    // 同 key 重放必须返回与首次调用同形状的完整任务视图——此前幂等分支只回
    // {taskId}，持有稳定 key 的调用方重试时会拿到残缺对象、被前端 schema
    // 拒绝。同时不得产生第二行任务。
    const replay = (await adapter.createAdHocTask({
      idempotencyKey: key,
      studentId: student.id,
      scheduledDate: "2026-08-18",
      title: "同一个意图",
    })) as {
      id: string;
      studentId: string;
      status: string;
      titleSnapshot: string;
    };
    expect(replay).toMatchObject({
      id: first.id,
      studentId: student.id,
      status: "PENDING",
      titleSnapshot: "同一个意图",
    });
    const rows = await storage.select<{ count: number }>(
      "SELECT COUNT(*) AS count FROM task_instance",
    );
    expect(rows[0].count).toBe(1);
  });

  it("rejects calendar-impossible dates before anything is written", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = (await adapter.createStudent({
      studentCode: "S-BADDATE",
      name: "坏日期同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    // JS Date 会把 02-31/04-31/非闰年 02-29/13-01/00-10 静默进位成"合法"日期。
    // 修复前这些字符串原样入库：排期/今日永远看不见，但日结的字符串比较
    // scheduled_date <= 业务日 会把它们扫进来。现在必须在写入前拒绝。
    for (const badDate of [
      "2026-02-31",
      "2026-04-31",
      "2026-02-29",
      "2026-13-01",
      "2026-00-10",
    ]) {
      await expect(
        adapter.createAdHocTask({
          idempotencyKey: crypto.randomUUID(),
          studentId: student.id,
          scheduledDate: badDate,
          title: "不可能日期",
        }),
      ).rejects.toMatchObject({
        code: "INVALID_DATE",
      } satisfies Partial<ApiError>);
    }
    const task = (await adapter.createAdHocTask({
      idempotencyKey: crypto.randomUUID(),
      studentId: student.id,
      scheduledDate: "2026-08-18",
      title: "唯一合法任务",
    })) as { id: string };
    await expect(
      adapter.rescheduleTask({
        taskId: task.id,
        expectedVersion: 0,
        targetDate: "2026-02-31",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_DATE",
    } satisfies Partial<ApiError>);
    const rows = await storage.select<{ count: number }>(
      "SELECT COUNT(*) AS count FROM task_instance",
    );
    expect(rows[0].count).toBe(1);
  });

  it("unblocks a BLOCKED task by rescheduling it back to PENDING", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = (await adapter.createStudent({
      studentCode: "S-BLOCK",
      name: "阻塞同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    // 整周关闭：顺延在 90 天内找不到落点，源任务转为 BLOCKED。
    await adapter.saveWeeklyPattern(student.id, {
      effectiveFrom: "2026-08-17",
      days: Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: false,
        availableMinutes: 0,
        devicePolicyOverride: null,
      })),
    });
    const task = (await adapter.createAdHocTask({
      idempotencyKey: crypto.randomUUID(),
      studentId: student.id,
      scheduledDate: "2026-08-18",
      title: "会被阻塞的任务",
    })) as { id: string };
    const carried = (await adapter.carryForwardTask({
      sourceTaskId: task.id,
    })) as { status: string };
    expect(carried.status).toBe("BLOCKED");

    // PRD §7.1：BLOCKED → PENDING 的唯一出口是人工重新安排。改期到任何
    // 日期（这里 2026-08-20 仍是非学习日——改期照做并记 override 原因）
    // 都必须同时解除阻塞，否则任务永远完成不了、也下不了今日列表。
    await expect(
      adapter.rescheduleTask({
        taskId: task.id,
        expectedVersion: 1,
        targetDate: "2026-08-20",
      }),
    ).resolves.toBeNull();
    const rows = await storage.select<{
      status: string;
      scheduled_date: string;
      override_reason: string | null;
    }>(
      "SELECT status, scheduled_date, override_reason FROM task_instance WHERE id = $1",
      [task.id],
    );
    expect(rows[0]).toMatchObject({
      status: "PENDING",
      scheduled_date: "2026-08-20",
    });
    expect(rows[0].override_reason).toContain("手动放置");
  });

  it("clears parent pointers when a task moves to another student", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const pattern = {
      effectiveFrom: "2026-08-17",
      days: Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: true,
        availableMinutes: 120,
        devicePolicyOverride: null,
      })),
    };
    const from = (await adapter.createStudent({
      studentCode: "S-PARENT-FROM",
      name: "父子甲同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    const to = (await adapter.createStudent({
      studentCode: "S-PARENT-TO",
      name: "父子乙同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    await adapter.saveWeeklyPattern(from.id, pattern);
    await adapter.saveWeeklyPattern(to.id, pattern);

    const parent = (await adapter.createAdHocTask({
      idempotencyKey: crypto.randomUUID(),
      studentId: from.id,
      scheduledDate: "2026-08-18",
      title: "甲的主任务",
    })) as { id: string };
    await adapter.createSubTask(parent.id, { title: "甲的子任务" });
    const childRows = await storage.select<{ id: string }>(
      "SELECT id FROM task_instance WHERE parent_task_id = $1",
      [parent.id],
    );
    expect(childRows).toHaveLength(1);
    const child = childRows[0];
    await adapter.linkMainTask(child.id, { linkedParentTaskId: parent.id });
    const linked = await storage.select<{
      linked_parent_task_id: string | null;
    }>("SELECT linked_parent_task_id FROM task_instance WHERE id = $1", [
      child.id,
    ]);
    expect(linked[0].linked_parent_task_id).toBe(parent.id);

    // 跨学生移动与"脱离原 Track"同一条规则：parent_task_id /
    // linked_parent_task_id 一并清空，不能把一个学生的子任务挂到
    // 另一个学生的主任务上。
    await expect(
      adapter.rescheduleTask({
        taskId: child.id,
        expectedVersion: 1,
        targetDate: "2026-08-19",
        targetStudentId: to.id,
      }),
    ).resolves.toBeNull();
    const moved = await storage.select<{
      student_id: string;
      parent_task_id: string | null;
      linked_parent_task_id: string | null;
    }>(
      "SELECT student_id, parent_task_id, linked_parent_task_id FROM task_instance WHERE id = $1",
      [child.id],
    );
    expect(moved[0]).toEqual({
      student_id: to.id,
      parent_task_id: null,
      linked_parent_task_id: null,
    });
  });

  it("leaves the track row untouched when a task is carried forward (DLY-T08)", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = (await adapter.createStudent({
      studentCode: "S-DLY-T08",
      name: "顺延轨道同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    await adapter.saveWeeklyPattern(student.id, {
      effectiveFrom: "2026-08-17",
      days: Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: true,
        availableMinutes: 120,
        devicePolicyOverride: null,
      })),
    });
    const template = (await adapter.createTemplate({
      templateCode: "DLY-T08-TRACK",
      name: "顺延指针轨道",
      subjectCode: "ENGLISH",
      unitLabel: "项",
      defaultRequiresDevice: false,
    })) as { id: string };
    const detail = (await adapter.getTemplateDetail(template.id)) as {
      versions: Array<{ id: string; status: string }>;
    };
    const draft = detail.versions.find(
      (version) => version.status === "DRAFT",
    )!;
    await adapter.replaceVersionItems(draft.id, {
      items: [
        {
          ordinal: 1,
          itemCode: "DLY-T08-01",
          title: "顺延不推指针",
          shortTitle: "不推指针",
          durationMinutes: 30,
          requiresDevice: false,
          contentRef: null,
          instructions: null,
          active: true,
        },
      ],
      changeNote: "DLY-T08 independent case",
    });
    await adapter.publishVersion(draft.id);

    const track = (await adapter.mountTrack({
      studentId: student.id,
      idempotencyKey: crypto.randomUUID(),
      templateId: template.id,
      templateVersionId: draft.id,
      startOrdinal: 1,
      endOrdinal: 1,
      startDate: "2026-08-18",
      defaultUnitsPerSession: 1,
      priority: 50,
      schedulingPolicy: "MANUAL",
      createFirstInstance: true,
    })) as { id: string };
    const before = await storage.select<{
      current_ordinal: number;
      version: number;
    }>(
      "SELECT current_ordinal, version FROM student_task_track WHERE id = $1",
      [track.id],
    );
    const tasks = await storage.select<{ id: string }>(
      "SELECT id FROM task_instance WHERE track_id = $1 AND status = 'PENDING'",
      [track.id],
    );
    expect(tasks).toHaveLength(1);

    const carried = (await adapter.carryForwardTask({
      sourceTaskId: tasks[0].id,
    })) as { status: string; targetTaskId: string | null };
    expect(carried.status).toBe("CARRIED_OVER");
    expect(carried.targetTaskId).not.toBeNull();

    // 零写入断言：顺延事务不但不动 current_ordinal，连行版本都不该变
    // （student_task_track 根本不在顺延的写集合里）。此前 DLY-T08 只有
    // ACC-065 的指针断言作等效证据，这里补独立用例。
    const after = await storage.select<{
      current_ordinal: number;
      version: number;
    }>(
      "SELECT current_ordinal, version FROM student_task_track WHERE id = $1",
      [track.id],
    );
    expect(after[0]).toEqual(before[0]);
  });

  it("stores specific-date overrides and lets them beat the weekly pattern", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = (await adapter.createStudent({
      studentCode: "S-OVR",
      name: "覆盖同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    // Weekdays open, weekend closed.
    await adapter.saveWeeklyPattern(student.id, {
      effectiveFrom: "2026-08-17",
      days: Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: index < 5,
        availableMinutes: index < 5 ? 120 : 0,
        devicePolicyOverride: null,
      })),
    });

    type WeekPlan = {
      weekStart: string;
      days: Array<{
        businessDate: string;
        available: boolean;
        availableMinutes: number;
      }>;
    };

    // ACC-015: seed the week from the base pattern, then override two specific
    // dates: close an open Wednesday and open a closed Saturday.
    const seeded = (await adapter.saveWeekPlan(student.id, "2026-08-17", {
      sourceType: "BASE_PATTERN",
    })) as WeekPlan;
    expect(seeded.days).toHaveLength(7);
    expect(
      seeded.days.map((d) => [d.businessDate, d.available] as const),
    ).toEqual([
      ["2026-08-17", true],
      ["2026-08-18", true],
      ["2026-08-19", true],
      ["2026-08-20", true],
      ["2026-08-21", true],
      ["2026-08-22", false],
      ["2026-08-23", false],
    ]);

    const edited = seeded.days.map((day) => {
      if (day.businessDate === "2026-08-19") {
        return { ...day, available: false, availableMinutes: 0 };
      }
      if (day.businessDate === "2026-08-22") {
        return { ...day, available: true, availableMinutes: 90 };
      }
      return day;
    });
    await adapter.saveWeekPlan(student.id, "2026-08-17", {
      sourceType: "MANUAL",
      days: edited,
    });

    const reloaded = (await adapter.getWeekPlan(
      student.id,
      "2026-08-17",
    )) as WeekPlan;
    expect(
      reloaded.days.find((d) => d.businessDate === "2026-08-19"),
    ).toMatchObject({ available: false, availableMinutes: 0 });
    expect(
      reloaded.days.find((d) => d.businessDate === "2026-08-22"),
    ).toMatchObject({ available: true, availableMinutes: 90 });

    // ACC-062: the override wins over the weekly pattern in the schedule
    // projection the calendar reads, in both directions.
    const week = (await adapter.getSchedule(student.id, {
      from: "2026-08-19",
      view: "week",
    })) as { days: Array<{ date: string; available: boolean }> };
    const byDate = new Map(week.days.map((d) => [d.date, d.available]));
    expect(byDate.get("2026-08-19")).toBe(false);
    expect(byDate.get("2026-08-22")).toBe(true);
    expect(byDate.get("2026-08-20")).toBe(true);
    expect(byDate.get("2026-08-23")).toBe(false);
  });

  it("scopes each schedule view to the window that view actually shows", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = (await adapter.createStudent({
      studentCode: "S-VIEW",
      name: "视图同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };

    type ScheduleWindow = {
      view: string;
      fromDate: string;
      toDate: string;
      days: Array<{ date: string }>;
    };

    // ACC-050: the day view is exactly one day. Returning a week here made the
    // day view render seven cards.
    const day = (await adapter.getSchedule(student.id, {
      from: "2026-08-20",
      view: "day",
    })) as ScheduleWindow;
    expect(day).toMatchObject({
      view: "day",
      fromDate: "2026-08-20",
      toDate: "2026-08-20",
    });
    expect(day.days.map((d) => d.date)).toEqual(["2026-08-20"]);

    // ACC-051: the week view is the Monday-first ISO week containing the
    // anchor, not a rolling seven days starting at the anchor. 2026-08-20 is a
    // Thursday, so the window must start on Monday 2026-08-17.
    const week = (await adapter.getSchedule(student.id, {
      from: "2026-08-20",
      view: "week",
    })) as ScheduleWindow;
    expect(week).toMatchObject({
      view: "week",
      fromDate: "2026-08-17",
      toDate: "2026-08-23",
    });
    expect(week.days).toHaveLength(7);

    // ACC-052: the month view covers the whole Monday-first six-week grid the
    // page draws, so every visible cell is backed by a real day instead of a
    // placeholder. 2026-08-01 is a Saturday, so the grid starts Monday
    // 2026-07-27 and runs 42 days to 2026-09-06.
    const month = (await adapter.getSchedule(student.id, {
      from: "2026-08-20",
      view: "month",
    })) as ScheduleWindow;
    expect(month).toMatchObject({
      view: "month",
      fromDate: "2026-07-27",
      toDate: "2026-09-06",
    });
    expect(month.days).toHaveLength(42);

    // An explicit range still wins over the view default.
    const explicit = (await adapter.getSchedule(student.id, {
      from: "2026-08-20",
      to: "2026-08-22",
      view: "month",
    })) as ScheduleWindow;
    expect(explicit.days.map((d) => d.date)).toEqual([
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
    ]);
  });

  it("persists local task data across a database reopen", async () => {
    const directory = mkdtempSync(join(tmpdir(), "teaching-assistant-sqlite-"));
    const databasePath = join(directory, "assistant.db");
    let firstStorage: NodeSqliteStorage | undefined;
    let secondStorage: NodeSqliteStorage | undefined;

    try {
      firstStorage = new NodeSqliteStorage(databasePath);
      const firstAdapter = new SqliteLocalDataAdapter(firstStorage);
      const created = (await firstAdapter.createStudent({
        studentCode: "REOPEN-001",
        name: "重启后仍在",
        defaultDevicePolicy: "ALLOWED",
      })) as { id: string };
      firstStorage.database.close();
      firstStorage = undefined;

      secondStorage = new NodeSqliteStorage(databasePath, false);
      const secondAdapter = new SqliteLocalDataAdapter(secondStorage);
      await expect(secondAdapter.getStudent(created.id)).resolves.toMatchObject(
        {
          id: created.id,
          studentCode: "REOPEN-001",
          name: "重启后仍在",
        },
      );
    } finally {
      firstStorage?.database.close();
      secondStorage?.database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("previews and executes an XLSX import entirely in local SQLite", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["数学卷", "英语卷"],
      ["1P/2/30mins", "每篇20分钟"],
      ["数学题 1", "英语题 1"],
      ["数学题 2", "英语题 2"],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "作业进度目录");
    const generated: unknown = XLSX.write(workbook, {
      type: "array",
      bookType: "xlsx",
    });
    const generatedBytes =
      generated instanceof ArrayBuffer
        ? new Uint8Array(generated)
        : generated instanceof Uint8Array
          ? generated
          : new Uint8Array();
    const bytes = new Uint8Array(generatedBytes.byteLength);
    bytes.set(generatedBytes);
    const file = new File([bytes.buffer], "local-import.xlsx");

    const preview = (await adapter.previewTemplateImport(file)) as {
      jobId: string;
      fileName: string;
      columns: Array<{
        columnLabel: string;
        parsedUnit: string | null;
        parsedDurationMinutes: number | null;
        nonEmptyCount: number;
      }>;
      validColumns: number;
    };
    expect(preview).toMatchObject({
      fileName: "local-import.xlsx",
      validColumns: 2,
    });
    expect(preview.columns).toEqual([
      expect.objectContaining({
        columnLabel: "数学卷",
        parsedUnit: "P",
        parsedDurationMinutes: 30,
        nonEmptyCount: 2,
      }),
      expect.objectContaining({
        columnLabel: "英语卷",
        parsedUnit: "篇",
        parsedDurationMinutes: 20,
        nonEmptyCount: 2,
      }),
    ]);

    const result = (await adapter.executeTemplateImport(preview.jobId, [
      {
        columnLabel: "数学卷",
        action: "CREATE",
        templateCode: "MATH-LOCAL",
        templateName: "本地数学卷",
        subjectCode: "MATH",
        defaultRequiresDevice: false,
      },
      {
        columnLabel: "不存在的列",
        action: "CREATE",
        templateCode: "MISSING",
        templateName: "不存在",
        subjectCode: "OTHER",
      },
    ])) as {
      status: string;
      succeededColumns: number;
      failedColumns: number;
      errors: string[];
    };
    expect(result).toMatchObject({
      status: "PARTIAL",
      succeededColumns: 1,
      failedColumns: 1,
    });
    expect(result.errors[0]).toContain("不存在的列");

    const templates = (await adapter.listTemplates("本地数学卷")) as {
      items: Array<{ templateCode: string; name: string; status: string }>;
    };
    expect(templates.items).toEqual([
      expect.objectContaining({
        templateCode: "MATH-LOCAL",
        name: "本地数学卷",
        status: "ACTIVE",
      }),
    ]);
    await expect(adapter.getImportErrors(preview.jobId)).resolves.toMatchObject(
      {
        total: 1,
        errors: [
          expect.objectContaining({
            columnName: "不存在的列",
            errorCode: "IMPORT_COLUMN_NOT_FOUND",
          }),
        ],
      },
    );
  });

  it("creates a weekly pattern from scratch when the student has none", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = (await adapter.createStudent({
      studentCode: "S-PATTERN-NEW",
      name: "常规周新同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };

    // 没有常规周时读取必须 404——资料页"手动创建"空状态依赖这个信号。
    await expect(adapter.getWeeklyPattern(student.id)).rejects.toMatchObject({
      code: "WEEKLY_PATTERN_NOT_FOUND",
    } satisfies Partial<ApiError>);

    const days = Array.from({ length: 7 }, (_, index) => ({
      dayOfWeek: index + 1,
      available: index < 5,
      availableMinutes: index < 5 ? 90 : 0,
      devicePolicyOverride: null,
    }));
    const created = (await adapter.saveWeeklyPattern(student.id, {
      effectiveFrom: "2026-08-17",
      days,
    })) as { status: string; days: Array<Record<string, unknown>> };
    expect(created.status).toBe("ACTIVE");
    expect(created.days).toHaveLength(7);

    // 创建后再次读取必须是同一个 ACTIVE 常规周，而不是继续 404。
    await expect(adapter.getWeeklyPattern(student.id)).resolves.toMatchObject({
      studentId: student.id,
      status: "ACTIVE",
      effectiveFrom: "2026-08-17",
      days,
    });
  });

  it("deletes a student with every dependent row and keeps other students intact", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const pattern = {
      effectiveFrom: "2026-08-17",
      days: Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: true,
        availableMinutes: 120,
        devicePolicyOverride: null,
      })),
    };
    const target = (await adapter.createStudent({
      studentCode: "S-DEL-T",
      name: "待删除同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    const other = (await adapter.createStudent({
      studentCode: "S-DEL-O",
      name: "保留同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    await adapter.saveWeeklyPattern(target.id, pattern);
    await adapter.saveWeeklyPattern(other.id, pattern);
    await adapter.saveWeekPlan(target.id, "2026-08-17", {
      sourceType: "BASE_PATTERN",
      replaceDraft: false,
    });

    const template = (await adapter.createTemplate({
      templateCode: "DEL-TRACK",
      name: "删除用模板",
      subjectCode: "ENGLISH",
      unitLabel: "项",
      defaultRequiresDevice: false,
    })) as { id: string };
    const detail = (await adapter.getTemplateDetail(template.id)) as {
      versions: Array<{ id: string; status: string }>;
    };
    const draft = detail.versions.find(
      (version) => version.status === "DRAFT",
    )!;
    await adapter.replaceVersionItems(draft.id, {
      items: [
        {
          ordinal: 1,
          itemCode: "DEL-01",
          title: "删除用单元",
          shortTitle: "删除单元",
          durationMinutes: 30,
          requiresDevice: false,
          contentRef: null,
          instructions: null,
          active: true,
        },
      ],
    });
    await adapter.publishVersion(draft.id);
    await adapter.mountTrack({
      studentId: target.id,
      idempotencyKey: crypto.randomUUID(),
      templateId: template.id,
      templateVersionId: draft.id,
      startOrdinal: 1,
      endOrdinal: 1,
      startDate: "2026-08-17",
      defaultUnitsPerSession: 1,
      schedulingPolicy: "MANUAL",
      createFirstInstance: true,
    });

    const targetTask = (await adapter.createAdHocTask({
      idempotencyKey: crypto.randomUUID(),
      studentId: target.id,
      scheduledDate: "2026-08-18",
      title: "待删除学生的任务",
    })) as { id: string };
    const otherTask = (await adapter.createAdHocTask({
      idempotencyKey: crypto.randomUUID(),
      studentId: other.id,
      scheduledDate: "2026-08-18",
      title: "保留学生的任务",
    })) as { id: string };
    // linkMainTask 允许跨学生引用：删除 target 后这条引用必须被置空，
    // 而不是让外键把整批删除卡死。
    await adapter.linkMainTask(otherTask.id, {
      linkedParentTaskId: targetTask.id,
    });
    await adapter.saveVocabularyBatch(target.id, { rawText: "apple banana" });

    await adapter.deleteStudent(target.id);

    await expect(adapter.getStudent(target.id)).rejects.toMatchObject({
      code: "STUDENT_NOT_FOUND",
    } satisfies Partial<ApiError>);
    const counts = await storage.select<{
      tasks: number;
      vocabulary: number;
      patterns: number;
      pattern_days: number;
      overrides: number;
      tracks: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM task_instance WHERE student_id = $1) AS tasks,
         (SELECT COUNT(*) FROM vocabulary_entry WHERE student_id = $1) AS vocabulary,
         (SELECT COUNT(*) FROM student_weekly_pattern WHERE student_id = $1) AS patterns,
         (SELECT COUNT(*) FROM student_weekly_pattern_day WHERE pattern_id NOT IN
            (SELECT id FROM student_weekly_pattern)) AS pattern_days,
         (SELECT COUNT(*) FROM student_date_override WHERE student_id = $1) AS overrides,
         (SELECT COUNT(*) FROM student_task_track WHERE student_id = $1) AS tracks`,
      [target.id],
    );
    expect(counts[0]).toMatchObject({
      tasks: 0,
      vocabulary: 0,
      patterns: 0,
      pattern_days: 0,
      overrides: 0,
      tracks: 0,
    });

    // 另一个学生的数据原样保留；指向被删学生的关联指针被清空而不是连带删除。
    await expect(adapter.getStudent(other.id)).resolves.toMatchObject({
      id: other.id,
      studentCode: "S-DEL-O",
    });
    await expect(adapter.getWeeklyPattern(other.id)).resolves.toMatchObject({
      studentId: other.id,
      status: "ACTIVE",
    });
    const keptTaskRows = await storage.select<{
      linked_parent_task_id: string | null;
    }>("SELECT linked_parent_task_id FROM task_instance WHERE id = $1", [
      otherTask.id,
    ]);
    expect(keptTaskRows[0].linked_parent_task_id).toBeNull();
  });

  // 用户反馈：新建模板表单必填项过多，模板编码/学科编码应当由后端静默生成。
  it("creates templates without code/subject by generating them silently", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);

    const first = (await adapter.createTemplate({
      name: "一天一句长难句",
      unitLabel: "句",
      defaultRequiresDevice: false,
    })) as { id: string; templateCode: string; subjectCode: string };
    expect(first.templateCode).toBe("T001");
    expect(first.subjectCode).toBe("OTHER");

    const second = (await adapter.createTemplate({
      name: "数学错题重做",
      unitLabel: "题",
      defaultRequiresDevice: false,
    })) as { templateCode: string };
    expect(second.templateCode).toBe("T002");

    // 自带编码的调用方（Excel 导入按列名给编码）不受静默生成影响。
    const provided = (await adapter.createTemplate({
      templateCode: "PAPER",
      name: "密卷",
      subjectCode: "ENGLISH",
      unitLabel: "套",
      defaultRequiresDevice: false,
    })) as { templateCode: string; subjectCode: string };
    expect(provided.templateCode).toBe("PAPER");
    expect(provided.subjectCode).toBe("ENGLISH");
  });

  // 用户反馈：完成“一天一句长难句day1”后点箭头，希望下一天变成 day2；
  // 当天已有 day1~day3 时，向下复制要接出接下来的序号（day4~day6）。
  it("creates the next series task with the trailing number advanced past the series max", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = (await adapter.createStudent({
      studentCode: "S-SERIES",
      name: "系列同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };

    const day1 = (await adapter.createAdHocTask({
      studentId: student.id,
      scheduledDate: "2026-09-01",
      title: "一天一句长难句day1",
      durationMinutes: 15,
      idempotencyKey: crypto.randomUUID(),
    })) as { id: string };

    const next = (await adapter.createNextSeriesTask(day1.id)) as {
      titleSnapshot: string;
      scheduledDate: string;
      status: string;
      sourceType: string;
      studentId: string;
      durationMinutesSnapshot: number | null;
    };
    expect(next).toMatchObject({
      titleSnapshot: "一天一句长难句day2",
      scheduledDate: "2026-09-02",
      status: "PENDING",
      sourceType: "AD_HOC",
      studentId: student.id,
      durationMinutesSnapshot: 15,
    });

    // 系列序号接在全局队尾：当天补上 day2/day3 后再点 day1 的箭头，
    // 得到的是 day4 而不是已存在的 day2 —— 三个任务逐行点下去就是
    // day4~day6，正好回答“向下复制变成接下来的序号”。
    await adapter.createAdHocTask({
      studentId: student.id,
      scheduledDate: "2026-09-01",
      title: "一天一句长难句day2",
      idempotencyKey: crypto.randomUUID(),
    });
    await adapter.createAdHocTask({
      studentId: student.id,
      scheduledDate: "2026-09-01",
      title: "一天一句长难句day3",
      idempotencyKey: crypto.randomUUID(),
    });
    const tail = (await adapter.createNextSeriesTask(day1.id)) as {
      titleSnapshot: string;
    };
    expect(tail.titleSnapshot).toBe("一天一句长难句day4");

    // 另一个学生的同名系列互不影响，各自从自己的最大序号接续。
    const other = (await adapter.createStudent({
      studentCode: "S-SERIES-B",
      name: "隔壁同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    const otherTask = (await adapter.createAdHocTask({
      studentId: other.id,
      scheduledDate: "2026-09-02",
      title: "一天一句长难句day1",
      idempotencyKey: crypto.randomUUID(),
    })) as { id: string };
    const otherNext = (await adapter.createNextSeriesTask(otherTask.id)) as {
      titleSnapshot: string;
    };
    expect(otherNext.titleSnapshot).toBe("一天一句长难句day2");

    // “第N天”形式：数字后带“天”字，生成时保留后缀。
    const countdown = (await adapter.createAdHocTask({
      studentId: student.id,
      scheduledDate: "2026-09-03",
      title: "口译 第2天",
      idempotencyKey: crypto.randomUUID(),
    })) as { id: string };
    const countdownNext = (await adapter.createNextSeriesTask(
      countdown.id,
    )) as { titleSnapshot: string; scheduledDate: string };
    expect(countdownNext).toMatchObject({
      titleSnapshot: "口译 第3天",
      scheduledDate: "2026-09-04",
    });

    // 短标题是同系列编号形式时同步 +1；主标题“真题2024”接成“真题2025”。
    const exam = (await adapter.createAdHocTask({
      studentId: student.id,
      scheduledDate: "2026-09-03",
      title: "真题2024",
      idempotencyKey: crypto.randomUUID(),
    })) as { id: string };
    await storage.execute(
      "UPDATE task_instance SET short_title_snapshot = '真题24' WHERE id = $1",
      [exam.id],
    );
    const examNext = (await adapter.createNextSeriesTask(exam.id)) as {
      titleSnapshot: string;
      shortTitleSnapshot: string | null;
    };
    expect(examNext.titleSnapshot).toBe("真题2025");
    expect(examNext.shortTitleSnapshot).toBe("真题25");

    // 标题没有尾部数字：退化为普通复制。S-SERIES 没有周模式，可学习性回落到
    // DEFAULT（每天可学），所以下一个可学习日就是下一个日历日。
    const plain = (await adapter.createAdHocTask({
      studentId: student.id,
      scheduledDate: "2026-09-03",
      title: "背单词",
      idempotencyKey: crypto.randomUUID(),
    })) as { id: string };
    const plainNext = (await adapter.createNextSeriesTask(plain.id)) as {
      titleSnapshot: string;
      scheduledDate: string;
    };
    expect(plainNext.titleSnapshot).toBe("背单词");
    expect(plainNext.scheduledDate).toBe("2026-09-04");
  });

  // §6：「继续这个系列」是长期任务的手动版本，排期规则必须和 SEQUENCE 轨道一致。
  it("schedules the next series task on the next study day, not the next calendar day", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = await setupSequenceStudent(adapter, "S-SERIES-WEEKEND");

    const friday = (await adapter.createAdHocTask({
      studentId: student.id,
      scheduledDate: "2026-09-04",
      title: "一天一句长难句day1",
      idempotencyKey: crypto.randomUUID(),
    })) as { id: string };
    const next = (await adapter.createNextSeriesTask(friday.id)) as {
      titleSnapshot: string;
      scheduledDate: string;
    };
    expect(next).toMatchObject({
      titleSnapshot: "一天一句长难句day2",
      scheduledDate: "2026-09-07",
    });

    // 单日覆盖优先于周模式：周一设为不可学后，从周五接排落到周二。顺带守住取
    // 日历的时间窗——窗口从源任务当天起算，收窄它就会漏掉这条覆盖。
    const weekDates = Array.from({ length: 7 }, (_, index) =>
      new Date(Date.UTC(2026, 8, 7 + index)).toISOString().slice(0, 10),
    );
    await adapter.saveWeekPlan(student.id, "2026-09-07", {
      sourceType: "MANUAL",
      days: weekDates.map((date) => ({
        businessDate: date,
        available: date !== "2026-09-07",
        availableMinutes: date === "2026-09-07" ? 0 : 120,
        devicePolicyOverride: null,
        note: null,
      })),
    });
    const afterOverride = (await adapter.createNextSeriesTask(friday.id)) as {
      scheduledDate: string;
    };
    expect(afterOverride.scheduledDate).toBe("2026-09-08");
  });

  // -------------------------------------------------------------------------
  // 长期任务（SEQUENCE track）：定义 → 挂载 → 完成推进 → 顺延保序号 → 转换。
  // -------------------------------------------------------------------------

  /** 序列场景统一夹具：周一~周五可学习（2026-08-17 那周），周末不可学。 */
  async function setupSequenceStudent(
    adapter: SqliteLocalDataAdapter,
    studentCode: string,
  ): Promise<{ id: string }> {
    const student = (await adapter.createStudent({
      studentCode,
      name: "序列同学",
      defaultDevicePolicy: "ALLOWED",
    })) as { id: string };
    await adapter.saveWeeklyPattern(student.id, {
      effectiveFrom: "2026-08-17",
      days: Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: index < 5,
        availableMinutes: index < 5 ? 120 : 0,
        devicePolicyOverride: null,
      })),
    });
    return student;
  }

  function pendingTasks(
    database: NonNullable<typeof storage>,
    trackId: string,
  ) {
    return database.select<{
      id: string;
      title: string;
      scheduled_date: string | null;
      item_ordinal: number | null;
    }>(
      `SELECT id, title_snapshot AS title, scheduled_date, item_ordinal
       FROM task_instance WHERE track_id = $1 AND status = 'PENDING'
       ORDER BY item_ordinal`,
      [trackId],
    );
  }

  it("replays commits made after the first idempotency read and before validation", async () => {
    const racingStorage = new InterleavedSqliteStorage();
    storage = racingStorage;
    const adapter = new SqliteLocalDataAdapter(racingStorage);
    const student = await setupSequenceStudent(adapter, "S920");

    async function assertCommittedReplay(command: () => Promise<unknown>) {
      let committed: unknown;
      racingStorage.afterIdempotencyMiss = async () => {
        committed = await command();
      };
      const replay = await command();
      expect(replay).toEqual(committed);
      return replay;
    }

    const createInput = {
      studentId: student.id,
      title: "并发练习 Day 4",
      scheduledDate: "2026-08-17",
      idempotencyKey: crypto.randomUUID(),
    };
    const task = (await assertCommittedReplay(() =>
      adapter.createAdHocTask(createInput),
    )) as { id: string };

    const convertInput = { idempotencyKey: crypto.randomUUID() };
    const converted = (await assertCommittedReplay(() =>
      adapter.convertTaskToLongTask(task.id, convertInput),
    )) as { trackId: string; track: { currentOrdinal: number } };
    expect(converted.track.currentOrdinal).toBe(4);

    const definition = (await adapter.createLongTask({
      sampleTitle: "并发挂载 Day 1",
    })) as { id: string };
    const mountInput = {
      studentId: student.id,
      longTaskId: definition.id,
      anchorDate: "2026-08-17",
      idempotencyKey: crypto.randomUUID(),
    };
    const mounted = (await assertCommittedReplay(() =>
      adapter.mountLongTask(mountInput),
    )) as { id: string; version: number };

    const [first] = await pendingTasks(racingStorage, mounted.id);
    await adapter.deleteTask(first.id, { expectedVersion: 0 });
    const resumeInput = {
      expectedVersion: mounted.version,
      candidateDate: "2026-08-18",
      idempotencyKey: crypto.randomUUID(),
    };
    await assertCommittedReplay(() =>
      adapter.resumeSequenceTrack(mounted.id, resumeInput),
    );
    expect(await pendingTasks(racingStorage, mounted.id)).toHaveLength(1);

    const template = (await adapter.createTemplate({
      templateCode: "CONCURRENT",
      name: "并发模板",
      subjectCode: "ENGLISH",
      unitLabel: "项",
    })) as { id: string };
    const detail = (await adapter.getTemplateDetail(template.id)) as {
      versions: Array<{ id: string; status: string }>;
    };
    const version = detail.versions.find((item) => item.status === "DRAFT")!;
    await adapter.replaceVersionItems(version.id, {
      items: [{ ordinal: 1, itemCode: "C1", title: "练习 1", active: true }],
    });
    await adapter.publishVersion(version.id);
    const trackInput = {
      studentId: student.id,
      templateId: template.id,
      templateVersionId: version.id,
      startOrdinal: 1,
      endOrdinal: 1,
      startDate: "2026-08-17",
      createFirstInstance: true,
      idempotencyKey: crypto.randomUUID(),
    };
    await assertCommittedReplay(() => adapter.mountTrack(trackInput));

    const counts = await racingStorage.select<{
      tracks: number;
      tasks: number;
    }>(
      `SELECT (SELECT COUNT(*) FROM student_task_track) AS tracks,
              (SELECT COUNT(*) FROM task_instance) AS tasks`,
    );
    expect(counts).toEqual([{ tracks: 3, tasks: 3 }]);
  });

  it("creates a sequence definition, mounts it, and advances on completion", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = await setupSequenceStudent(adapter, "S900");

    const createKey = crypto.randomUUID();
    const [definition, replayedDefinition] = (await Promise.all([
      adapter.createLongTask({
        sampleTitle: "一天一句长难句 Day 1",
        idempotencyKey: createKey,
      }),
      adapter.createLongTask({
        sampleTitle: "一天一句长难句 Day 1",
        idempotencyKey: createKey,
      }),
    ])) as Array<{
      id: string;
      name: string;
      titlePattern: string;
      defaultStartOrdinal: number;
      endOrdinal: number | null;
      status: string;
      activeTrackCount: number;
    }>;
    expect(definition).toMatchObject({
      name: "一天一句长难句",
      titlePattern: "一天一句长难句 Day {n}",
      defaultStartOrdinal: 1,
      endOrdinal: null,
      status: "ACTIVE",
      activeTrackCount: 0,
    });
    expect(replayedDefinition).toMatchObject({ id: definition.id });
    // SEQUENCE 定义不走 Draft/Version/Publish 机制（AC-LT-014 的数据面）。
    const versionRows = await storage.select<{ count: number }>(
      `SELECT COUNT(*) AS count FROM task_template_version WHERE template_id = $1`,
      [definition.id],
    );
    expect(versionRows[0].count).toBe(0);

    const mountKey = crypto.randomUUID();
    const [track, concurrentMountReplay] = (await Promise.all([
      adapter.mountLongTask({
        studentId: student.id,
        longTaskId: definition.id,
        anchorDate: "2026-08-17",
        idempotencyKey: mountKey,
      }),
      adapter.mountLongTask({
        studentId: student.id,
        longTaskId: definition.id,
        anchorDate: "2026-08-17",
        idempotencyKey: mountKey,
      }),
    ])) as Array<{
      id: string;
      generationMode: string;
      currentOrdinal: number;
      endOrdinal: number | null;
      definitionName: string | null;
      titlePatternSnapshot: string | null;
      progress: { percent: number | null; totalUnits: number | null };
    }>;
    expect(concurrentMountReplay.id).toBe(track.id);
    expect(track).toMatchObject({
      generationMode: "SEQUENCE",
      currentOrdinal: 1,
      endOrdinal: null,
      definitionName: "一天一句长难句",
      titlePatternSnapshot: "一天一句长难句 Day {n}",
    });
    // 开放型没有百分比（AC-LT-005 的视图面）。
    expect(track.progress.percent).toBeNull();
    expect(track.progress.totalUnits).toBeNull();

    // 挂载只生成 Day 1，不预生成 Day 2~N（AC-LT-002）。
    expect(await pendingTasks(storage, track.id)).toMatchObject([
      { title: "一天一句长难句 Day 1", scheduled_date: "2026-08-17" },
    ]);

    // 完成即出现 Day 2，无需人工排期（AC-LT-003）。
    const [day1] = await pendingTasks(storage, track.id);
    await adapter.completeTask({
      taskId: day1.id,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      (await adapter.getTrack(track.id)) as { currentOrdinal: number },
    ).toMatchObject({ currentOrdinal: 2 });
    expect(await pendingTasks(storage, track.id)).toMatchObject([
      {
        title: "一天一句长难句 Day 2",
        scheduled_date: "2026-08-18",
        item_ordinal: 2,
      },
    ]);

    // 重复挂载被拒绝；幂等键重放返回同一条轨道。
    await expect(
      adapter.mountLongTask({
        studentId: student.id,
        longTaskId: definition.id,
        anchorDate: "2026-08-18",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "LONG_TASK_ALREADY_MOUNTED",
    } satisfies Partial<ApiError>);
    // 幂等重放：同 key 再次挂载返回同一条轨道，不产生第二条。
    const mounted = await adapter.mountLongTask({
      studentId: student.id,
      longTaskId: definition.id,
      anchorDate: "2026-08-17",
      idempotencyKey: mountKey,
    });
    expect(mounted).toMatchObject({ id: track.id });
  });

  it("schedules the next sequence item on the next available study day", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = await setupSequenceStudent(adapter, "S901");

    const definition = (await adapter.createLongTask({
      sampleTitle: "一天一句长难句 Day 1",
    })) as { id: string };
    const track = (await adapter.mountLongTask({
      studentId: student.id,
      longTaskId: definition.id,
      anchorDate: "2026-08-21", // 周五
      idempotencyKey: crypto.randomUUID(),
    })) as { id: string };
    expect(await pendingTasks(storage, track.id)).toMatchObject([
      { title: "一天一句长难句 Day 1", scheduled_date: "2026-08-21" },
    ]);

    // 周五完成：Day 2 落到下周一（08-24），不是机械 +1 天（AC-LT-003）。
    const [day1] = await pendingTasks(storage, track.id);
    await adapter.completeTask({
      taskId: day1.id,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(await pendingTasks(storage, track.id)).toMatchObject([
      { title: "一天一句长难句 Day 2", scheduled_date: "2026-08-24" },
    ]);
  });

  it("completes the task but reports a broken chain when no study day fits", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = await setupSequenceStudent(adapter, "S906");

    const definition = (await adapter.createLongTask({
      sampleTitle: "一天一句长难句 Day 1",
    })) as { id: string };
    const track = (await adapter.mountLongTask({
      studentId: student.id,
      longTaskId: definition.id,
      anchorDate: "2026-08-17",
      idempotencyKey: crypto.randomUUID(),
    })) as { id: string };
    const [day1] = await pendingTasks(storage, track.id);

    // 整周停学：Day 2 在 90 天内排不到日子。
    await adapter.saveWeeklyPattern(student.id, {
      effectiveFrom: "2026-08-18",
      days: Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: false,
        availableMinutes: 0,
        devicePolicyOverride: null,
      })),
    });

    const result = (await adapter.completeTask({
      taskId: day1.id,
      idempotencyKey: crypto.randomUUID(),
    })) as { status: string; chainWarning: string | null };
    // 任务照样完成、指针照样推进，但断点必须说出来而不是静默消失。
    expect(result.status).toBe("COMPLETED");
    expect(result.chainWarning).toContain("90 天");
    expect(await pendingTasks(storage, track.id)).toHaveLength(0);
    expect(
      (await adapter.getTrack(track.id)) as {
        status: string;
        currentOrdinal: number;
        warnings: string[];
      },
    ).toMatchObject({
      status: "ACTIVE",
      currentOrdinal: 2,
      warnings: ["没有待完成任务，下一项未排期"],
    });

    await adapter.saveWeeklyPattern(student.id, {
      effectiveFrom: "2026-08-18",
      days: Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index + 1,
        available: true,
        availableMinutes: 60,
        devicePolicyOverride: "ALLOWED",
      })),
    });
    const stalledTrack = (await adapter.getTrack(track.id)) as {
      version: number;
    };
    const resumed = (await adapter.resumeSequenceTrack(track.id, {
      expectedVersion: stalledTrack.version,
      candidateDate: "2026-08-18",
      idempotencyKey: crypto.randomUUID(),
    })) as { warnings: string[] };
    expect(resumed.warnings).toEqual([]);
    expect(await pendingTasks(storage, track.id)).toMatchObject([
      {
        title: "一天一句长难句 Day 2",
        scheduled_date: "2026-08-18",
        item_ordinal: 2,
      },
    ]);

    // 删除已经完成的历史项只删历史，不得把指针退回并重建 Day 1。
    const completedDay1 = await storage.select<{ version: number }>(
      "SELECT version FROM task_instance WHERE id = $1",
      [day1.id],
    );
    await adapter.deleteTask(day1.id, {
      expectedVersion: completedDay1[0].version,
    });
    expect(
      (await adapter.getTrack(track.id)) as { currentOrdinal: number },
    ).toMatchObject({ currentOrdinal: 2 });
    expect(await pendingTasks(storage, track.id)).toMatchObject([
      { title: "一天一句长难句 Day 2", item_ordinal: 2 },
    ]);
  });

  it("keeps the ordinal through carry-over without advancing the track", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = await setupSequenceStudent(adapter, "S902");

    const definition = (await adapter.createLongTask({
      sampleTitle: "一天一句长难句 Day 1",
    })) as { id: string };
    const track = (await adapter.mountLongTask({
      studentId: student.id,
      longTaskId: definition.id,
      anchorDate: "2026-08-17",
      idempotencyKey: crypto.randomUUID(),
    })) as { id: string };
    const [day1] = await pendingTasks(storage, track.id);

    // 未完成顺延：仍然是 Day 1，绝不产生 Day 2（AC-LT-004）。
    const carried = (await adapter.carryForwardTask({
      sourceTaskId: day1.id,
      reason: "未完成",
    })) as { targetTaskId: string; targetDate: string };
    expect(carried.targetDate).toBe("2026-08-18");
    expect(
      (await adapter.getTrack(track.id)) as { currentOrdinal: number },
    ).toMatchObject({ currentOrdinal: 1 });
    expect(await pendingTasks(storage, track.id)).toMatchObject([
      { title: "一天一句长难句 Day 1", scheduled_date: "2026-08-18" },
    ]);
  });

  it("never completes an open-ended track regardless of progress", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = await setupSequenceStudent(adapter, "S903");

    const definition = (await adapter.createLongTask({
      sampleTitle: "一天一句长难句 Day 1",
    })) as { id: string };
    const track = (await adapter.mountLongTask({
      studentId: student.id,
      longTaskId: definition.id,
      anchorDate: "2026-08-17",
      idempotencyKey: crypto.randomUUID(),
    })) as { id: string };

    for (let day = 0; day < 3; day += 1) {
      const [current] = await pendingTasks(storage, track.id);
      await adapter.completeTask({
        taskId: current.id,
        idempotencyKey: crypto.randomUUID(),
      });
    }
    // 连续完成三项后仍 ACTIVE（AC-LT-005）。
    expect(
      (await adapter.getTrack(track.id)) as {
        status: string;
        currentOrdinal: number;
      },
    ).toMatchObject({ status: "ACTIVE", currentOrdinal: 4 });
  });

  it("completes a finite sequence track at the last ordinal", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = await setupSequenceStudent(adapter, "S904");

    await expect(
      adapter.createLongTask({ sampleTitle: "密卷5", endOrdinal: 3 }),
    ).rejects.toMatchObject({
      code: "LONG_TASK_END_BEFORE_START",
    } satisfies Partial<ApiError>);

    const definition = (await adapter.createLongTask({
      sampleTitle: "密卷1",
      endOrdinal: 2,
    })) as { id: string; titlePattern: string; endOrdinal: number | null };
    expect(definition).toMatchObject({
      titlePattern: "密卷{n}",
      endOrdinal: 2,
    });
    const track = (await adapter.mountLongTask({
      studentId: student.id,
      longTaskId: definition.id,
      anchorDate: "2026-08-17",
      idempotencyKey: crypto.randomUUID(),
    })) as { id: string };
    expect(await pendingTasks(storage, track.id)).toMatchObject([
      { title: "密卷1", scheduled_date: "2026-08-17" },
    ]);

    const [first] = await pendingTasks(storage, track.id);
    await adapter.completeTask({
      taskId: first.id,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      (await adapter.getTrack(track.id)) as { status: string },
    ).toMatchObject({ status: "ACTIVE" });
    const [second] = await pendingTasks(storage, track.id);
    expect(second).toMatchObject({ title: "密卷2", item_ordinal: 2 });

    await adapter.completeTask({
      taskId: second.id,
      idempotencyKey: crypto.randomUUID(),
    });
    // 完成最后一项 → 轨道 COMPLETED，不产生下一项（AC-LT-006）。
    expect(
      (await adapter.getTrack(track.id)) as {
        status: string;
        currentOrdinal: number;
      },
    ).toMatchObject({ status: "COMPLETED", currentOrdinal: 3 });
    expect(await pendingTasks(storage, track.id)).toHaveLength(0);
  });

  it("converts an ad-hoc task in place and continues the series", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = await setupSequenceStudent(adapter, "S905");

    // 历史 Day3 保持临时任务；Day4 是正在进行的任务。
    await adapter.createAdHocTask({
      studentId: student.id,
      scheduledDate: "2026-08-19",
      title: "一天一句长难句 Day 3",
      idempotencyKey: crypto.randomUUID(),
    });
    const day4 = (await adapter.createAdHocTask({
      studentId: student.id,
      scheduledDate: "2026-08-20",
      title: "一天一句长难句 Day 4",
      idempotencyKey: crypto.randomUUID(),
    })) as { id: string; version: number };

    const convertKey = crypto.randomUUID();
    const result = (await adapter.convertTaskToLongTask(day4.id, {
      idempotencyKey: convertKey,
    })) as {
      taskId: string;
      trackId: string;
      ordinal: number;
      definitionCreated: boolean;
      track: {
        generationMode: string;
        startOrdinal: number;
        currentOrdinal: number;
      };
    };
    // 原地升级：任务 id 与标题快照不变，source_type 换成 TRACK（AC-LT-008）。
    expect(result).toMatchObject({
      taskId: day4.id,
      ordinal: 4,
      definitionCreated: true,
    });
    expect(result.track).toMatchObject({
      generationMode: "SEQUENCE",
      startOrdinal: 4,
      currentOrdinal: 4,
    });
    await expect(
      adapter.convertTaskToLongTask(day4.id, {
        idempotencyKey: convertKey,
      }),
    ).resolves.toMatchObject({
      taskId: day4.id,
      trackId: result.trackId,
      track: { id: result.trackId, generationMode: "SEQUENCE" },
    });
    const promoted = await storage.select<{
      source_type: string;
      track_id: string;
      item_ordinal: number;
      title_snapshot: string;
      template_item_id: string | null;
    }>(
      `SELECT source_type, track_id, item_ordinal, title_snapshot,
              template_item_id
       FROM task_instance WHERE id = $1`,
      [day4.id],
    );
    expect(promoted[0]).toMatchObject({
      source_type: "TRACK",
      item_ordinal: 4,
      title_snapshot: "一天一句长难句 Day 4",
      template_item_id: null,
    });
    // 历史 Day1~3 不回填（AC-LT-009）。
    const history = await storage.select<{ source_type: string }>(
      `SELECT source_type FROM task_instance
       WHERE student_id = $1 AND title_snapshot = '一天一句长难句 Day 3'`,
      [student.id],
    );
    expect(history[0]).toMatchObject({ source_type: "AD_HOC" });

    // 完成 Day4 → Day5 自动出现（AC-LT-010 的后续闭环）。
    await adapter.completeTask({
      taskId: day4.id,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(await pendingTasks(storage, result.trackId)).toMatchObject([
      { title: "一天一句长难句 Day 5", scheduled_date: "2026-08-21" },
    ]);

    // 同名系列再次转换复用现有定义，不再新建——换一个学生挂同一系列。
    const other = await setupSequenceStudent(adapter, "S905B");
    const day8 = (await adapter.createAdHocTask({
      studentId: other.id,
      scheduledDate: "2026-08-24",
      title: "一天一句长难句 Day 8",
      idempotencyKey: crypto.randomUUID(),
    })) as { id: string };
    const again = (await adapter.convertTaskToLongTask(day8.id, {
      idempotencyKey: crypto.randomUUID(),
    })) as { definitionCreated: boolean; ordinal: number };
    expect(again).toMatchObject({ definitionCreated: false, ordinal: 8 });

    // 已完成的任务不可转换。
    await adapter.completeTask({
      taskId: day8.id,
      idempotencyKey: crypto.randomUUID(),
    });
    await expect(
      adapter.convertTaskToLongTask(day8.id, {
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "TASK_NOT_CONVERTIBLE",
    } satisfies Partial<ApiError>);
    // 同一学生重复转换同系列：该学生已有活跃轨道，拒绝而不是叠轨道。
    const day9 = (await adapter.createAdHocTask({
      studentId: student.id,
      scheduledDate: "2026-08-24",
      title: "一天一句长难句 Day 9",
      idempotencyKey: crypto.randomUUID(),
    })) as { id: string };
    await expect(
      adapter.convertTaskToLongTask(day9.id, {
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "LONG_TASK_ALREADY_MOUNTED",
    } satisfies Partial<ApiError>);
  });

  it("rejects duplicate pending ordinals on sequence tracks", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = await setupSequenceStudent(adapter, "S906");

    const definition = (await adapter.createLongTask({
      sampleTitle: "一天一句长难句 Day 1",
    })) as { id: string };
    const track = (await adapter.mountLongTask({
      studentId: student.id,
      longTaskId: definition.id,
      anchorDate: "2026-08-17",
      idempotencyKey: crypto.randomUUID(),
    })) as { id: string };

    // 数据库层：同 track+ordinal 不允许出现第二个 PENDING 实例。
    // storage.execute 在 node:sqlite 下是同步抛错，包一层 async 让两种
    // 存储后端（同步抛/异步 reject）都走 rejects 断言。
    await expect(
      (async () =>
        storage.execute(
          `INSERT INTO task_instance(
             id, student_id, source_type, track_id, item_ordinal,
             scheduled_date, status, title_snapshot
           ) VALUES ($1, $2, 'TRACK', $3, 1, '2026-08-19', 'PENDING', '冒名 Day 1')`,
          [crypto.randomUUID(), student.id, track.id],
        ))(),
    ).rejects.toThrow();
  });

  it("suggests long-task conversion only after four consecutive ad-hoc items", async () => {
    storage = new NodeSqliteStorage();
    const adapter = new SqliteLocalDataAdapter(storage);
    const student = await setupSequenceStudent(adapter, "S907");

    const suggestionsFor = async (studentId: string) => {
      const result = (await adapter.listSeriesSuggestions(studentId)) as {
        items: {
          normalizedKey: string;
          seriesName: string;
          titlePattern: string;
          assignmentCount: number;
          nextOrdinal: number;
          taskId: string;
          taskVersion: number;
        }[];
      };
      return result.items;
    };
    const addAdHoc = (studentId: string, date: string, title: string) =>
      adapter.createAdHocTask({
        studentId,
        scheduledDate: date,
        title,
        idempotencyKey: crypto.randomUUID(),
      }) as Promise<{ id: string; version: number }>;
    const week = [
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
    ];

    const created: { id: string; version: number }[] = [];
    for (const ordinal of [1, 2, 3, 4]) {
      created.push(
        await addAdHoc(student.id, week[ordinal - 1], `密卷${ordinal}`),
      );
      // 连到第 4 项才问一句，前三次不打扰助教。
      expect(await suggestionsFor(student.id)).toHaveLength(
        ordinal === 4 ? 1 : 0,
      );
    }
    expect((await suggestionsFor(student.id))[0]).toMatchObject({
      normalizedKey: "密卷",
      seriesName: "密卷",
      titlePattern: "密卷{n}",
      assignmentCount: 4,
      nextOrdinal: 5,
      taskId: created[3].id,
      taskVersion: created[3].version,
    });

    // "暂不"落在 app_setting，重开也不再问；重复点不叠加。
    await adapter.dismissSeriesSuggestion(student.id, {
      normalizedKey: "密卷",
    });
    await adapter.dismissSeriesSuggestion(student.id, {
      normalizedKey: "密卷",
    });
    expect(await suggestionsFor(student.id)).toHaveLength(0);
    const dismissed = await storage.select<{ setting_value: string }>(
      `SELECT setting_value FROM app_setting WHERE setting_key = $1`,
      [`series.suggestion.dismissed:${student.id}`],
    );
    expect(dismissed).toHaveLength(1);
    expect(dismissed[0].setting_value).toBe(JSON.stringify(["密卷"]));

    // 已挂轨道的系列不再建议：转掉第 5 项后 1~4 仍是 4 连号。
    const mounted = await setupSequenceStudent(adapter, "S908");
    const items: { id: string }[] = [];
    for (const ordinal of [1, 2, 3, 4, 5]) {
      items.push(
        await addAdHoc(mounted.id, week[ordinal - 1], `真题精讲${ordinal}`),
      );
    }
    expect(await suggestionsFor(mounted.id)).toHaveLength(1);
    await adapter.convertTaskToLongTask(items[4].id, {
      idempotencyKey: crypto.randomUUID(),
    });
    expect(await suggestionsFor(mounted.id)).toHaveLength(0);
  });
});
