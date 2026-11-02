import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { baseName, isPdfName, SaveError, type FileStamp, type OpenedFile, type Platform, type SaveErrorKind } from "./types";

async function readPath(path: string): Promise<OpenedFile> {
  const stamp = await invoke<FileStamp>("file_stamp", { path });
  const buffer = await invoke<ArrayBuffer>("read_pdf", { path });
  return { name: baseName(path), path, bytes: new Uint8Array(buffer), stamp };
}

/** Subscribes to a Tauri event source whose unlisten function arrives asynchronously. */
function subscribe(start: () => Promise<() => void>): () => void {
  let unlisten: (() => void) | null = null;
  let disposed = false;
  void start().then((u) => {
    if (disposed) u();
    else unlisten = u;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

export const tauriPlatform: Platform = {
  async pickPdf() {
    const path = await open({ multiple: false, directory: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    return path ? readPath(path) : null;
  },
  readPath,
  async writePdf(path, bytes, expected) {
    const headers: Record<string, string> = { "x-path": encodeURIComponent(path) };
    if (expected) headers["x-stamp"] = JSON.stringify(expected);
    try {
      return await invoke<FileStamp>("write_pdf", bytes, { headers });
    } catch (e) {
      const err = e as { kind?: SaveErrorKind; message?: string };
      throw new SaveError(err.kind ?? "io", err.message ?? String(e));
    }
  },
  async pickSavePath(defaultPath) {
    return save({ defaultPath, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  },
  ask: (message, ok, cancel) => ask(message, { title: "typenote", kind: "warning", okLabel: ok, cancelLabel: cancel }),
  onCloseRequested(handler) {
    return subscribe(() =>
      getCurrentWindow().onCloseRequested(async (event) => {
        if (!(await handler())) event.preventDefault();
      }),
    );
  },
  onOpenRequest(cb) {
    // the host keeps the files until asked (launch_paths), and pings when more arrive
    let active = true;
    const take = () =>
      void invoke<string[]>("launch_paths").then((paths) => {
        if (active) for (const path of paths) cb(path);
      });
    const stop = subscribe(async () => {
      const unlisten = await getCurrentWebviewWindow().listen("open-request", take);
      if (active) take();
      return unlisten;
    });
    return () => {
      active = false;
      stop();
    };
  },
  recentFiles: () => invoke<string[]>("recent_files"),
  addRecentFile: (path) => invoke<string[]>("add_recent_file", { path }),
  removeRecentFile: (path) => invoke<string[]>("remove_recent_file", { path }),
  onFileDrop(cb) {
    return subscribe(() =>
      getCurrentWebview().onDragDropEvent((ev) => {
        if (ev.payload.type !== "drop") return;
        const path = ev.payload.paths.find(isPdfName);
        if (path) cb(() => readPath(path), path);
      }),
    );
  },
  setTitle(title) {
    void getCurrentWindow().setTitle(title);
  },
};
