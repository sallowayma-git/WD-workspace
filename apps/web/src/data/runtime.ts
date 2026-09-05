import type { DataAdapter } from "./DataAdapter";
import { BrowserSqliteStorage } from "./local/browserSqliteStorage";
import { SqliteLocalDataAdapter } from "./local/sqliteLocalDataAdapter";
import { TauriSqliteStorage } from "./local/tauriSqliteStorage";

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in globalThis;
}

export function isLocalRuntime(): boolean {
  return true;
}

let adapterOverride: DataAdapter | null = null;
let localAdapter: DataAdapter | null = null;

export function getDataAdapter(): DataAdapter {
  if (adapterOverride) return adapterOverride;
  localAdapter ??= new SqliteLocalDataAdapter(
    isTauriRuntime() ? new TauriSqliteStorage() : new BrowserSqliteStorage(),
  );
  return localAdapter;
}

export function setDataAdapterForTests(adapter: DataAdapter | null): void {
  adapterOverride = adapter;
}
