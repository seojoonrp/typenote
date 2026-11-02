// Pretendard faces (parsed TTFs). No mupdf here: the main thread uses this for layout too.
import type { Weight } from "./model";
import { parseTTF, type TTF } from "./ttf";

export const RES_NAME: Record<Weight, string> = { regular: "PR", semibold: "PS" };
export const WEIGHT_OF_RES: Record<string, Weight | undefined> = { PR: "regular", PS: "semibold" };

/** hangul: glyphs some Hangul codepoint maps to (letter spacing applies per glyph) */
export type Face = { weight: Weight; resName: string; ttf: TTF; bytes: Uint8Array; hangul: Set<number> };
export type Faces = Record<Weight, Face>;

/** Hangul syllables and jamo (conjoining, compatibility, extended A and B) */
export const isHangul = (cp: number) =>
  (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f) || (cp >= 0xa960 && cp <= 0xa97f) || (cp >= 0xd7b0 && cp <= 0xd7ff);

export function makeFaces(bytes: Record<Weight, Uint8Array>): Faces {
  const face = (weight: Weight): Face => {
    const ttf = parseTTF(bytes[weight]);
    const hangul = new Set<number>();
    for (const [cp, gid] of ttf.cmap) if (isHangul(cp) && gid !== 0) hangul.add(gid);
    return { weight, resName: RES_NAME[weight], ttf, bytes: bytes[weight], hangul };
  };
  return { regular: face("regular"), semibold: face("semibold") };
}

/** Letter spacing in font units, as the layout, the appearance stream and the overlay font use it. */
export const trackingUnits = (face: Face, tracking: number) => Math.round(tracking * face.ttf.unitsPerEm);

/**
 * A copy of the font whose Hangul glyphs advance `tracking` em more: the overlay's font for
 * tracked boxes, so the browser (and the textarea being typed in) lays them out like the
 * appearance stream does.
 */
export function withHangulTracking(face: Face, tracking: number): Uint8Array<ArrayBuffer> {
  const delta = trackingUnits(face, tracking);
  const bytes = new Uint8Array(face.bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hmtx = face.ttf.tables.get("hmtx")!.offset;
  for (const gid of face.hangul) {
    if (gid < face.ttf.numberOfHMetrics) dv.setUint16(hmtx + 4 * gid, Math.max(0, face.ttf.advance(gid) + delta));
  }
  return bytes;
}
