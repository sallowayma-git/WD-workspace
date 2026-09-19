import initSqlJs, { type Database, type SqlValue } from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import migrationCoreSql from "../../../../desktop/src-tauri/migrations/0001_local_core.sql?raw";
import migrationSequenceLongTaskSql from "../../../../desktop/src-tauri/migrations/0002_sequence_long_task.sql?raw";
import migrationSequenceInvariantsSql from "../../../../desktop/src-tauri/migrations/0003_sequence_invariants.sql?raw";
import migrationCustomerFeedbackRound1Sql from "../../../../desktop/src-tauri/migrations/0004_customer_feedback_round1.sql?raw";
import type {
  LocalQueryResult,
  LocalSqlStatement,
  LocalStorage,
} from "./LocalStorage";

function sqliteValue(value: unknown): SqlValue {
  if (value == null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "string") return value;
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value);
}

function normalizeStatement(sql: string, values: unknown[] = []) {
  const orderedValues: SqlValue[] = [];
  const normalizedSql = sql.replace(/\$(\d+)/g, (_match, index: string) => {
    orderedValues.push(sqliteValue(values[Number(index) - 1]));
    return "?";
  });
  return { sql: normalizedSql, values: orderedValues };
}

async function createDatabase(): Promise<Database> {
  const sqlite = await initSqlJs({ locateFile: () => sqlWasmUrl });
  const database = new sqlite.Database();
  database.exec(migrationCoreSql);
  database.exec(migrationSequenceLongTaskSql);
  database.exec(migrationSequenceInvariantsSql);
  database.exec(migrationCustomerFeedbackRound1Sql);
  return database;
}

/** browser dev shell 一律使用内存 SQLite（sql.js + 同一套 migration SQL）。 */
export class BrowserSqliteStorage implements LocalStorage {
  private database?: Promise<Database>;

  private getDatabase(): Promise<Database> {
    this.database ??= createDatabase();
    return this.database;
  }

  async select<TRow extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<TRow[]> {
    const database = await this.getDatabase();
    const normalized = normalizeStatement(sql, values);
    const statement = database.prepare(normalized.sql);
    try {
      statement.bind(normalized.values);
      const rows: TRow[] = [];
      while (statement.step()) {
        rows.push(statement.getAsObject() as TRow);
      }
      return rows;
    } finally {
      statement.free();
    }
  }

  async execute(
    sql: string,
    values: unknown[] = [],
  ): Promise<LocalQueryResult> {
    const database = await this.getDatabase();
    const normalized = normalizeStatement(sql, values);
    database.run(normalized.sql, normalized.values);
    const insertIdResult = database.exec(
      "SELECT last_insert_rowid() AS last_insert_id",
    );
    const lastInsertId = insertIdResult[0]?.values[0]?.[0];
    return {
      rowsAffected: database.getRowsModified(),
      lastInsertId: typeof lastInsertId === "number" ? lastInsertId : undefined,
    };
  }

  async transaction(statements: LocalSqlStatement[]): Promise<number[]> {
    const database = await this.getDatabase();
    database.exec("BEGIN IMMEDIATE");
    try {
      const changes = statements.map((statement) => {
        const normalized = normalizeStatement(statement.sql, statement.values);
        database.run(normalized.sql, normalized.values);
        const rowsAffected = database.getRowsModified();
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
      database.exec("COMMIT");
      return changes;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}
