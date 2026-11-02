// Glyph outlines on a page, to fit highlights to the text's actual height: StructuredText quads
// span the font's whole ascender-to-descender box, which leaves a band of colour above and below
// the letters.
import * as mupdf from "mupdf";
import type { Quad } from "./model";

const BOUNDS_SCALE = 64;

/** A drawn glyph: its origin and the bounds of its outline, in page space. */
export type Glyph = { x: number; y: number; bbox: mupdf.Rect };

/** Every glyph the page's content draws (filled, stroked, clipping or invisible text alike). */
export function pageGlyphs(page: mupdf.PDFPage): Glyph[] {
  const glyphs: Glyph[] = [];
  const collect = (text: mupdf.Text, ctm: mupdf.Matrix) =>
    text.walk({
      showGlyph(font, trm, gid, uni) {
        const one = new mupdf.Text();
        one.showGlyph(font, trm, gid, uni);
        // MuPDF pads text bounds by one device unit; measuring at 64x makes that 1/64 pt
        const b = one.getBounds(null as unknown as mupdf.StrokeState, mupdf.Matrix.concat(ctm, mupdf.Matrix.scale(BOUNDS_SCALE, BOUNDS_SCALE)));
        const bbox = b.map((v) => v / BOUNDS_SCALE) as mupdf.Rect;
        one.destroy();
        if (!(bbox[2] > bbox[0] && bbox[3] > bbox[1])) return; // spaces have no outline
        // the glyph origin (trm's translation) through the ctm
        const x = trm[4] * ctm[0] + trm[5] * ctm[2] + ctm[4];
        const y = trm[4] * ctm[1] + trm[5] * ctm[3] + ctm[5];
        glyphs.push({ x, y, bbox });
      },
    });
  const device = new mupdf.Device({
    fillText: (text, ctm) => collect(text, ctm),
    strokeText: (text, _stroke, ctm) => collect(text, ctm),
    clipText: (text, ctm) => collect(text, ctm),
    clipStrokeText: (text, _stroke, ctm) => collect(text, ctm),
    ignoreText: (text, ctm) => collect(text, ctm), // invisible text, e.g. an OCR layer
  });
  try {
    page.runPageContents(device, mupdf.Matrix.identity);
    device.close();
  } finally {
    device.destroy();
  }
  return glyphs;
}

/**
 * Shrinks each quad (UL, UR, LL, LR, in text orientation) across the text direction to the
 * outlines of the glyphs whose origins lie in it. A quad with no glyphs in it stays as it is.
 */
export function fitQuadsToGlyphs(quads: Quad[], glyphs: Glyph[]): Quad[] {
  return quads.map((q) => {
    const [ulx, uly, urx, ury, llx, lly] = q;
    const ux = urx - ulx, uy = ury - uly; // along the text
    const vx = llx - ulx, vy = lly - uly; // down across it
    const uu = ux * ux + uy * uy;
    const vv = vx * vx + vy * vy;
    if (uu === 0 || vv === 0) return q;
    const s = (x: number, y: number) => ((x - ulx) * ux + (y - uly) * uy) / uu;
    const t = (x: number, y: number) => ((x - ulx) * vx + (y - uly) * vy) / vv;
    let top = Infinity;
    let bottom = -Infinity;
    for (const g of glyphs) {
      const gs = s(g.x, g.y);
      const gt = t(g.x, g.y);
      if (gs < -0.01 || gs > 1.01 || gt < 0 || gt > 1) continue;
      const [x0, y0, x1, y1] = g.bbox;
      for (const [cx, cy] of [
        [x0, y0],
        [x1, y0],
        [x0, y1],
        [x1, y1],
      ] as const) {
        const ct = t(cx, cy);
        top = Math.min(top, ct);
        bottom = Math.max(bottom, ct);
      }
    }
    if (top >= bottom) return q;
    top = Math.max(0, top);
    bottom = Math.min(1, bottom);
    const at = (k: number, x: number, y: number) => [x + k * vx, y + k * vy] as const;
    return [...at(top, ulx, uly), ...at(top, urx, ury), ...at(bottom, ulx, uly), ...at(bottom, urx, ury)] as Quad;
  });
}
