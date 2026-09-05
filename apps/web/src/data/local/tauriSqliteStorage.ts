import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import type {
  LocalQueryResult,
  LocalSqlStatement,
  LocalStorage,
} from "./LocalStorage";

const DATABASE_URL = "sqlite:assistant.db";

export class TauriSqliteStorage implements LocalStorage {
  private database: Promise<Database> | null = null;

  private getDatabase(): Promise<Database> {
    this.database ??= Database.load(DATABASE_URL);
    return this.database;
  }

  async select<TRow extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<TRow[]> {
    const database = await this.getDatabase();
    return database.select<TRow[]>(sql, values);
  }

  async execute(
    sql: string,
    values: unknown[] = [],
  ): Promise<LocalQueryResult> {
    const database = await this.getDatabase();
    return database.execute(sql, values);
  }

  transaction(statements: LocalSqlStatement[]): Promise<number[]> {
    return invoke<number[]>("execute_local_transaction", { statements });
  }
}
