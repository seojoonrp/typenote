// Pretendard faces and the document-shared Type0/CIDFontType2 font objects.
import * as fs from "node:fs";
import * as path from "node:path";
import * as mupdf from "mupdf";
import { parseTTF, type TTF } from "./ttf.ts";
import { subsetRetainGids } from "./subset.ts";
import { buildToUnicode } from "./tounicode.ts";

export type Weight = "regular" | "semibold";
export const RES_NAME: Record<Weight, string> = { regular: "PR", semibold: "PS" };
export const WEIGHT_OF_RES: Record<string, Weight | undefined> = { PR: "regular", PS: "semibold" };

export type Face = { weight: Weight; resName: string; ttf: TTF; bytes: Uint8Array };
export type Faces = Record<Weight, Face>;

export function loadFaces(fontDir: string): Faces {
  const load = (weight: Weight, file: string): Face => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(fontDir, file)));
    return { weight, resName: RES_NAME[weight], ttf: parseTTF(bytes), bytes };
  };
  return {
    regular: load("regular", "Pretendard-Regular.ttf"),
    semibold: load("semibold", "Pretendard-SemiBold.ttf"),
  };
}

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

async function payload(face: Face, codepoints: Iterable<number>): Promise<Payload> {
  const cps = [...new Set(codepoints)].sort((a, b) => a - b);
  const c2t = cidToText(face, cps);
  const cids = [...c2t.keys()].sort((a, b) => a - b);
  return {
    subset: await subsetRetainGids(face.bytes, cps),
    baseFont: `${subsetTag(cids)}+${face.ttf.postscriptName}`,
    W: widthsArray(face, cids),
    toUnicode: buildToUnicode(c2t),
  };
}

/** Creates Type0 -> CIDFontType2 -> FontDescriptor -> FontFile2 (+ ToUnicode). Returns the Type0 ref. */
export async function createFontObjects(doc: mupdf.PDFDocument, face: Face, codepoints: Iterable<number>): Promise<mupdf.PDFObject> {
  const p = await payload(face, codepoints);
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
 * Re-subsets for the new codepoint union and overwrites the same objects in place.
 * Returns false (and touches nothing) when the glyph set, hence the subset tag, is unchanged.
 */
export async function rewriteFontObjects(doc: mupdf.PDFDocument, type0: mupdf.PDFObject, face: Face, codepoints: Iterable<number>): Promise<boolean> {
  const cps = [...codepoints];
  const tag = subsetTag([...cidToText(face, cps).keys()].sort((a, b) => a - b));
  if (type0.get("BaseFont").asName() === `${tag}+${face.ttf.postscriptName}`) return false;
  const p = await payload(face, cps);
  const cidFont = type0.get("DescendantFonts").get(0);
  const descriptor = cidFont.get("FontDescriptor");
  const fontFile = descriptor.get("FontFile2");
  const toUnicode = type0.get("ToUnicode");
  fontFile.writeStream(p.subset);
  fontFile.put("Length1", p.subset.byteLength);
  toUnicode.writeStream(p.toUnicode);
  type0.put("BaseFont", p.baseFont);
  cidFont.put("BaseFont", p.baseFont);
  cidFont.put("W", p.W);
  descriptor.put("FontName", p.baseFont);
  return true;
}
