export type OpenedFile = { name: string; path: string | null; bytes: Uint8Array };

/** What the UI needs from the host. Tauri in the app; a browser fallback for development. */
export interface Platform {
  pickPdf(): Promise<OpenedFile | null>;
  readPath(path: string): Promise<OpenedFile>;
  /** PDF given at launch (file association / command line) */
  launchPath(): Promise<string | null>;
  recentFiles(): Promise<string[]>;
  addRecentFile(path: string): Promise<string[]>;
  removeRecentFile(path: string): Promise<string[]>;
  /** Subscribes to PDFs dropped on the window; returns an unsubscribe function. */
  onFileDrop(cb: (load: () => Promise<OpenedFile>) => void): () => void;
  setTitle(title: string): void;
}

export const baseName = (path: string) => path.split(/[\\/]/).pop() || path;
export const isPdfName = (name: string) => /\.pdf$/i.test(name);
