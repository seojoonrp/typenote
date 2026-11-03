// Worker-side document session: one open document, page rendering, text box edits and saving.
// Loaded lazily by worker.ts (mupdf initializes with a top-level await).
import * as mupdf from "mupdf";
import hbSubsetUrl from "harfbuzzjs/dist/harfbuzz-subset.wasm?url";
import regularUrl from "../../fonts/Pretendard-Regular.ttf?url";
import semiboldUrl from "../../fonts/Pretendard-SemiBold.ttf?url";
import { PdfEditor } from "./engine/editor";
import { makeFaces, type FontKit } from "./engine/fonts";
import { fitQuadsToGlyphs, pageGlyphs, type Glyph } from "./engine/glyphs";
import { NM_PREFIX } from "./engine/model";
import { createSubsetter } from "./engine/subset";
import type { Quad } from "./engine/model";
import type { ErrorCode, HiddenAnnots, OpenResult, PutHighlightResult, SelectTextParams, SelectTextResult, PageSize, PutTextBoxResult, RenderParams, RenderResult, Request, Response, SaveResult } from "./protocol";

const PAGE_CACHE = 8;

export type Reply = (msg: Response, transfer?: Transferable[]) => void;

class SessionError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// --- fonts + hb-subset, fetched once on first need ----------------------------------------
let kitPromise: Promise<FontKit> | null = null;

async function fetchBytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function loadKit(): Promise<FontKit> {
  kitPromise ??= (async () => {
    const [regular, semibold, wasm] = await Promise.all([fetchBytes(regularUrl), fetchBytes(semiboldUrl), fetchBytes(hbSubsetUrl)]);
    return { faces: makeFaces({ regular, semibold }), subsetter: await createSubsetter(wasm) };
  })().catch((e: unknown) => {
    kitPromise = null; // let the next edit retry
    throw e;
  });
  return kitPromise;
}

// --- document state -----------------------------------------------------------------------
let editor: PdfEditor | null = null;
let docId = 0;
/** loaded pages, most recently used last */
const pages = new Map<number, mupdf.PDFPage>();

function dropPages(indexes?: number[]) {
  for (const [i, p] of pages) {
    if (!indexes || indexes.includes(i)) {
      p.destroy();
      pages.delete(i);
    }
  }
}

// page text (annotations excluded) for highlight selection, kept until the document is reopened;
// the glyph outlines are gathered on the first selection on the page
type PageText = { st: mupdf.StructuredText; lines: mupdf.Rect[]; glyphs: Glyph[] | null };
const texts = new Map<number, PageText>();

function pageText(index: number): PageText {
  let t = texts.get(index);
  if (!t) {
    const st = getPage(index).toStructuredText("preserve-whitespace");
    const lines: mupdf.Rect[] = [];
    st.walk({ beginLine: (bbox) => void lines.push(bbox) });
    texts.set(index, (t = { st, lines, glyphs: null }));
  }
  return t;
}

/** pt of slack around a text line in which a press still counts as "on the text" */
const LINE_SLOP = 1;

const onText = (t: PageText, [x, y]: [number, number]) =>
  t.lines.some((b) => x >= b[0] - LINE_SLOP && x <= b[2] + LINE_SLOP && y >= b[1] - LINE_SLOP && y <= b[3] + LINE_SLOP);

/** Line quads of the selection, fitted to the letters' height (no band above and below them). */
function selectText({ page, from, to, mode }: SelectTextParams): SelectTextResult {
  const t = pageText(page);
  if (!onText(t, from)) return [];
  let quads: Quad[];
  if (mode === "word") {
    const q = t.st.snap(from, from, "words") as Quad;
    quads = q[2] - q[0] > 0.1 || q[3] - q[1] > 0.1 ? [q] : [];
  } else {
    quads = t.st.highlight(from, to, 1000) as Quad[];
  }
  if (quads.length === 0) return quads;
  t.glyphs ??= pageGlyphs(getPage(page));
  return fitQuadsToGlyphs(quads, t.glyphs);
}

/** The text of the same selection, for the clipboard. */
function copyText({ page, from, to, mode }: SelectTextParams): string {
  const t = pageText(page);
  if (!onText(t, from)) return "";
  if (mode === "word") {
    const q = t.st.snap(from, from, "words") as Quad;
    // from the middle of the word's left edge to the middle of its right edge
    return t.st.copy([(q[0] + q[4]) / 2, (q[1] + q[5]) / 2], [(q[2] + q[6]) / 2, (q[3] + q[7]) / 2]);
  }
  return t.st.copy(from, to);
}

function closeDoc() {
  dropPages();
  for (const t of texts.values()) t.st.destroy();
  texts.clear();
  editor?.doc.destroy();
  editor = null;
}

function current(): PdfEditor {
  if (!editor) throw new SessionError("no-document", "No document is open.");
  return editor;
}

function getPage(index: number): mupdf.PDFPage {
  let page = pages.get(index);
  if (page) {
    pages.delete(index);
  } else {
    page = current().doc.loadPage(index);
    if (pages.size >= PAGE_CACHE) {
      const [oldest, p] = pages.entries().next().value!;
      p.destroy();
      pages.delete(oldest);
    }
  }
  pages.set(index, page);
  return page;
}

function open(bytes: ArrayBuffer): OpenResult {
  closeDoc();
  const opened = mupdf.Document.openDocument(new Uint8Array(bytes), "application/pdf");
  if (opened.needsPassword()) {
    opened.destroy();
    throw new SessionError("needs-password", "Password-protected PDFs are not supported.");
  }
  const pdf = opened.asPDF();
  if (!pdf) {
    opened.destroy();
    throw new SessionError("not-pdf", "This is not a PDF file.");
  }
  editor = new PdfEditor(pdf, loadKit);
  docId++;
  const sizes: PageSize[] = [];
  const count = pdf.countPages();
  for (let i = 0; i < count; i++) {
    const [x0, y0, x1, y1] = getPage(i).getBounds();
    sizes.push({ width: x1 - x0, height: y1 - y0 });
  }
  void loadKit().catch(() => {}); // warm up so the first edit is quick
  return { docId, pageCount: count, pages: sizes, textBoxes: editor.textBoxes(), highlights: editor.highlights() };
}

/** Saves, then continues from the saved bytes so the next incremental save appends to them. */
async function save(full: boolean): Promise<SaveResult> {
  const { bytes, mode } = await current().save(full);
  const next = new PdfEditor(new mupdf.PDFDocument(bytes), loadKit);
  closeDoc();
  editor = next;
  return { bytes, mode, textBoxes: next.textBoxes(), highlights: next.highlights() };
}

function isHidden(annot: mupdf.PDFAnnotation, hide: HiddenAnnots): boolean {
  const type = annot.getType();
  if (type === "Highlight") return hide.highlights;
  if (type !== "FreeText" || !hide.textBoxes) return false;
  const nm = annot.getObject().get("NM");
  return nm.isString() && nm.asString().startsWith(NM_PREFIX);
}

async function render(p: RenderParams): Promise<RenderResult> {
  if (!editor || p.docId !== docId) throw new SessionError("stale", "document changed");
  const page = getPage(p.page);
  for (const a of page.getAnnotations()) a.setHiddenForEditing(isHidden(a, p.hide));

  const m = mupdf.Matrix.scale(p.scale, p.scale);
  const b = mupdf.Rect.transform(page.getBounds(), m);
  const bbox: mupdf.Rect = [Math.floor(b[0]), Math.floor(b[1]), Math.ceil(b[2]), Math.ceil(b[3])];
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, true);
  try {
    pix.clear(255);
    const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
    page.run(dev, m);
    dev.close();
    dev.destroy();
    const width = pix.getWidth();
    const height = pix.getHeight();
    if (pix.getStride() !== width * 4) throw new Error(`unexpected stride ${pix.getStride()}`);
    // getPixels() views WASM memory, which may move: copy before anything else allocates
    const data = new ImageData(new Uint8ClampedArray(pix.getPixels()), width, height);
    const bitmap = await createImageBitmap(data);
    return { bitmap, width, height };
  } finally {
    pix.destroy();
  }
}

// --- render queue: one job per macrotask so "cancel" messages can land in between ---------
type Job = RenderParams & { id: number; seq: number };
let queue: Job[] = [];
let seq = 0;
let pumping = false;
let replyTo: Reply = () => {};
// a MessageChannel task instead of setTimeout(0): no 4ms clamping, no background-timer throttling
const tick = new MessageChannel();
tick.port1.onmessage = () => void pump();

function schedule() {
  if (pumping || queue.length === 0) return;
  pumping = true;
  tick.port2.postMessage(null);
}

async function pump() {
  queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
  const job = queue.shift()!;
  try {
    const result = await render(job);
    replyTo({ id: job.id, ok: true, result }, [result.bitmap]);
  } catch (e) {
    fail(replyTo, job.id, e);
  }
  pumping = false;
  schedule();
}

function fail(reply: Reply, id: number, e: unknown) {
  const code = e instanceof SessionError ? e.code : "failed";
  reply({ id, ok: false, code, message: e instanceof Error ? e.message : String(e) });
}

export async function handle(msg: Request, reply: Reply) {
  replyTo = reply;
  try {
    switch (msg.kind) {
      case "open": {
        for (const job of queue) reply({ id: job.id, ok: false, code: "stale", message: "document changed" });
        queue = [];
        reply({ id: msg.id, ok: true, result: open(msg.bytes) });
        break;
      }
      case "close":
        closeDoc();
        reply({ id: msg.id, ok: true, result: null });
        break;
      case "render": {
        const { id, kind: _kind, ...params } = msg;
        queue.push({ ...params, id, seq: seq++ });
        schedule();
        break;
      }
      case "cancel": {
        const ids = new Set(msg.ids);
        for (const job of queue) if (ids.has(job.id)) reply({ id: job.id, ok: false, code: "cancelled", message: "cancelled" });
        queue = queue.filter((job) => !ids.has(job.id));
        break;
      }
      case "putTextBox": {
        const result: PutTextBoxResult = await current().putTextBox(msg.box);
        dropPages(result.pages);
        reply({ id: msg.id, ok: true, result });
        break;
      }
      case "deleteTextBox": {
        const page = current().deleteTextBox(msg.boxId);
        if (page !== null) dropPages([page]);
        reply({ id: msg.id, ok: true, result: page });
        break;
      }
      case "putHighlight": {
        const result: PutHighlightResult = current().putHighlight(msg.highlight);
        dropPages(result.pages);
        reply({ id: msg.id, ok: true, result });
        break;
      }
      case "deleteHighlight": {
        const page = current().deleteHighlight(msg.highlightId);
        if (page !== null) dropPages([page]);
        reply({ id: msg.id, ok: true, result: page });
        break;
      }
      case "selectText": {
        const { id, kind: _kind, ...params } = msg;
        reply({ id, ok: true, result: selectText(params) });
        break;
      }
      case "textLines": {
        reply({ id: msg.id, ok: true, result: pageText(msg.page).lines });
        break;
      }
      case "copyText": {
        const { id, kind: _kind, ...params } = msg;
        reply({ id, ok: true, result: copyText(params) });
        break;
      }
      case "save": {
        const result = await save(msg.full);
        reply({ id: msg.id, ok: true, result }, [result.bytes.buffer]);
        break;
      }
    }
  } catch (e) {
    fail(reply, msg.id, e);
  }
}
