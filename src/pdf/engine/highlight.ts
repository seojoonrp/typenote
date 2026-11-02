// Highlight annotations: read from any producer, written with our own appearance stream
// (flat quads in a transparency group, composited with Multiply at the annotation's opacity,
// the same structure Acrobat uses). Raw objects only, like the text boxes.
import * as mupdf from "mupdf";
import { fmt, pdfDate } from "./freetext";
import type { Highlight, Quad, RGB } from "./model";

export type LocatedHighlight = { page: number; annot: mupdf.PDFObject; id: string };

const isHighlight = (a: mupdf.PDFObject) => a.get("Subtype").isName() && a.get("Subtype").asName() === "Highlight";
const idOf = (a: mupdf.PDFObject) => (a.get("NM").isString() && a.get("NM").asString() ? a.get("NM").asString() : `obj:${a.asIndirect()}`);

export function locateHighlights(doc: mupdf.PDFDocument): LocatedHighlight[] {
  const found: LocatedHighlight[] = [];
  const count = doc.countPages();
  for (let i = 0; i < count; i++) {
    doc.findPage(i).get("Annots").forEach((a) => {
      if (a.isIndirect() && isHighlight(a)) found.push({ page: i, annot: a, id: idOf(a) });
    });
  }
  return found;
}

export const locateHighlight = (doc: mupdf.PDFDocument, id: string) => locateHighlights(doc).find((h) => h.id === id);

const apply = (m: mupdf.Matrix, x: number, y: number): [number, number] => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
const mapQuad = (m: mupdf.Matrix, q: Quad): Quad => [...apply(m, q[0], q[1]), ...apply(m, q[2], q[3]), ...apply(m, q[4], q[5]), ...apply(m, q[6], q[7])];

/** PDF reals come back as float32 (0.4 -> 0.4000000059604645) */
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** /C in any color space -> RGB (empty or missing: our default cyan). */
function rgbOf(c: mupdf.PDFObject): RGB {
  const v = c.isArray() ? [...Array(c.length)].map((_, i) => round6(c.get(i).asNumber())) : [];
  if (v.length === 1) return [v[0]!, v[0]!, v[0]!];
  if (v.length === 3) return v as RGB;
  if (v.length === 4) {
    const [cy, m, y, k] = v as [number, number, number, number];
    return [(1 - cy) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
  }
  return [0.219604, 0.898041, 1];
}

const ctmOf = (doc: mupdf.PDFDocument, page: number) => {
  const p = doc.loadPage(page);
  const ctm = p.getTransform();
  p.destroy();
  return ctm;
};

export function readHighlights(doc: mupdf.PDFDocument): Highlight[] {
  const ctms = new Map<number, mupdf.Matrix>();
  return locateHighlights(doc).map(({ page, annot, id }) => {
    let ctm = ctms.get(page);
    if (!ctm) ctms.set(page, (ctm = ctmOf(doc, page)));
    const qp = annot.get("QuadPoints");
    const quads: Quad[] = [];
    for (let i = 0; i + 7 < qp.length; i += 8) {
      quads.push(mapQuad(ctm, [0, 1, 2, 3, 4, 5, 6, 7].map((k) => qp.get(i + k).asNumber()) as Quad));
    }
    const ca = annot.get("CA");
    return { id, page, quads, color: rgbOf(annot.get("C")), opacity: ca.isNumber() ? round6(ca.asNumber()) : 1, objNum: annot.asIndirect() };
  });
}

/**
 * Appearance: an outer form applies Multiply and the opacity to an inner transparency group
 * holding the opaque quads, so overlapping line quads don't darken twice.
 */
function appearance(doc: mupdf.PDFDocument, quads: Quad[], bbox: mupdf.Rect, color: RGB, opacity: number): mupdf.PDFObject {
  const pt = (x: number, y: number) => `${fmt(x)} ${fmt(y)}`;
  let fill = `${color.map(fmt).join(" ")} rg\n`;
  for (const q of quads) fill += `${pt(q[4], q[5])} m ${pt(q[6], q[7])} l ${pt(q[2], q[3])} l ${pt(q[0], q[1])} l h f\n`;
  const group = doc.addStream(fill, {
    Type: "XObject",
    Subtype: "Form",
    BBox: bbox,
    Group: { Type: "Group", S: "Transparency" },
    Resources: {},
  });
  return doc.addStream("/GS gs\n/Fm Do\n", {
    Type: "XObject",
    Subtype: "Form",
    BBox: bbox,
    Resources: {
      ExtGState: { GS: { Type: "ExtGState", BM: "Multiply", CA: opacity, ca: opacity } },
      XObject: { Fm: group },
    },
  });
}

/** Creates the highlight, or rewrites `existing` in place (same annotation object, new appearance). */
export function writeHighlight(doc: mupdf.PDFDocument, h: Highlight, existing?: mupdf.PDFObject): mupdf.PDFObject {
  const page = doc.loadPage(h.page);
  const inv = mupdf.Matrix.invert(page.getTransform());
  const pageObj = page.getObject();
  page.destroy();
  const quads = h.quads.map((q) => mapQuad(inv, q));
  const xs = quads.flatMap((q) => [q[0], q[2], q[4], q[6]]);
  const ys = quads.flatMap((q) => [q[1], q[3], q[5], q[7]]);
  const bbox: mupdf.Rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const opacity = Math.round(Math.min(1, Math.max(0, h.opacity)) * 1000) / 1000;
  const ap = appearance(doc, quads, bbox, h.color, opacity);
  const now = `(${pdfDate()})`;
  const fields = {
    Rect: bbox,
    QuadPoints: quads.flat(),
    C: h.color,
    CA: opacity,
    M: now,
    AP: { N: ap },
  };
  if (existing) {
    const old = existing.get("AP", "N");
    for (const [k, v] of Object.entries(fields)) existing.put(k, v);
    if (old.isIndirect()) doc.deleteObject(old.asIndirect());
    return existing;
  }
  const annot = doc.addObject({ Type: "Annot", Subtype: "Highlight", F: 4, NM: `(${h.id})`, CreationDate: now, P: pageObj, ...fields });
  let annots = pageObj.get("Annots");
  if (annots.isNull()) {
    pageObj.put("Annots", doc.newArray());
    annots = pageObj.get("Annots");
  }
  annots.push(annot);
  return annot;
}

/** Removes the highlight and its popup note (Acrobat adds one) from the page and frees them. */
export function removeHighlight(doc: mupdf.PDFDocument, { page, annot }: LocatedHighlight) {
  const popup = annot.get("Popup");
  const gone = new Set([annot.asIndirect(), ...(popup.isIndirect() ? [popup.asIndirect()] : [])]);
  const annots = doc.findPage(page).get("Annots");
  for (let i = annots.length - 1; i >= 0; i--) {
    const a = annots.get(i);
    if (a.isIndirect() && gone.has(a.asIndirect())) annots.delete(i);
  }
  const ap = annot.get("AP", "N");
  if (ap.isIndirect()) doc.deleteObject(ap.asIndirect());
  for (const num of gone) doc.deleteObject(num);
}
