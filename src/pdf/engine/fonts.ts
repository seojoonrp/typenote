// The document-shared Type0/CIDFontType2 font objects for the Pretendard faces.
import * as mupdf from "mupdf";
import type { Face, Faces } from "./faces";
import type { Subsetter } from "./subset";
import { buildToUnicode } from "./tounicode";

export { makeFaces, RES_NAME, WEIGHT_OF_RES, type Face, type Faces } from "./faces";

/** Everything the engine needs from outside: the two TTFs and hb-subset. */
export type FontKit = { faces: Faces; subsetter: Subsetter };

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const to1000 = (face: Face, v: number) => round3((v * 1000) / face.ttf.unitsPerEm);

/** CID (= original GID, thanks to RETAIN_GIDS) -> text, for every codepoint the font maps. */
function cidToText(face: Face, codepoints: Iterable<number>): Map<number, string> {
  const map = new Map<number, string>();
  for (const cp of codepoints) {
    const gid = face.ttf.cmap.get(cp);
    if (gid !== undefined && !map.has(gid)) map.set(gid, String.fromCodePoint(cp));
  }
  return map;
}

/** Deterministic 6-letter subset tag from the glyph set. */
function subsetTag(cids: number[]): string {
  let h = 0x811c9dc5;
  for (const c of cids) {
    h ^= c;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let tag = "";
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + (h % 26));
    h = Math.floor(h / 26) ^ Math.imul(h, 31);
    h >>>= 0;
  }
  return tag;
}

function baseFontName(face: Face, codepoints: Iterable<number>): string {
  const cids = [...cidToText(face, codepoints).keys()].sort((a, b) => a - b);
  return `${subsetTag(cids)}+${face.ttf.postscriptName}`;
}

function widthsArray(face: Face, cids: number[]): (number | number[])[] {
  const out: (number | number[])[] = [];
  let run: number[] = [];
  let start = -1;
  let prev = -2;
  for (const cid of cids) {
    if (cid !== prev + 1) {
      if (run.length) out.push(start, run);
      run = [];
      start = cid;
    }
    run.push(to1000(face, face.ttf.advance(cid)));
    prev = cid;
  }
  if (run.length) out.push(start, run);
  return out;
}

type Payload = { subset: Uint8Array; baseFont: string; W: (number | number[])[]; toUnicode: string };

function payload(kit: FontKit, face: Face, codepoints: Iterable<number>): Payload {
  const cps = [...new Set(codepoints)].sort((a, b) => a - b);
  const c2t = cidToText(face, cps);
  const cids = [...c2t.keys()].sort((a, b) => a - b);
  return {
    subset: kit.subsetter.subset(face.bytes, cps),
    baseFont: `${subsetTag(cids)}+${face.ttf.postscriptName}`,
    W: widthsArray(face, cids),
    toUnicode: buildToUnicode(c2t),
  };
}

/** Creates Type0 -> CIDFontType2 -> FontDescriptor -> FontFile2 (+ ToUnicode). Returns the Type0 ref. */
export function createFontObjects(doc: mupdf.PDFDocument, kit: FontKit, face: Face, codepoints: Iterable<number>): mupdf.PDFObject {
  const p = payload(kit, face, codepoints);
  const t = face.ttf;
  const fontFile = doc.addStream(p.subset, { Length1: p.subset.byteLength });
  const toUnicode = doc.addStream(p.toUnicode, {});
  const descriptor = doc.addObject({
    Type: "FontDescriptor",
    FontName: p.baseFont,
    Flags: 4,
    FontBBox: t.bbox.map((v) => Math.round(to1000(face, v))),
    ItalicAngle: t.italicAngle,
    Ascent: to1000(face, t.hhea.ascender),
    Descent: to1000(face, t.hhea.descender),
    CapHeight: to1000(face, t.os2.capHeight),
    XHeight: to1000(face, t.os2.xHeight),
    StemV: Math.round(50 + (t.os2.weightClass / 65) ** 2),
    FontWeight: t.os2.weightClass,
    FontFile2: fontFile,
  });
  const cidFont = doc.addObject({
    Type: "Font",
    Subtype: "CIDFontType2",
    BaseFont: p.baseFont,
    CIDSystemInfo: { Registry: "(Adobe)", Ordering: "(Identity)", Supplement: 0 },
    FontDescriptor: descriptor,
    CIDToGIDMap: "Identity",
    DW: 1000,
    W: p.W,
  });
  return doc.addObject({
    Type: "Font",
    Subtype: "Type0",
    BaseFont: p.baseFont,
    Encoding: "Identity-H",
    DescendantFonts: [cidFont],
    ToUnicode: toUnicode,
  });
}

/**
 * Re-subsets for the new codepoint union and overwrites the same objects in place, so existing
 * appearance streams keep pointing at the right font. Returns false (touching nothing) when the
 * glyph set, hence the subset tag, is unchanged.
 */
export function rewriteFontObjects(kit: FontKit, type0: mupdf.PDFObject, face: Face, codepoints: Iterable<number>): boolean {
  const cps = [...codepoints];
  if (type0.get("BaseFont").asName() === baseFontName(face, cps)) return false;
  const p = payload(kit, face, cps);
  const cidFont = type0.get("DescendantFonts").get(0);
  const descriptor = cidFont.get("FontDescriptor");
  const fontFile = descriptor.get("FontFile2");
  fontFile.writeStream(p.subset);
  fontFile.put("Length1", p.subset.byteLength);
  type0.get("ToUnicode").writeStream(p.toUnicode);
  type0.put("BaseFont", p.baseFont);
  cidFont.put("BaseFont", p.baseFont);
  cidFont.put("W", p.W);
  descriptor.put("FontName", p.baseFont);
  return true;
}
