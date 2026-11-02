// Text box geometry, shared by the appearance stream (worker) and the HTML overlay (main
// thread) so both place every glyph identically. No mupdf here.
// advance = hmtx, no kerning; lineHeight = (ascender − descender + lineGap) / UPM × size.
import type { Face } from "./faces";

/** padding around the text inside the box, pt */
export const PAD = 2;

export type Layout = {
  lines: { text: string; gids: number[]; width: number }[];
  width: number;
  height: number;
  lineHeight: number;
  /** from the box top (y-up in the appearance stream: height − this) */
  ascent: number;
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
      if (gid === undefined && !missing.includes(ch)) missing.push(ch);
      gids.push(gid ?? 0);
      adv += ttf.advance(gid ?? 0);
    }
    return { text: line, gids, width: adv * scale };
  });
  const width = Math.max(0, ...lines.map((l) => l.width)) + 2 * PAD;
  const height = lines.length * lineHeight + 2 * PAD;
  const ascent = ttf.hhea.ascender * scale;
  return { lines, width, height, lineHeight, ascent, firstBaseline: height - PAD - ascent, missing };
}

/** Characters Pretendard has no glyph for (they would show as an empty box). */
export function missingGlyphs(text: string, face: Face): string[] {
  const out: string[] = [];
  for (const ch of text) {
    if (ch === "\n" || ch === "\r") continue;
    if (!face.ttf.cmap.has(ch.codePointAt(0)!) && !out.includes(ch)) out.push(ch);
  }
  return out;
}
