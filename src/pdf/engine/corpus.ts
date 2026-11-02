// Compatibility corpus (tests and tools/compat-render.ts only, not used by the app): PDFs that
// differ in file structure, and the edit/save/reopen round trip the app must survive on each.
import * as mupdf from "mupdf";
import { PdfEditor } from "./editor";
import type { FontKit } from "./fonts";
import { newHighlightId, NM_PREFIX, type Highlight, type Quad, type RGB, type TextBox } from "./model";

export type Variant = { name: string; bytes: Uint8Array; encrypted?: boolean; repaired?: boolean };

const LINES = ["The quick brown fox jumps over the lazy dog.", "Second line of base text to highlight.", "Third line: 0123456789"];

/** p1 A4, p2 /Rotate 90, p3 /Rotate 270 with an offset CropBox; a few lines of Helvetica each. */
function baseDocument(): mupdf.PDFDocument {
  const doc = new mupdf.PDFDocument();
  const helv = doc.addSimpleFont(new mupdf.Font("Helvetica"), "Latin");
  const text = `BT /F1 12 Tf 56 780 Td 16 TL ${LINES.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
  const specs: { rotate: mupdf.Rotate; crop?: mupdf.Rect }[] = [{ rotate: 0 }, { rotate: 90 }, { rotate: 270, crop: [30, 40, 565, 800] }];
  for (const s of specs) {
    const page = doc.addPage([0, 0, 595, 842], s.rotate, { Font: { F1: helv } }, text);
    doc.insertPage(-1, page);
    if (s.crop) page.put("CropBox", s.crop);
  }
  return doc;
}

const save = (doc: mupdf.PDFDocument, options: string) => doc.saveToBuffer(options).asUint8Array().slice();

/** Points startxref past the end of the file, so readers have to rebuild the xref. */
function breakStartxref(bytes: Uint8Array): Uint8Array {
  const s = new TextDecoder("latin1").decode(bytes);
  const at = s.lastIndexOf("startxref");
  const m = /startxref\s+(\d+)/.exec(s.slice(at))!;
  const start = at + m.index + m[0].length - m[1]!.length;
  const out = bytes.slice();
  for (let i = 0; i < m[1]!.length; i++) out[start + i] = 0x39; // "999…"
  return out;
}

/** /Rotate and /MediaBox (with a non-zero origin) inherited from the page tree root. */
function inheritedAttributes(): mupdf.PDFDocument {
  const doc = baseDocument();
  const root = doc.getTrailer().get("Root", "Pages");
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.findPage(i);
    for (const key of ["Rotate", "MediaBox", "CropBox"]) page.delete(key);
  }
  root.put("Rotate", 90);
  root.put("MediaBox", [20, 30, 615, 872]);
  return doc;
}

/** Annotations made by "another program" (MuPDF's own API), with /Annots as an indirect array. */
function foreignAnnotations(): mupdf.PDFDocument {
  const doc = baseDocument();
  const page = doc.loadPage(0);
  const note = page.createAnnotation("FreeText");
  note.setRect([300, 400, 540, 430]);
  note.setContents("Foreign FreeText (Helv)");
  note.update();
  const hl = page.createAnnotation("Highlight");
  hl.setQuadPoints(lineQuads(doc, 0, 2));
  hl.setColor([1, 1, 0]);
  hl.update();
  const sticky = page.createAnnotation("Text");
  sticky.setRect([540, 60, 560, 80]);
  sticky.setContents("sticky note");
  sticky.update();
  const obj = page.getObject();
  obj.put("Annots", doc.addObject(obj.get("Annots")));
  return doc;
}

export function variants(): Variant[] {
  const classic = save(baseDocument(), "compress");
  return [
    { name: "classic-xref", bytes: classic },
    { name: "xref-stream", bytes: save(baseDocument(), "compress,objstms") },
    { name: "aes256-owner-only", bytes: save(baseDocument(), "compress,encrypt=aes-256,owner-password=owner"), encrypted: true },
    { name: "rc4-128-owner-only", bytes: save(baseDocument(), "compress,encrypt=rc4-128,owner-password=owner"), encrypted: true },
    { name: "broken-xref", bytes: breakStartxref(classic), repaired: true },
    { name: "inherited-rotate-mediabox", bytes: save(inheritedAttributes(), "compress") },
    { name: "foreign-annots", bytes: save(foreignAnnotations(), "compress") },
  ];
}

/** Quads of text line `line` (0-based) on a page, as the highlight tool would select it. */
export function lineQuads(doc: mupdf.PDFDocument, pageIndex: number, line = 0): Quad[] {
  const page = doc.loadPage(pageIndex);
  const st = page.toStructuredText("preserve-whitespace");
  const json = JSON.parse(st.asJSON()) as { blocks: { lines?: { bbox: { x: number; y: number; w: number; h: number } }[] }[] };
  const lines = json.blocks.flatMap((b) => b.lines ?? []);
  const { x, y, w, h } = lines[line]!.bbox;
  // corner to corner, as a drag from just inside the first glyph to just inside the last
  const quads = st.highlight([x + 0.5, y + h / 2], [x + w - 0.5, y + h / 2]) as Quad[];
  st.destroy();
  page.destroy();
  return quads;
}

function openPdf(bytes: Uint8Array): mupdf.PDFDocument {
  const opened = mupdf.Document.openDocument(bytes, "application/pdf");
  if (opened.needsPassword()) throw new Error("needs a password");
  return opened.asPDF()!;
}

export type AnnotCounts = Record<string, number>;

/** Annotation subtypes in the file, app FreeTexts counted apart as "FreeText(app)". */
export function annotCounts(doc: mupdf.PDFDocument): AnnotCounts {
  const counts: AnnotCounts = {};
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    for (const a of page.getAnnotations()) {
      const nm = a.getObject().get("NM");
      const type = a.getType() === "FreeText" && nm.isString() && nm.asString().startsWith(NM_PREFIX) ? "FreeText(app)" : a.getType();
      counts[type] = (counts[type] ?? 0) + 1;
    }
    page.destroy();
  }
  return counts;
}

/** What MuPDF itself extracts from each app box's appearance (checks fonts and decryption). */
export function extractedBoxText(doc: mupdf.PDFDocument): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    for (const a of page.getAnnotations()) {
      const nm = a.getObject().get("NM");
      if (a.getType() !== "FreeText" || !nm.isString() || !nm.asString().startsWith(NM_PREFIX)) continue;
      out.set(nm.asString(), a.toDisplayList().toStructuredText("preserve-whitespace").asText().replace(/\n+$/, ""));
    }
    page.destroy();
  }
  return out;
}

const CYAN: RGB = [0.219604, 0.898041, 1];
const YELLOW: RGB = [1, 0.819611, 0];

export type RoundTrip = {
  first: { bytes: Uint8Array; mode: string };
  second: { bytes: Uint8Array; mode: string };
  /** after the first save, before any edit: did the saved file need repairing? */
  repairedAfterFirst: boolean;
  repairedAfterSecond: boolean;
  before: AnnotCounts;
  after: AnnotCounts;
  boxes: TextBox[];
  highlights: Highlight[];
  expected: { box: Omit<TextBox, "objNum">; highlights: Omit<Highlight, "objNum">[] };
  extracted: Map<string, string>;
  encrypted: boolean;
};

/**
 * Two editing sessions like the app's: add two boxes and a highlight, save; reopen the saved
 * bytes, edit and move a box, delete the other, recolor the highlight, add one on page 2, save.
 */
export async function editRoundTrip(bytes: Uint8Array, loadKit: () => Promise<FontKit>): Promise<RoundTrip> {
  const doc1 = openPdf(bytes);
  const before = annotCounts(doc1);
  const ed1 = new PdfEditor(doc1, loadKit);
  const last = doc1.countPages() - 1;
  const a = (await ed1.putTextBox({ page: 0, x: 56, y: 300, text: "호환성 확인 상자 Compat 123\n둘째 줄", size: 14, weight: "regular", color: [0.1, 0.2, 0.8] })).box;
  const b = (await ed1.putTextBox({ page: last, x: 56, y: 200, text: "마지막 쪽 굵은 글씨", size: 12, weight: "semibold", color: [0.8, 0.1, 0.1] })).box;
  const h1 = ed1.putHighlight({ id: newHighlightId(), page: 0, quads: lineQuads(doc1, 0, 0), color: CYAN, opacity: 0.4 }).highlight;
  const first = await ed1.save();

  const doc2 = openPdf(first.bytes);
  const repairedAfterFirst = doc2.wasRepaired();
  const ed2 = new PdfEditor(doc2, loadKit);
  const editedBox = { ...a, x: a.x + 10, y: a.y + 20, text: "수정된 상자 Edited\n둘째 줄 그대로" };
  await ed2.putTextBox(editedBox);
  ed2.deleteTextBox(b.id);
  const h1b = { ...h1, color: YELLOW, opacity: 0.6 };
  ed2.putHighlight(h1b);
  const h2 = ed2.putHighlight({ id: newHighlightId(), page: Math.min(1, last), quads: lineQuads(doc2, Math.min(1, last), 1), color: CYAN, opacity: 0.4 }).highlight;
  const second = await ed2.save();

  const doc3 = openPdf(second.bytes);
  const ed3 = new PdfEditor(doc3, loadKit);
  const { objNum: _a, ...box } = editedBox;
  void _a;
  const strip = ({ objNum: _o, ...rest }: Highlight) => (void _o, rest);
  return {
    first,
    second,
    repairedAfterFirst,
    repairedAfterSecond: doc3.wasRepaired(),
    before,
    after: annotCounts(doc3),
    boxes: ed3.textBoxes(),
    highlights: ed3.highlights(),
    expected: { box, highlights: [strip(h1b as Highlight), strip(h2)] },
    extracted: extractedBoxText(doc3),
    encrypted: doc3.getTrailer().get("Encrypt").isDictionary(),
  };
}
