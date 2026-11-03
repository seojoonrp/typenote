// Development fallback so the UI runs in a plain browser (vite dev): file picker,
// HTML drag & drop, and ?file=/samples/x.pdf for loading a file served by the dev server.
// Saving cannot reach the disk here: written bytes are kept in window.__typenoteSaved.
import { baseName, isPdfName, type ChosenFile, type OpenedFile, type Platform } from "./types";

declare global {
  interface Window {
    __typenoteSaved?: Map<string, Uint8Array>;
  }
}

const RECENT_KEY = "typenote.recent";
let launchFiles = new URLSearchParams(location.search).getAll("file");

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]): string[] {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable: recent list just isn't remembered
  }
  return list;
}

async function fromFile(file: File): Promise<OpenedFile> {
  return { name: file.name, path: null, bytes: new Uint8Array(await file.arrayBuffer()), stamp: null };
}

const chosenFile = (file: File): ChosenFile => ({ name: file.name, path: null, load: () => fromFile(file) });

export const browserPlatform: Platform = {
  pickPdfs() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.accept = "application/pdf,.pdf";
      input.addEventListener("change", () => resolve([...(input.files ?? [])].map(chosenFile)));
      input.addEventListener("cancel", () => resolve([]));
      input.click();
    });
  },
  async readPath(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return { name: baseName(path), path, bytes: new Uint8Array(await res.arrayBuffer()), stamp: null };
  },
  async writePdf(path, bytes) {
    (window.__typenoteSaved ??= new Map()).set(path, bytes.slice());
    return { size: bytes.byteLength, modified: Date.now() };
  },
  async pickSavePath(defaultPath) {
    return window.prompt("Save as (kept in memory only in the browser)", defaultPath);
  },
  async ask(message) {
    return window.confirm(message);
  },
  onCloseRequested() {
    return () => {};
  },
  onOpenRequest(cb) {
    // ?file= (repeatable) stands in for the launch files, delivered once
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const paths = launchFiles;
      launchFiles = [];
      for (const path of paths) cb(path);
    });
    return () => {
      active = false;
    };
  },
  async recentFiles() {
    return loadRecent();
  },
  async addRecentFile(path) {
    return saveRecent([path, ...loadRecent().filter((p) => p !== path)].slice(0, 10));
  },
  async removeRecentFile(path) {
    return saveRecent(loadRecent().filter((p) => p !== path));
  },
  onFileDrop(cb) {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => isPdfName(f.name)).map(chosenFile);
      if (files.length) cb(files);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  },
  setTitle(title) {
    document.title = title;
  },
};
