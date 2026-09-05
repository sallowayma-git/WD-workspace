import { afterEach, describe, expect, it, vi } from "vitest";

function setTauriRuntime(enabled: boolean): void {
  if (enabled) {
    Object.defineProperty(globalThis, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    return;
  }
  Reflect.deleteProperty(globalThis, "__TAURI_INTERNALS__");
}

describe("local data adapter runtime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setTauriRuntime(false);
    vi.resetModules();
  });

  it("uses local SQLite even when the obsolete HTTP mode is configured", async () => {
    vi.stubEnv("VITE_DATA_MODE", "http");
    const { getDataAdapter, isLocalRuntime } = await import("./runtime");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(isLocalRuntime()).toBe(true);
    expect(getDataAdapter().constructor.name).toBe("SqliteLocalDataAdapter");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("uses the Tauri SQLite storage inside the desktop runtime", async () => {
    setTauriRuntime(true);
    const { getDataAdapter, isTauriRuntime } = await import("./runtime");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(isTauriRuntime()).toBe(true);
    expect(getDataAdapter().constructor.name).toBe("SqliteLocalDataAdapter");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
