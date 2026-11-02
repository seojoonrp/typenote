// MuPDF runs here, off the main thread. One document at a time.
import type * as MuPDF from "mupdf";
import type { DocInfo, ErrorCode, PageSize, RenderParams, RenderResult, Request, Response } from "./protocol";

// mupdf initializes with a top-level await. A static import would delay registering the
// message listener, and messages arriving meanwhile would be dropped, so load it lazily
// and queue handling behind it.
let mupdf: typeof MuPDF;
const ready = import("mupdf").then((m) => {
  mupdf = m;
});

export const APP_NM_PREFIX = "typenote-";
const PAGE_CACHE = 8;

const port = self as unknown as Worker;

let doc: MuPDF.PDFDocument | null = null;
let docId = 0;
/** loaded pages, most recently used last */
const pages = new Map<number, MuPDF.PDFPage>();

class WorkerError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function reply(msg: Response, transfer: Transferable[] = []) {
  port.postMessage(msg, transfer);
}

function fail(id: number, e: unknown) {
  const code = e instanceof WorkerError ? e.code : "failed";
  reply({ id, ok: false, code, message: e instanceof Error ? e.message : String(e) });
}

function closeDoc() {
  for (const p of pages.values()) p.destroy();
  pages.clear();
  doc?.destroy();
  doc = null;
}

function getPage(index: number): MuPDF.PDFPage {
  let page = pages.get(index);
  if (page) {
    pages.delete(index);
  } else {
    page = doc!.loadPage(index);
    if (pages.size >= PAGE_CACHE) {
      const [oldest, p] = pages.entries().next().value!;
      p.destroy();
      pages.delete(oldest);
    }
  }
  pages.set(index, page);
  return page;
}

function open(bytes: ArrayBuffer): DocInfo {
  closeDoc();
  const opened = mupdf.Document.openDocument(new Uint8Array(bytes), "application/pdf");
  if (opened.needsPassword()) {
    opened.destroy();
    throw new WorkerError("needs-password", "암호가 걸린 PDF는 아직 지원하지 않습니다.");
  }
  const pdf = opened.asPDF();
  if (!pdf) {
    opened.destroy();
    throw new WorkerError("not-pdf", "PDF 파일이 아닙니다.");
  }
  doc = pdf;
  docId++;
  const sizes: PageSize[] = [];
  const count = doc.countPages();
  for (let i = 0; i < count; i++) {
    const [x0, y0, x1, y1] = getPage(i).getBounds();
    sizes.push({ width: x1 - x0, height: y1 - y0 });
  }
  return { docId, pageCount: count, pages: sizes };
}

function isAppAnnot(annot: MuPDF.PDFAnnotation): boolean {
  const type = annot.getType();
  if (type === "Highlight") return true;
  if (type !== "FreeText") return false;
  const nm = annot.getObject().get("NM");
  return nm.isString() && nm.asString().startsWith(APP_NM_PREFIX);
}

async function render(p: RenderParams): Promise<RenderResult> {
  if (!doc || p.docId !== docId) throw new WorkerError("stale", "document changed");
  const page = getPage(p.page);
  const annots = page.getAnnotations();
  for (const a of annots) a.setHiddenForEditing(p.hideAppAnnots && isAppAnnot(a));

  const m = mupdf.Matrix.scale(p.scale, p.scale);
  const b = mupdf.Rect.transform(page.getBounds(), m);
  const bbox: MuPDF.Rect = [Math.floor(b[0]), Math.floor(b[1]), Math.ceil(b[2]), Math.ceil(b[3])];
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
    reply({ id: job.id, ok: true, result }, [result.bitmap]);
  } catch (e) {
    fail(job.id, e);
  }
  pumping = false;
  schedule();
}

let inbox: Promise<void> = ready.catch((e: unknown) => {
  console.error("mupdf failed to load", e);
});

port.addEventListener("message", (ev: MessageEvent<Request>) => {
  inbox = inbox.then(() => handle(ev.data));
});

function handle(msg: Request) {
  if (!mupdf) {
    if (msg.kind !== "cancel") reply({ id: msg.id, ok: false, code: "failed", message: "MuPDF를 불러오지 못했습니다." });
    return;
  }
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
    }
  } catch (e) {
    fail(msg.id, e);
  }
}
