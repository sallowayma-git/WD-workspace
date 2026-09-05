import { browserPlatformAdapter } from "./browserPlatformAdapter";
import type { PlatformAdapter } from "./PlatformAdapter";

// Tauri renders the React UI inside a WebView; feature code uses this boundary
// instead of coupling directly to browser globals.
export function getPlatformAdapter(): PlatformAdapter {
  return browserPlatformAdapter;
}
