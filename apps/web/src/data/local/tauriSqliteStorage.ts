import { invoke } from "@tauri-apps/api/core";
import type {
  LocalQueryResult,
  LocalSqlStatement,
  LocalStorage,
} from "./LocalStorage";

/** 读写都走 invoke：Rust 侧只有一个 sqlx 池，PRAGMA 和事务语义只有一套。 */
export class TauriSqliteStorage implements LocalStorage {
  select<TRow extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<TRow[]> {
    return invoke<TRow[]>("select_local_rows", { sql, values });
  }

  async execute(
    sql: string,
    values: unknown[] = [],
  ): Promise<LocalQueryResult> {
    const [rowsAffected] = await this.transaction([{ sql, values }]);
    return { rowsAffected: rowsAffected ?? 0 };
  }

  transaction(statements: LocalSqlStatement[]): Promise<number[]> {
    return invoke<number[]>("execute_local_transaction", { statements });
  }
}
