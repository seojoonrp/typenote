// The open document as the UI sees it: text boxes, highlights, undo history, unsaved state,
// saving and autosave. Plain class (no React) so the logic can be tested with fake worker and
// platform.
//
// Edits are optimistic: the UI state changes at once (a dropped box must not jump back while
// the worker writes it) and the worker result only fills in the object number. The worker
// handles messages in order, so a later save always includes every edit made before it.
import type { SaveMode } from "../pdf/engine/editor";
import { newBoxId, type Highlight, type HighlightInput, type TextBox, type TextBoxInput } from "../pdf/engine/model";
import type { PdfClient } from "../pdf/client";
import type { DocInfo, PutHighlightResult, PutTextBoxResult } from "../pdf/protocol";
import { baseName, SaveError, type FileStamp, type OpenedFile, type Platform, type SaveErrorKind } from "../platform/types";

/** Autosave this long after the last edit. */
export const AUTOSAVE_DELAY_MS = 3000;
/** While another program holds the file, retry this often. */
export const LOCKED_RETRY_MS = 10_000;
/** Edits with the same merge key this close together are one undo step. */
export const MERGE_MS = 1000;

export type OpenDoc = { info: DocInfo; name: string; path: string | null };
export type SaveProblem = { kind: SaveErrorKind | "failed"; message: string };

export type DocState = {
  doc: OpenDoc | null;
  textBoxes: TextBox[];
  highlights: Highlight[];
  /** edits not on disk yet */
  dirty: boolean;
  saving: boolean;
  saveProblem: SaveProblem | null;
  lastSave: { mode: SaveMode; at: number } | null;
  canUndo: boolean;
  canRedo: boolean;
  /** the worker rejected an edit (it was rolled back) */
  editError: string | null;
};

export type EditOptions = {
  /** add to the undo history (default true; undo/redo themselves pass false) */
  record?: boolean;
  /** consecutive edits with the same key within MERGE_MS become one undo step (nudges, steppers) */
  merge?: string;
};

/** The annotation lists, by state key. */
type Items = { textBoxes: TextBox; highlights: Highlight };
type Kind = keyof Items;
type Item = Items[Kind];

/** One undo step: the annotation before and after (null = did not exist). */
type Command = { kind: Kind; before: Item | null; after: Item | null; merge?: string; at: number };

type Client = Pick<PdfClient, "open" | "putTextBox" | "deleteTextBox" | "putHighlight" | "deleteHighlight" | "save">;
export type DocHost = Pick<Platform, "writePdf" | "pickSavePath" | "addRecentFile" | "setTitle">;

export type SaveOptions = { full?: boolean; saveAs?: boolean; overwrite?: boolean };

export class DocStore {
  private state: DocState = {
    doc: null,
    textBoxes: [],
    highlights: [],
    dirty: false,
    saving: false,
    saveProblem: null,
    lastSave: null,
    canUndo: false,
    canRedo: false,
    editError: null,
  };
  private listeners = new Set<() => void>();
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private stamp: FileStamp | null = null;
  private editVersion = 0;
  private savedVersion = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<boolean> | null = null;

  constructor(
    private client: Client,
    private host: DocHost,
  ) {}

  // --- subscription (useSyncExternalStore) -------------------------------------------------
  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
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
    this.undoStack = [];
    this.redoStack = [];
    const { textBoxes, highlights, ...info } = r;
    this.set({
      doc: { info, name: file.name, path: file.path },
      textBoxes,
      highlights,
      dirty: false,
      saving: false,
      saveProblem: null,
      lastSave: null,
      canUndo: false,
      canRedo: false,
      editError: null,
    });
  }

  // --- edits -------------------------------------------------------------------------------
  /** Creates (no id) or updates a text box. Resolves to null if the worker rejected it (rolled back). */
  putTextBox(input: TextBoxInput, opts: EditOptions = {}): Promise<PutTextBoxResult | null> {
    const box = { ...input, id: input.id ?? newBoxId() };
    return this.put("textBoxes", box, opts, async ({ objNum: _o, ...rest }) => {
      const r = await this.client.putTextBox(rest);
      return { objNum: r.box.objNum, result: r };
    });
  }

  deleteTextBox(id: string, opts: EditOptions = {}): Promise<void> {
    return this.remove("textBoxes", id, opts, () => this.client.deleteTextBox(id));
  }

  /** Creates or updates (color, opacity) a highlight. Resolves to null if the worker rejected it. */
  putHighlight(input: HighlightInput, opts: EditOptions = {}): Promise<PutHighlightResult | null> {
    return this.put("highlights", input, opts, async ({ objNum: _o, ...rest }) => {
      const r = await this.client.putHighlight(rest);
      return { objNum: r.highlight.objNum, result: r };
    });
  }

  deleteHighlight(id: string, opts: EditOptions = {}): Promise<void> {
    return this.remove("highlights", id, opts, () => this.client.deleteHighlight(id));
  }

  async undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    this.redoStack.push(cmd);
    await this.restore(cmd.kind, cmd.before, (cmd.after ?? cmd.before)!.id);
  }

  async redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    this.undoStack.push(cmd);
    await this.restore(cmd.kind, cmd.after, (cmd.after ?? cmd.before)!.id);
  }

  private async restore(kind: Kind, item: Item | null, id: string) {
    const opts = { record: false };
    if (kind === "textBoxes") await (item ? this.putTextBox(item as TextBox, opts) : this.deleteTextBox(id, opts));
    else await (item ? this.putHighlight(item as Highlight, opts) : this.deleteHighlight(id, opts));
  }

  private async put<K extends Kind, R>(
    kind: K,
    input: Omit<Items[K], "objNum">,
    opts: EditOptions,
    send: (item: Items[K]) => Promise<{ objNum: number | undefined; result: R }>,
  ): Promise<R | null> {
    const before = this.find(kind, input.id);
    const item = { ...input, objNum: before?.objNum } as Items[K];
    const cmd = opts.record === false ? null : this.record(kind, before, item, opts.merge);
    this.applyLocal(kind, input.id, item);
    try {
      const r = await send(item);
      this.setObjNum(kind, input.id, r.objNum);
      return r.result;
    } catch (e) {
      this.rollback(kind, input.id, before, cmd, e);
      return null;
    }
  }

  private async remove(kind: Kind, id: string, opts: EditOptions, send: () => Promise<unknown>) {
    const before = this.find(kind, id);
    if (!before) return;
    const cmd = opts.record === false ? null : this.record(kind, before, null);
    this.applyLocal(kind, id, null);
    try {
      await send();
    } catch (e) {
      this.rollback(kind, id, before, cmd, e);
    }
  }

  private list(kind: Kind): Item[] {
    return this.state[kind];
  }

  private find<K extends Kind>(kind: K, id: string): Items[K] | null {
    return (this.list(kind).find((b) => b.id === id) as Items[K] | undefined) ?? null;
  }

  private record(kind: Kind, before: Item | null, after: Item | null, merge?: string): Command {
    const now = Date.now();
    const last = this.undoStack.at(-1);
    this.redoStack = [];
    if (merge && last?.kind === kind && last.merge === merge && now - last.at < MERGE_MS) {
      last.after = after;
      last.at = now;
      return last;
    }
    const cmd: Command = { kind, before, after, merge, at: now };
    this.undoStack.push(cmd);
    return cmd;
  }

  private applyLocal(kind: Kind, id: string, item: Item | null) {
    const list = this.list(kind);
    // replace in place: the list order is the stacking order on the page
    let next = item ? list.map((b) => (b.id === id ? item : b)) : list.filter((b) => b.id !== id);
    if (item && !list.some((b) => b.id === id)) next = [...list, item];
    this.editVersion++;
    this.set({
      [kind]: next,
      dirty: true,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      editError: null,
    });
    this.schedule(AUTOSAVE_DELAY_MS);
  }

  private setObjNum(kind: Kind, id: string, objNum: number | undefined) {
    const item = this.find(kind, id);
    if (!item || item.objNum === objNum) return;
    this.set({ [kind]: this.list(kind).map((b) => (b.id === id ? { ...b, objNum } : b)) });
  }

  private rollback(kind: Kind, id: string, before: Item | null, cmd: Command | null, e: unknown) {
    if (cmd && this.undoStack.at(-1) === cmd) this.undoStack.pop();
    const rest = this.list(kind).filter((b) => b.id !== id);
    this.set({
      [kind]: before ? [...rest, before] : rest,
      canUndo: this.undoStack.length > 0,
      editError: e instanceof Error ? e.message : String(e),
    });
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
        textBoxes: this.mergeObjNums("textBoxes", r.textBoxes),
        highlights: this.mergeObjNums("highlights", r.highlights),
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
  private mergeObjNums<K extends Kind>(kind: K, saved: Items[K][]): Items[K][] {
    const byId = new Map(saved.map((b) => [b.id, b]));
    return (this.state[kind] as Items[K][]).map((b) => ({ ...b, objNum: byId.get(b.id)?.objNum ?? b.objNum }));
  }

  dismissProblem() {
    this.set({ saveProblem: null });
  }

  dispose() {
    clearTimeout(this.timer);
  }
}
