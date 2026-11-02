// Hand-built FreeText (typewriter) annotations with our own appearance stream.
// Everything here edits raw PDF objects: never call PDFAnnotation setters + update() on these,
// MuPDF would replace the appearance stream with its own (Helv/Batang, no Pretendard).
import * as mupdf from "mupdf";
import { WEIGHT_OF_RES, type Face } from "./faces";
import { layoutText, PAD, splitLines, type Layout } from "./layout";

export { layoutText, PAD, splitLines, type Layout };
import { NM_PREFIX, type RGB, type TextBox, type Weight } from "./model";

export const fmt = (n: number) => {
  const s = n.toFixed(4).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
};
const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

export function appearanceStream(layout: Layout, face: Face, size: number, color: RGB): string {
  const ops = [
    "q",
    "BT",
    `/${face.resName} ${fmt(size)} Tf`,
    `${color.map(fmt).join(" ")} rg`,
    "0 Tc 100 Tz 0 Tr",
    `${fmt(PAD)} ${fmt(layout.firstBaseline)} Td`,
    `${fmt(layout.lineHeight)} TL`,
  ];
  layout.lines.forEach((line, i) => {
    if (i > 0) ops.push("T*");
    if (line.gids.length) ops.push(`<${line.gids.map(hex4).join("")}> Tj`);
  });
  ops.push("ET", "Q");
  return ops.join("\n") + "\n";
}

export function pdfDate(d = new Date()): string {
  const p = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${sign}${p(Math.trunc(off / 60))}'${p(off % 60)}'`;
}

export function utf16beWithBOM(s: string): Uint8Array {
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xfe;
  out[1] = 0xff;
  for (let i = 0; i < s.length; i++) {
    out[2 + 2 * i] = s.charCodeAt(i) >> 8;
    out[3 + 2 * i] = s.charCodeAt(i) & 0xff;
  }
  return out;
}

/**
 * Form matrix so that form space (y-up) lands upright in MuPDF page space (y-down):
 * concat(M, ctmLinear) == [1 0 0 -1 0 0]  =>  M = concat(flip, invert(ctmLinear)).
 */
export function uprightFormMatrix(pageCtm: mupdf.Matrix): mupdf.Matrix {
  const linear: mupdf.Matrix = [pageCtm[0], pageCtm[1], pageCtm[2], pageCtm[3], 0, 0];
  const m = mupdf.Matrix.concat([1, 0, 0, -1, 0, 0], mupdf.Matrix.invert(linear));
  return m.map((v) => Math.round(v)) as mupdf.Matrix;
}

const normalize = (r: mupdf.Rect): mupdf.Rect => [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];

/** MuPDF page-space rect (y-down, rotation applied) <-> PDF user-space /Rect. */
export const pageRectToUser = (ctm: mupdf.Matrix, r: mupdf.Rect) => normalize(mupdf.Rect.transform(r, mupdf.Matrix.invert(ctm)));
export const userRectToPage = (ctm: mupdf.Matrix, r: mupdf.Rect) => normalize(mupdf.Rect.transform(r, ctm));

/** The /AP /N stream (picking /AS state if /N is a dict of states). */
export function normalAppearance(annot: mupdf.PDFObject): mupdf.PDFObject | null {
  const n = annot.get("AP", "N");
  if (n.isNull()) return null;
  if (n.isStream()) return n;
  const as = annot.get("AS");
  if (as.isName()) {
    const s = n.get(as.asName());
    if (s.isStream()) return s;
  }
  return null;
}

// --- model <-> objects ---------------------------------------------------------------------

const isAppFreeText = (a: mupdf.PDFObject) =>
  a.get("Subtype").isName() && a.get("Subtype").asName() === "FreeText" && a.get("NM").isString() && a.get("NM").asString().startsWith(NM_PREFIX);

/** Weight, size and color from /DA, e.g. "/PS 18 Tf 0.05 0.3 0.85 rg". */
export function parseDA(da: string): { weight: Weight; resName: string; size: number; color: RGB } | null {
  const font = /\/(\w+)\s+([\d.]+)\s+Tf/.exec(da);
  const rgb = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
  const weight = font ? WEIGHT_OF_RES[font[1]!] : undefined;
  if (!font || !weight) return null;
  const color: RGB = rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : [0, 0, 0];
  return { weight, resName: font[1]!, size: Number(font[2]), color };
}

export type LocatedFreeText = { page: number; annot: mupdf.PDFObject };

/** App FreeText annotation refs by page, without loading pages. */
export function locateAppFreeTexts(doc: mupdf.PDFDocument): LocatedFreeText[] {
  const found: LocatedFreeText[] = [];
  const count = doc.countPages();
  for (let i = 0; i < count; i++) {
    doc.findPage(i).get("Annots").forEach((a) => {
      if (isAppFreeText(a)) found.push({ page: i, annot: a });
    });
  }
  return found;
}

export function locateFreeText(doc: mupdf.PDFDocument, id: string): LocatedFreeText | undefined {
  return locateAppFreeTexts(doc).find((f) => f.annot.get("NM").asString() === id);
}

const contentsText = (annot: mupdf.PDFObject) => (annot.get("Contents").isString() ? annot.get("Contents").asString() : "").replace(/\r\n?/g, "\n");

/** All app text boxes, as the UI model. */
export function readTextBoxes(doc: mupdf.PDFDocument): TextBox[] {
  const boxes: TextBox[] = [];
  const ctms = new Map<number, mupdf.Matrix>();
  for (const { page, annot } of locateAppFreeTexts(doc)) {
    const da = parseDA(annot.get("DA").isString() ? annot.get("DA").asString() : "");
    if (!da) continue;
    let ctm = ctms.get(page);
    if (!ctm) {
      const p = doc.loadPage(page);
      ctm = p.getTransform();
      p.destroy();
      ctms.set(page, ctm);
    }
    const r = annot.get("Rect");
    const rect = userRectToPage(ctm, [0, 1, 2, 3].map((k) => r.get(k).asNumber()) as mupdf.Rect);
    boxes.push({
      id: annot.get("NM").asString(),
      page,
      x: rect[0],
      y: rect[1],
      text: contentsText(annot),
      size: da.size,
      weight: da.weight,
      color: da.color,
      objNum: annot.asIndirect(),
    });
  }
  return boxes;
}

/** Codepoints used per weight across all app text boxes. */
export function usedCodepoints(doc: mupdf.PDFDocument): Record<Weight, Set<number>> {
  const sets: Record<Weight, Set<number>> = { regular: new Set(), semibold: new Set() };
  for (const { annot } of locateAppFreeTexts(doc)) {
    const da = parseDA(annot.get("DA").isString() ? annot.get("DA").asString() : "");
    if (!da) continue;
    for (const ch of contentsText(annot).replace(/\n/g, "")) sets[da.weight].add(ch.codePointAt(0)!);
  }
  return sets;
}

/** Shared Type0 font refs already used by app text boxes, keyed by weight. */
export function findSharedFonts(doc: mupdf.PDFDocument): Partial<Record<Weight, mupdf.PDFObject>> {
  const out: Partial<Record<Weight, mupdf.PDFObject>> = {};
  for (const { annot } of locateAppFreeTexts(doc)) {
    const da = parseDA(annot.get("DA").isString() ? annot.get("DA").asString() : "");
    const font = da && normalAppearance(annot)?.get("Resources", "Font", da.resName);
    if (da && font?.isIndirect()) out[da.weight] ??= font;
  }
  return out;
}

/**
 * Creates the box (when `existing` is undefined) or rewrites an existing one in place, keeping
 * its annotation and appearance object numbers. The box must live on `existing`'s page.
 */
export function writeFreeText(
  doc: mupdf.PDFDocument,
  face: Face,
  type0: mupdf.PDFObject,
  box: TextBox,
  existing?: mupdf.PDFObject,
): { annot: mupdf.PDFObject; missing: string[] } {
  const layout = layoutText(box.text, face, box.size);
  const page = doc.loadPage(box.page);
  const ctm = page.getTransform();
  const pageObj = page.getObject();
  page.destroy();
  const rotate = pageObj.getInheritable("Rotate");
  const rotation = rotate.isNull() ? 0 : ((rotate.asNumber() % 360) + 360) % 360;
  const rect = pageRectToUser(ctm, [box.x, box.y, box.x + layout.width, box.y + layout.height]);
  const matrix = uprightFormMatrix(ctm);
  const content = appearanceStream(layout, face, box.size, box.color);
  const formDict = {
    BBox: [0, 0, layout.width, layout.height],
    Matrix: matrix,
    Resources: { Font: { [face.resName]: type0 } },
  };
  const da = `/${face.resName} ${fmt(box.size)} Tf ${box.color.map(fmt).join(" ")} rg`;
  const contents = doc.newByteString(utf16beWithBOM(splitLines(box.text).join("\r")));
  const now = pdfDate();

  if (existing) {
    const form = existing.get("AP", "N");
    form.writeStream(content);
    for (const [k, v] of Object.entries(formDict)) form.put(k, v);
    existing.put("Rect", rect);
    existing.put("Contents", contents);
    existing.put("DA", `(${da})`);
    existing.put("M", `(${now})`);
    if (rotation) existing.put("Rotate", rotation);
    else existing.delete("Rotate");
    return { annot: existing, missing: layout.missing };
  }

  const form = doc.addStream(content, { Type: "XObject", Subtype: "Form", ...formDict });
  const dict: Record<string, unknown> = {
    Type: "Annot",
    Subtype: "FreeText",
    Rect: rect,
    F: 4,
    IT: "FreeTextTypeWriter",
    Contents: contents,
    DA: `(${da})`,
    NM: `(${box.id})`,
    M: `(${now})`,
    CreationDate: `(${now})`,
    BS: { W: 0 },
    P: pageObj,
    AP: { N: form },
  };
  if (rotation) dict.Rotate = rotation;
  const annot = doc.addObject(dict);
  let annots = pageObj.get("Annots");
  if (annots.isNull()) {
    pageObj.put("Annots", doc.newArray());
    annots = pageObj.get("Annots");
  }
  annots.push(annot);
  return { annot, missing: layout.missing };
}

/** Removes the box from its page and frees its annotation and appearance objects. */
export function removeFreeText(doc: mupdf.PDFDocument, { page, annot }: LocatedFreeText) {
  const annots = doc.findPage(page).get("Annots");
  const num = annot.asIndirect();
  for (let i = annots.length - 1; i >= 0; i--) {
    if (annots.get(i).asIndirect() === num) annots.delete(i);
  }
  const ap = annot.get("AP", "N");
  if (ap.isIndirect()) doc.deleteObject(ap.asIndirect());
  doc.deleteObject(num);
}
