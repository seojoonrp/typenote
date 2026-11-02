/** Size + modification time when the file was opened or last saved (detects outside changes). */
export type FileStamp = { size: number; modified: number };

export type OpenedFile = { name: string; path: string | null; bytes: Uint8Array; stamp: FileStamp | null };

export type SaveErrorKind = "locked" | "conflict" | "readonly" | "io";
export class SaveError extends Error {
  constructor(
    readonly kind: SaveErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** What the UI needs from the host. Tauri in the app; a browser fallback for development. */
export interface Platform {
  pickPdf(): Promise<OpenedFile | null>;
  readPath(path: string): Promise<OpenedFile>;
  /**
   * Replaces the file with `bytes` (temp file + rename). With `expected`, refuses with a
   * "conflict" SaveError if the file on disk no longer matches it. Returns the new stamp.
   */
  writePdf(path: string, bytes: Uint8Array, expected: FileStamp | null): Promise<FileStamp>;
  pickSavePath(defaultPath: string): Promise<string | null>;
  /** A yes/no question; resolves true for the ok button. */
  ask(message: string, ok: string, cancel: string): Promise<boolean>;
  /** Runs before the window closes; returning false keeps it open. Returns an unsubscribe function. */
  onCloseRequested(handler: () => Promise<boolean>): () => void;
  /**
   * PDFs to open as tabs: the launch files, and files opened through the file association
   * while the app runs. Returns an unsubscribe function.
   */
  onOpenRequest(cb: (path: string) => void): () => void;
  recentFiles(): Promise<string[]>;
  addRecentFile(path: string): Promise<string[]>;
  removeRecentFile(path: string): Promise<string[]>;
  /** Subscribes to PDFs dropped on the window; returns an unsubscribe function. */
  onFileDrop(cb: (load: () => Promise<OpenedFile>, path: string | null) => void): () => void;
  setTitle(title: string): void;
}

export const baseName = (path: string) => path.split(/[\\/]/).pop() || path;
export const isPdfName = (name: string) => /\.pdf$/i.test(name);
