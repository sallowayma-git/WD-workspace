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
  /** Returns true when the file was saved, false when the user cancelled. */
  saveFile(data: Blob, suggestedName: string): Promise<boolean>;
  copyText(text: string): Promise<void>;
  requestText(options: {
    title: string;
    placeholder?: string;
  }): Promise<string | null>;
  notify(message: NotificationMessage): Promise<void>;
  appVersion(): Promise<string>;
}
