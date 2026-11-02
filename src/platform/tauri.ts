import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { baseName, isPdfName, type OpenedFile, type Platform } from "./types";

async function readPath(path: string): Promise<OpenedFile> {
  const buffer = await invoke<ArrayBuffer>("read_pdf", { path });
  return { name: baseName(path), path, bytes: new Uint8Array(buffer) };
}

export const tauriPlatform: Platform = {
  async pickPdf() {
    const path = await open({ multiple: false, directory: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    return path ? readPath(path) : null;
  },
  readPath,
  launchPath: () => invoke<string | null>("launch_path"),
  recentFiles: () => invoke<string[]>("recent_files"),
  addRecentFile: (path) => invoke<string[]>("add_recent_file", { path }),
  removeRecentFile: (path) => invoke<string[]>("remove_recent_file", { path }),
  onFileDrop(cb) {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void getCurrentWebview()
      .onDragDropEvent((ev) => {
        if (ev.payload.type !== "drop") return;
        const path = ev.payload.paths.find(isPdfName);
        if (path) cb(() => readPath(path));
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  },
  setTitle(title) {
    void getCurrentWindow().setTitle(title);
  },
};
