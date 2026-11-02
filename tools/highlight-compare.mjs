// Compares the highlight overlay with the saved appearance streams: finds the page in an app
// screenshot (hl-p1.png / hl-p2.png from tools/highlight-test.mjs), renders the saved PDF with
// MuPDF at the same device scale, and per highlight compares the tinted area's edges and colour.
//   node tools/highlight-compare.mjs <work dir>/highlight-test.pdf <work dir>/hl-p1.png 0
//   node tools/highlight-compare.mjs <work dir>/highlight-test.pdf <work dir>/hl-p2.png 1
import fs from "node:fs";
const mupdf = await import("mupdf");
const [pdfPath, shotPath, pageArg] = process.argv.slice(2);
if (!shotPath) throw new Error("usage: node tools/highlight-compare.mjs <pdf> <screenshot.png> <page index>");
const doc = new mupdf.PDFDocument(fs.readFileSync(pdfPath));
const page = doc.loadPage(+pageArg);
const [, , pw, ph] = page.getBounds();

const shot = new mupdf.Image(fs.readFileSync(shotPath)).toPixmap();
const SW = shot.getWidth(), SH = shot.getHeight();
const sstride = shot.getStride(), scomp = sstride / SW;
const spx = shot.getPixels().slice();
const at = (px, stride, comp, x, y) => { const i = y * stride + x * comp; return [px[i], px[i + 1], px[i + 2]]; };
const white = (c) => c[0] === 255 && c[1] === 255 && c[2] === 255;

// page rect in the screenshot: the outermost white pixels (the test PDF draws a frame inside)
const cy = Math.round(SH * 0.8);
let x0 = 0; while (!white(at(spx, sstride, scomp, x0, cy))) x0++;
let x1 = SW - 1; while (!white(at(spx, sstride, scomp, x1, cy))) x1--;
let y1 = SH - 1; while (y1 > 0 && !white(at(spx, sstride, scomp, x0 + 3, y1))) y1--;
const S = (x1 - x0 + 1) / pw;
const top = y1 + 1 - ph * S;
console.log(`page in shot: x ${x0}..${x1}, bottom ${y1}, ${S.toFixed(4)} device px/pt, top ${top.toFixed(1)}`);

const ap = page.toPixmap(mupdf.Matrix.scale(S, S), mupdf.ColorSpace.DeviceRGB, false, true);
const AW = ap.getWidth(), astride = ap.getStride(), acomp = astride / AW;
const apx = ap.getPixels().slice();

// tinted = highlight colour without glyph ink: clearly coloured, not dark
const tinted = (c) => Math.max(...c) - Math.min(...c) > 40 && 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2] > 140;
function measure(px, stride, comp, ox, oy, w, h) {
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1, n = 0;
  const sum = [0, 0, 0];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = at(px, stride, comp, ox + x, oy + y);
      if (!tinted(c)) continue;
      n++; sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2];
      bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
    }
  return { box: [bx0, by0, bx1, by1], n, mean: sum.map((v) => Math.round(v / Math.max(n, 1))) };
}

for (const a of page.getAnnotations()) {
  if (a.getType() !== "Highlight") continue;
  const [rx0, ry0, rx1, ry1] = a.getBounds();
  const m = 4;
  const w = Math.round((rx1 - rx0 + 2 * m) * S), h = Math.round((ry1 - ry0 + 2 * m) * S);
  const A = measure(spx, sstride, scomp, Math.round(x0 + (rx0 - m) * S), Math.round(top + (ry0 - m) * S), w, h);
  const B = measure(apx, astride, acomp, Math.round((rx0 - m) * S), Math.round((ry0 - m) * S), w, h);
  const d = A.box.map((v, i) => v - B.box[i]);
  console.log(
    `${a.getObject().asIndirect()} rect [${[rx0, ry0, rx1, ry1].map((v) => v.toFixed(1)).join(" ")}]  edges overlay-AP L ${d[0]} T ${d[1]} R ${d[2]} B ${d[3]} px  ` +
      `tinted px ${A.n}/${B.n}  mean rgb overlay ${A.mean} AP ${B.mean}`,
  );
}
