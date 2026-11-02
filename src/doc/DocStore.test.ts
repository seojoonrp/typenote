import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Highlight, HighlightInput, TextBox, TextBoxInput } from "../pdf/engine/model";
import { SaveError, type FileStamp } from "../platform/types";
import { AUTOSAVE_DELAY_MS, DocStore, LOCKED_RETRY_MS } from "./DocStore";

const BOX: TextBoxInput = { page: 0, x: 10, y: 10, text: "가", size: 12, weight: "regular", color: [0, 0, 0] };
const HL: HighlightInput = { id: "typenote-hl-1", page: 0, quads: [[10, 10, 90, 10, 10, 22, 90, 22]], color: [0.219604, 0.898041, 1], opacity: 0.4 };

function setup() {
  let n = 0;
  const boxes = new Map<string, TextBox>();
  const highlights = new Map<string, Highlight>();
  const client = {
    open: vi.fn(async () => ({ docId: 1, pageCount: 1, pages: [{ width: 595, height: 842 }], textBoxes: [], highlights: [] })),
    putTextBox: vi.fn(async (b: TextBoxInput) => {
      const box = { ...b, id: b.id ?? `typenote-${++n}`, objNum: 100 + n };
      boxes.set(box.id, box);
      return { box, missing: [], pages: [box.page] };
    }),
    deleteTextBox: vi.fn(async (id: string) => (boxes.delete(id) ? 0 : null)),
    putHighlight: vi.fn(async (h: HighlightInput) => {
      const highlight = { ...h, objNum: highlights.get(h.id)?.objNum ?? 500 + ++n };
      highlights.set(h.id, highlight);
      return { highlight, pages: [h.page] };
    }),
    deleteHighlight: vi.fn(async (id: string) => (highlights.delete(id) ? 0 : null)),
    save: vi.fn(async (_full: boolean) => ({
      bytes: new Uint8Array([1, 2, 3]),
      mode: "incremental" as const,
      textBoxes: [...boxes.values()],
      highlights: [...highlights.values()],
    })),
  };
  let stamp: FileStamp = { size: 1, modified: 1 };
  const writes: { path: string; expected: FileStamp | null }[] = [];
  const host = {
    failNext: [] as SaveError[],
    writePdf: vi.fn(async (path: string, _bytes: Uint8Array, expected: FileStamp | null) => {
      writes.push({ path, expected });
      const err = host.failNext.shift();
      if (err) throw err;
      stamp = { size: stamp.size + 1, modified: stamp.modified + 1 };
      return stamp;
    }),
    pickSavePath: vi.fn(async (_d: string): Promise<string | null> => "C:\\out\\copy.pdf"),
    addRecentFile: vi.fn(async (p: string) => [p]),
    setTitle: vi.fn((_t: string) => {}),
  };
  const store = new DocStore(client, host);
  const open = (path: string | null = "C:\\docs\\a.pdf") =>
    store.open({ name: "a.pdf", path, bytes: new Uint8Array(), stamp: path ? { size: 1, modified: 1 } : null });
  return { store, client, host, writes, open };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("DocStore", () => {
  it("marks edits dirty and autosaves to the original file after a pause", async () => {
    const { store, host, writes, open } = setup();
    await open();
    await store.putTextBox(BOX);
    expect(store.getState().dirty).toBe(true);
    expect(host.setTitle).toHaveBeenLastCalledWith("• a.pdf — typenote");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual([{ path: "C:\\docs\\a.pdf", expected: { size: 1, modified: 1 } }]);
    expect(store.getState().dirty).toBe(false);
    expect(host.setTitle).toHaveBeenLastCalledWith("a.pdf — typenote");
  });

  it("each edit restarts the autosave delay, and the next save checks the new stamp", async () => {
    const { store, writes, open } = setup();
    await open();
    await store.putTextBox(BOX);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 100);
    await store.putTextBox({ ...BOX, x: 50 });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 100);
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(writes).toHaveLength(1);
    await store.putTextBox({ ...BOX, x: 90 });
    await store.save();
    expect(writes[1]!.expected).toEqual({ size: 2, modified: 2 });
  });

  it("an edit made while saving stays dirty and is saved next", async () => {
    const { store, client, writes, open } = setup();
    await open();
    const { box } = (await store.putTextBox(BOX))!;
    let release!: () => void;
    client.save.mockImplementationOnce(async () => {
      await new Promise<void>((r) => (release = r));
      return { bytes: new Uint8Array(), mode: "incremental", textBoxes: [box], highlights: [] };
    });
    const first = store.save();
    await vi.advanceTimersByTimeAsync(0);
    await store.putTextBox({ ...box, text: "나" });
    release();
    expect(await first).toBe(false);
    expect(store.getState().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(writes).toHaveLength(2);
    expect(store.getState().dirty).toBe(false);
  });

  it("retries while another program holds the file", async () => {
    const { store, host, writes, open } = setup();
    await open();
    await store.putTextBox(BOX);
    host.failNext.push(new SaveError("locked", "sharing violation"));
    expect(await store.save()).toBe(false);
    expect(store.getState().saveProblem?.kind).toBe("locked");
    expect(store.getState().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(LOCKED_RETRY_MS);
    expect(writes).toHaveLength(2);
    expect(store.getState().saveProblem).toBeNull();
    expect(store.getState().dirty).toBe(false);
  });

  it("stops autosaving on a conflict until the user overwrites", async () => {
    const { store, host, writes, open } = setup();
    await open();
    await store.putTextBox(BOX);
    host.failNext.push(new SaveError("conflict", "changed on disk"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(store.getState().saveProblem?.kind).toBe("conflict");
    await store.putTextBox({ ...BOX, x: 30 });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3);
    expect(writes).toHaveLength(1);
    expect(await store.save({ overwrite: true })).toBe(true);
    expect(writes[1]!.expected).toBeNull();
  });

  it("save as writes a new file without a stamp and switches to it", async () => {
    const { store, host, writes, open } = setup();
    await open();
    expect(await store.save({ saveAs: true })).toBe(true);
    expect(writes).toEqual([{ path: "C:\\out\\copy.pdf", expected: null }]);
    expect(store.getState().doc).toMatchObject({ name: "copy.pdf", path: "C:\\out\\copy.pdf" });
    expect(host.addRecentFile).toHaveBeenCalledWith("C:\\out\\copy.pdf");
  });

  it("a document without a path asks where to save; cancelling keeps it dirty", async () => {
    const { store, host, writes, open } = setup();
    await open(null);
    await store.putTextBox(BOX);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(host.pickSavePath).not.toHaveBeenCalled(); // autosave never pops a dialog
    host.pickSavePath.mockResolvedValueOnce(null);
    expect(await store.save()).toBe(false);
    expect(writes).toHaveLength(0);
    expect(store.getState().dirty).toBe(true);
  });

  it("applies edits before the worker answers, then fills in the object number", async () => {
    const { store, client, open } = setup();
    await open();
    let release!: () => void;
    client.putTextBox.mockImplementationOnce(async (b: TextBoxInput) => {
      await new Promise<void>((r) => (release = r));
      return { box: { ...b, id: b.id!, objNum: 77 }, missing: [], pages: [0] };
    });
    const pending = store.putTextBox({ ...BOX, x: 123 });
    expect(store.getState().textBoxes).toMatchObject([{ x: 123, objNum: undefined }]);
    expect(store.getState().textBoxes[0]!.id).toMatch(/^typenote-/);
    release();
    await pending;
    expect(store.getState().textBoxes).toMatchObject([{ x: 123, objNum: 77 }]);
  });

  it("undo/redo walk through creates, edits and deletes, keeping the id", async () => {
    const { store, client, open } = setup();
    await open();
    const { box } = (await store.putTextBox(BOX))!;
    await store.putTextBox({ ...box, text: "나" });
    await store.deleteTextBox(box.id);
    expect(store.getState()).toMatchObject({ textBoxes: [], canUndo: true, canRedo: false });

    await store.undo(); // delete
    expect(store.getState().textBoxes).toMatchObject([{ id: box.id, text: "나" }]);
    await store.undo(); // edit
    expect(store.getState().textBoxes).toMatchObject([{ id: box.id, text: "가" }]);
    await store.undo(); // create
    expect(store.getState()).toMatchObject({ textBoxes: [], canUndo: false, canRedo: true });
    expect(client.deleteTextBox).toHaveBeenLastCalledWith(box.id);

    await store.redo();
    expect(store.getState().textBoxes).toMatchObject([{ id: box.id, text: "가" }]);
    expect(client.putTextBox).toHaveBeenLastCalledWith(expect.objectContaining({ id: box.id, text: "가" }));
    await store.redo();
    expect(store.getState().textBoxes).toMatchObject([{ id: box.id, text: "나" }]);

    // a new edit drops the redo branch
    await store.putTextBox({ ...box, text: "다" });
    expect(store.getState().canRedo).toBe(false);
  });

  it("merges rapid edits with the same key into one undo step", async () => {
    const { store, open } = setup();
    await open();
    const { box } = (await store.putTextBox(BOX))!;
    for (let i = 1; i <= 5; i++) {
      await store.putTextBox({ ...box, x: box.x + i }, { merge: `nudge:${box.id}` });
      await vi.advanceTimersByTimeAsync(200);
    }
    await store.undo();
    expect(store.getState().textBoxes[0]!.x).toBe(box.x);
    await store.undo();
    expect(store.getState().textBoxes).toEqual([]);
  });

  it("rolls back an edit the worker rejects", async () => {
    const { store, client, open } = setup();
    await open();
    const { box } = (await store.putTextBox(BOX))!;
    client.putTextBox.mockRejectedValueOnce(new Error("boom"));
    expect(await store.putTextBox({ ...box, x: 500 })).toBeNull();
    expect(store.getState().textBoxes[0]!.x).toBe(box.x);
    expect(store.getState().editError).toBe("boom");
    await store.undo(); // the rejected edit left no undo step: this undoes the create
    expect(store.getState().textBoxes).toEqual([]);
  });

  it("highlights share the undo history with text boxes", async () => {
    const { store, client, open } = setup();
    await open();
    const { box } = (await store.putTextBox(BOX))!;
    await store.putHighlight(HL);
    expect(store.getState().highlights).toMatchObject([{ id: HL.id, objNum: expect.any(Number) }]);
    await store.putHighlight({ ...HL, color: [1, 0.819611, 0] });
    await store.deleteHighlight(HL.id);
    expect(store.getState().highlights).toEqual([]);

    await store.undo(); // delete
    expect(store.getState().highlights).toMatchObject([{ id: HL.id, color: [1, 0.819611, 0] }]);
    await store.undo(); // color
    expect(store.getState().highlights).toMatchObject([{ color: HL.color }]);
    await store.undo(); // create
    expect(store.getState().highlights).toEqual([]);
    expect(client.deleteHighlight).toHaveBeenLastCalledWith(HL.id);
    await store.undo(); // the text box
    expect(store.getState().textBoxes).toEqual([]);
    expect(store.getState().canUndo).toBe(false);

    await store.redo();
    await store.redo();
    expect(store.getState().textBoxes).toMatchObject([{ id: box.id }]);
    expect(store.getState().highlights).toMatchObject([{ id: HL.id, color: HL.color }]);
  });

  it("dragging the opacity slider is one undo step", async () => {
    const { store, writes, open } = setup();
    await open();
    await store.putHighlight(HL);
    for (const opacity of [0.5, 0.6, 0.7, 0.8]) {
      await store.putHighlight({ ...HL, opacity }, { merge: `opacity:${HL.id}` });
      await vi.advanceTimersByTimeAsync(100);
    }
    await store.undo();
    expect(store.getState().highlights[0]!.opacity).toBe(0.4);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(writes).toHaveLength(1);
  });
});
