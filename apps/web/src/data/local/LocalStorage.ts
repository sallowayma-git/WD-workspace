export interface LocalQueryResult {
  rowsAffected: number;
  lastInsertId?: number;
}

export interface LocalSqlStatement {
  sql: string;
  values?: unknown[];
  expectedRowsAffected?: number;
}

export interface LocalStorage {
  select<TRow extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<TRow[]>;
  execute(sql: string, values?: unknown[]): Promise<LocalQueryResult>;
  transaction(statements: LocalSqlStatement[]): Promise<number[]>;
}
