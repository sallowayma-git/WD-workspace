import type {
  FileSelectionOptions,
  NotificationMessage,
  PlatformAdapter,
  SelectedFile,
} from "./PlatformAdapter";

export const browserPlatformAdapter: PlatformAdapter = {
  chooseFile(
    options: FileSelectionOptions = {},
  ): Promise<SelectedFile[] | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = options.multiple ?? false;
      input.accept = options.accept?.join(",") ?? "";
      input.addEventListener(
        "change",
        () => {
          const files = Array.from(input.files ?? []).map((file) => ({
            name: file.name,
            file,
          }));
          resolve(files.length > 0 ? files : null);
        },
        { once: true },
      );
      input.click();
    });
  },
  saveFile(data: Blob, suggestedName: string): Promise<void> {
    const url = URL.createObjectURL(data);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = suggestedName;
    anchor.click();
    URL.revokeObjectURL(url);
    return Promise.resolve();
  },
  async notify(message: NotificationMessage): Promise<void> {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default")
      await Notification.requestPermission();
    if (Notification.permission === "granted")
      new Notification(message.title, { body: message.body });
  },
  appVersion(): Promise<string> {
    const environment = import.meta.env as unknown as Record<string, unknown>;
    const version = environment.VITE_APP_VERSION;
    return Promise.resolve(typeof version === "string" ? version : "web-dev");
  },
};
