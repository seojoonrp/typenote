// Text box geometry, shared by the appearance stream (worker) and the HTML overlay (main
// thread) so both place every glyph identically. No mupdf here.
// advance = hmtx (+ letter spacing after Hangul glyphs), no kerning;
// lineHeight = (ascender − descender + lineGap) / UPM × size.
import { trackingUnits, type Face } from "./faces";

/** padding around the text inside the box, pt */
export const PAD = 2;

/** Hangul letter spacing of new and re-edited boxes, in em (Latin, digits and symbols keep theirs) */
export const HANGUL_TRACKING = -0.03;

export type Layout = {
  /** tracked[i]: gids[i] is a Hangul glyph, followed by `trackDelta` */
  lines: { text: string; gids: number[]; tracked: boolean[]; width: number }[];
  /** letter spacing after each Hangul glyph, font units (0 = none) */
  trackDelta: number;
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

export function layoutText(text: string, face: Face, size: number, tracking = 0): Layout {
  const { ttf } = face;
  const scale = size / ttf.unitsPerEm;
  const trackDelta = trackingUnits(face, tracking);
  const lineHeight = (ttf.hhea.ascender - ttf.hhea.descender + ttf.hhea.lineGap) * scale;
  const missing: string[] = [];
  const lines = splitLines(text).map((line) => {
    const gids: number[] = [];
    const tracked: boolean[] = [];
    let adv = 0;
    for (const ch of line) {
      const gid = ttf.cmap.get(ch.codePointAt(0)!);
      if (gid === undefined && !missing.includes(ch)) missing.push(ch);
      const t = trackDelta !== 0 && gid !== undefined && face.hangul.has(gid);
      gids.push(gid ?? 0);
      tracked.push(t);
      adv += ttf.advance(gid ?? 0) + (t ? trackDelta : 0);
    }
    return { text: line, gids, tracked, width: adv * scale };
  });
  const width = Math.max(0, ...lines.map((l) => l.width)) + 2 * PAD;
  const height = lines.length * lineHeight + 2 * PAD;
  const ascent = ttf.hhea.ascender * scale;
  return { lines, trackDelta, width, height, lineHeight, ascent, firstBaseline: height - PAD - ascent, missing };
}

/**
 * Offset (UTF-16) in the box's text of the caret position nearest to (x, y), in pt from the box's
 * top-left: the line under y, the character boundary nearest to x.
 */
export function caretIndexAt(layout: Layout, face: Face, size: number, x: number, y: number): number {
  const scale = size / face.ttf.unitsPerEm;
  const li = Math.max(0, Math.min(layout.lines.length - 1, Math.floor((y - PAD) / layout.lineHeight)));
  let offset = 0;
  for (let i = 0; i < li; i++) offset += layout.lines[i]!.text.length + 1;
  const line = layout.lines[li]!;
  const chars = [...line.text];
  let pos = PAD;
  for (let k = 0; k < chars.length; k++) {
    const w = (face.ttf.advance(line.gids[k]!) + (line.tracked[k] ? layout.trackDelta : 0)) * scale;
    if (x < pos + w / 2) return offset;
    pos += w;
    offset += chars[k]!.length;
  }
  return offset;
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
