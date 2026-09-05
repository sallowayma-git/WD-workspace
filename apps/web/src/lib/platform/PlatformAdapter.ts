export type FileSelectionOptions = {
  accept?: string[];
  multiple?: boolean;
};

export type SelectedFile = {
  name: string;
  file: File;
};

export type NotificationMessage = {
  title: string;
  body?: string;
};

export interface PlatformAdapter {
  chooseFile(options?: FileSelectionOptions): Promise<SelectedFile[] | null>;
  saveFile(data: Blob, suggestedName: string): Promise<void>;
  copyText(text: string): Promise<void>;
  requestText(options: {
    title: string;
    placeholder?: string;
  }): Promise<string | null>;
  notify(message: NotificationMessage): Promise<void>;
  appVersion(): Promise<string>;
}
