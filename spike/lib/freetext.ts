// Hand-built FreeText (typewriter) annotations with our own appearance stream.
import { randomUUID } from "node:crypto";
import * as mupdf from "mupdf";
import type { Face, Faces, Weight } from "./fonts.ts";
import { WEIGHT_OF_RES } from "./fonts.ts";

export const NM_PREFIX = "typenote-";
export const PAD = 2;

export type RGB = [number, number, number];
export type BoxSpec = { x: number; y: number; text: string; size: number; weight: Weight; color: RGB };

export type Layout = {
  lines: { text: string; gids: number[]; width: number }[];
  width: number;
  height: number;
  lineHeight: number;
  firstBaseline: number;
  missing: string[];
};

export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

export function layoutText(text: string, face: Face, size: number): Layout {
  const { ttf } = face;
  const scale = size / ttf.unitsPerEm;
  const lineHeight = (ttf.hhea.ascender - ttf.hhea.descender + ttf.hhea.lineGap) * scale;
  const missing: string[] = [];
  const lines = splitLines(text).map((line) => {
    const gids: number[] = [];
    let adv = 0;
    for (const ch of line) {
      const gid = ttf.cmap.get(ch.codePointAt(0)!);
      if (gid === undefined) missing.push(ch);
      gids.push(gid ?? 0);
      adv += ttf.advance(gid ?? 0);
    }
    return { text: line, gids, width: adv * scale };
  });
  const width = Math.max(0, ...lines.map((l) => l.width)) + 2 * PAD;
  const height = lines.length * lineHeight + 2 * PAD;
  return { lines, width, height, lineHeight, firstBaseline: height - PAD - ttf.hhea.ascender * scale, missing };
}

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

const linear = (m: mupdf.Matrix): mupdf.Matrix => [m[0], m[1], m[2], m[3], 0, 0];

/**
 * Form matrix so that form space (y-up) lands upright in MuPDF page space (y-down):
 * concat(M, ctmLinear) == [1 0 0 -1 0 0]  =>  M = concat(flip, invert(ctmLinear)).
 */
export function uprightFormMatrix(pageCtm: mupdf.Matrix): mupdf.Matrix {
  const m = mupdf.Matrix.concat([1, 0, 0, -1, 0, 0], mupdf.Matrix.invert(linear(pageCtm)));
  return m.map((v) => Math.round(v)) as mupdf.Matrix;
}

/** Page-space rect (y-down, rotation applied) -> PDF user-space /Rect. */
export function pageRectToUser(page: mupdf.PDFPage, r: mupdf.Rect): mupdf.Rect {
  const u = mupdf.Rect.transform(r, mupdf.Matrix.invert(page.getTransform()));
  return [Math.min(u[0], u[2]), Math.min(u[1], u[3]), Math.max(u[0], u[2]), Math.max(u[1], u[3])];
}

/** Adds a FreeText to the page's /Annots via raw objects. Text uses "\n"; /Contents stores "\r". */
export function createFreeText(doc: mupdf.PDFDocument, page: mupdf.PDFPage, spec: BoxSpec, face: Face, type0: mupdf.PDFObject) {
  const layout = layoutText(spec.text, face, spec.size);
  if (layout.missing.length) console.warn(`  warning: glyphs missing in ${face.ttf.postscriptName}: ${JSON.stringify(layout.missing.join(""))}`);

  const ctm = page.getTransform();
  const pageObj = page.getObject();
  const rotate = pageObj.getInheritable("Rotate");
  const rect = pageRectToUser(page, [spec.x, spec.y, spec.x + layout.width, spec.y + layout.height]);
  const matrix = uprightFormMatrix(ctm);
  const da = `/${face.resName} ${fmt(spec.size)} Tf ${spec.color.map(fmt).join(" ")} rg`;
  const now = pdfDate();

  const form = doc.addStream(appearanceStream(layout, face, spec.size, spec.color), {
    Type: "XObject",
    Subtype: "Form",
    BBox: [0, 0, layout.width, layout.height],
    Matrix: matrix,
    Resources: { Font: { [face.resName]: type0 } },
  });

  const dict: Record<string, unknown> = {
    Type: "Annot",
    Subtype: "FreeText",
    Rect: rect,
    F: 4,
    IT: "FreeTextTypeWriter",
    Contents: doc.newByteString(utf16beWithBOM(splitLines(spec.text).join("\r"))),
    DA: `(${da})`,
    NM: `(${NM_PREFIX}${randomUUID()})`,
    M: `(${now})`,
    CreationDate: `(${now})`,
    BS: { W: 0 },
    P: pageObj,
    AP: { N: form },
  };
  if (!rotate.isNull() && rotate.asNumber() % 360 !== 0) dict.Rotate = ((rotate.asNumber() % 360) + 360) % 360;
  const annot = doc.addObject(dict);

  let annots = pageObj.get("Annots");
  if (annots.isNull()) {
    pageObj.put("Annots", doc.newArray());
    annots = pageObj.get("Annots");
  }
  annots.push(annot);
  return { annot, layout, rect, matrix };
}

/** App-owned FreeTexts in the document, with the weight read from /DA. */
export function findAppFreeTexts(doc: mupdf.PDFDocument) {
  const found: { page: number; annot: mupdf.PDFObject; text: string; weight: Weight; resName: string }[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    doc.findPage(i).get("Annots").forEach((a) => {
      if (!a.get("Subtype").isName() || a.get("Subtype").asName() !== "FreeText") return;
      const nm = a.get("NM");
      if (!nm.isString() || !nm.asString().startsWith(NM_PREFIX)) return;
      const resName = /\/(\w+)\s+[\d.]+\s+Tf/.exec(a.get("DA").asString())?.[1] ?? "";
      const weight = WEIGHT_OF_RES[resName];
      if (!weight) throw new Error(`unknown font in DA: ${a.get("DA").asString()}`);
      found.push({ page: i, annot: a, text: a.get("Contents").asString().replace(/\r\n?/g, "\n"), weight, resName });
    });
  }
  return found;
}

/** Shared Type0 font refs already used by app FreeTexts, keyed by weight. */
export function findSharedFonts(doc: mupdf.PDFDocument): Partial<Record<Weight, mupdf.PDFObject>> {
  const out: Partial<Record<Weight, mupdf.PDFObject>> = {};
  for (const ft of findAppFreeTexts(doc)) {
    const font = ft.annot.get("AP").get("N").get("Resources").get("Font").get(ft.resName);
    if (font.isIndirect()) out[ft.weight] ??= font;
  }
  return out;
}

/** Codepoints used per weight across all app FreeTexts. */
export function usedCodepoints(doc: mupdf.PDFDocument, extra: { text: string; weight: Weight }[] = []): Record<Weight, Set<number>> {
  const sets: Record<Weight, Set<number>> = { regular: new Set(), semibold: new Set() };
  for (const t of [...findAppFreeTexts(doc), ...extra]) {
    for (const ch of t.text.replace(/\r|\n/g, "")) sets[t.weight].add(ch.codePointAt(0)!);
  }
  return sets;
}

export type { Faces };
