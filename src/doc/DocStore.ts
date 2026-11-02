// The open document as the UI sees it: text boxes, unsaved state, saving and autosave.
// Plain class (no React) so the save logic can be tested with fake worker and platform.
import type { SaveMode } from "../pdf/engine/editor";
import type { TextBox, TextBoxInput } from "../pdf/engine/model";
import type { PdfClient } from "../pdf/client";
import type { DocInfo, PutTextBoxResult } from "../pdf/protocol";
import { baseName, SaveError, type FileStamp, type OpenedFile, type Platform, type SaveErrorKind } from "../platform/types";

/** Autosave this long after the last edit. */
export const AUTOSAVE_DELAY_MS = 3000;
/** While another program holds the file, retry this often. */
export const LOCKED_RETRY_MS = 10_000;

export type OpenDoc = { info: DocInfo; name: string; path: string | null };
export type SaveProblem = { kind: SaveErrorKind | "failed"; message: string };

export type DocState = {
  doc: OpenDoc | null;
  textBoxes: TextBox[];
  /** edits not on disk yet */
  dirty: boolean;
  saving: boolean;
  saveProblem: SaveProblem | null;
  lastSave: { mode: SaveMode; at: number } | null;
};

type Client = Pick<PdfClient, "open" | "putTextBox" | "deleteTextBox" | "save">;
type Host = Pick<Platform, "writePdf" | "pickSavePath" | "addRecentFile" | "setTitle">;

export type SaveOptions = { full?: boolean; saveAs?: boolean; overwrite?: boolean };

export class DocStore {
  private state: DocState = { doc: null, textBoxes: [], dirty: false, saving: false, saveProblem: null, lastSave: null };
  private listeners = new Set<() => void>();
  private pageListeners = new Set<(pages: number[]) => void>();
  private stamp: FileStamp | null = null;
  private editVersion = 0;
  private savedVersion = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<boolean> | null = null;

  constructor(
    private client: Client,
    private host: Host,
  ) {}

  // --- subscription (useSyncExternalStore) -------------------------------------------------
  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  /** Pages whose rendering changed (the viewer re-renders them). */
  onPagesChanged(fn: (pages: number[]) => void) {
    this.pageListeners.add(fn);
    return () => void this.pageListeners.delete(fn);
  }

  private set(patch: Partial<DocState>) {
    this.state = { ...this.state, ...patch };
    const d = this.state.doc;
    this.host.setTitle(d ? `${this.state.dirty ? "• " : ""}${d.name} — typenote` : "typenote");
    for (const fn of this.listeners) fn();
  }

  // --- open --------------------------------------------------------------------------------
  /** Opens a file loaded by the caller. Throws on failure, leaving the current document as is. */
  async open(file: OpenedFile) {
    const r = await this.client.open(file.bytes);
    clearTimeout(this.timer);
    this.stamp = file.stamp;
    this.editVersion = this.savedVersion = 0;
    const { textBoxes, ...info } = r;
    this.set({ doc: { info, name: file.name, path: file.path }, textBoxes, dirty: false, saving: false, saveProblem: null, lastSave: null });
  }

  // --- edits -------------------------------------------------------------------------------
  async putTextBox(box: TextBoxInput): Promise<PutTextBoxResult> {
    const r = await this.client.putTextBox(box);
    const rest = this.state.textBoxes.filter((b) => b.id !== r.box.id);
    this.edited({ textBoxes: [...rest, r.box] }, r.pages);
    return r;
  }

  async deleteTextBox(id: string): Promise<void> {
    const page = await this.client.deleteTextBox(id);
    if (page === null) return;
    this.edited({ textBoxes: this.state.textBoxes.filter((b) => b.id !== id) }, [page]);
  }

  private edited(patch: Partial<DocState>, pages: number[]) {
    this.editVersion++;
    this.set({ ...patch, dirty: true });
    for (const fn of this.pageListeners) fn(pages);
    this.schedule(AUTOSAVE_DELAY_MS);
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.autosave(), ms);
  }

  private async autosave() {
    const problem = this.state.saveProblem?.kind;
    // these need the user (overwrite or save elsewhere); retrying would not help
    if (problem === "conflict" || problem === "readonly") return;
    if (this.state.dirty && this.state.doc?.path) await this.save();
  }

  // --- save --------------------------------------------------------------------------------
  /**
   * Saves to the document's file (or asks for one). Resolves true once everything edited so far
   * is on disk. Concurrent calls wait for the running save, then save again if still dirty.
   */
  async save(opts: SaveOptions = {}): Promise<boolean> {
    while (this.saving) await this.saving;
    if (!this.state.doc) return false;
    if (!this.state.dirty && !opts.full && !opts.saveAs) return true;
    this.saving = this.saveOnce(opts);
    try {
      return await this.saving;
    } finally {
      this.saving = null;
    }
  }

  private async saveOnce(opts: SaveOptions): Promise<boolean> {
    const doc = this.state.doc!;
    let path = doc.path;
    if (opts.saveAs || !path) {
      path = await this.host.pickSavePath(path ?? doc.name);
      if (!path) return false;
    }
    const newFile = path !== doc.path;
    const version = this.editVersion;
    clearTimeout(this.timer);
    this.set({ saving: true });
    try {
      const r = await this.client.save(opts.full ?? false);
      // a new file has no stamp to compare with; "overwrite" deliberately ignores an outside change
      const expected = newFile || opts.overwrite ? null : this.stamp;
      this.stamp = await this.host.writePdf(path, r.bytes, expected);
      this.savedVersion = version;
      const dirty = this.editVersion !== this.savedVersion;
      this.set({
        doc: newFile ? { ...doc, path, name: baseName(path) } : doc,
        textBoxes: this.mergeObjNums(r.textBoxes),
        dirty,
        saving: false,
        saveProblem: null,
        lastSave: { mode: r.mode, at: Date.now() },
      });
      if (newFile) void this.host.addRecentFile(path).catch(() => {});
      if (dirty) this.schedule(AUTOSAVE_DELAY_MS);
      return !dirty;
    } catch (e) {
      const problem: SaveProblem = e instanceof SaveError ? { kind: e.kind, message: e.message } : { kind: "failed", message: e instanceof Error ? e.message : String(e) };
      this.set({ saving: false, saveProblem: problem });
      if (problem.kind === "locked") this.schedule(LOCKED_RETRY_MS);
      return false;
    }
  }

  /** Keeps boxes edited during the save; refreshes object numbers (a full save renumbers). */
  private mergeObjNums(saved: TextBox[]): TextBox[] {
    const byId = new Map(saved.map((b) => [b.id, b]));
    return this.state.textBoxes.map((b) => ({ ...b, objNum: byId.get(b.id)?.objNum ?? b.objNum }));
  }

  dismissProblem() {
    this.set({ saveProblem: null });
  }

  dispose() {
    clearTimeout(this.timer);
  }
}
