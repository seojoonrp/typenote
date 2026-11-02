// Runs the app's edit round trip (src/pdf/engine/corpus.ts) on the compatibility corpus and on
// samples/*.pdf (when present), then renders the results with four PDF engines and compares the
// app's annotations against MuPDF (this app): poppler (pdftoppm), PDFium (Chrome, Edge) and
// pdf.js (Firefox).
//   cd spike && npx tsx ../tools/compat-render.ts <work dir>
// Writes <work dir>/<name>.pdf and compat-sheet-<n>.png (crops side by side: MuPDF, poppler,
// PDFium, pdf.js), and prints per annotation the edge offsets (px at 2x) against MuPDF.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createCanvas, ImageData, loadImage } from "@napi-rs/canvas";
import { PDFiumLibrary } from "@hyzyla/pdfium";
import * as mupdf from "mupdf";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { editRoundTrip, variants, type Variant } from "../src/pdf/engine/corpus";
import { makeFaces, type FontKit } from "../src/pdf/engine/fonts";
import { NM_PREFIX } from "../src/pdf/engine/model";
import { createSubsetter } from "../src/pdf/engine/subset";

const SCALE = 2;
const ENGINES = ["MuPDF", "poppler", "PDFium", "pdf.js"] as const;
type Img = { w: number; h: number; data: Uint8Array | Uint8ClampedArray }; // RGBA

const dir = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: npx tsx ../tools/compat-render.ts <work dir>");
const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(root, "package.json"));
fs.mkdirSync(dir, { recursive: true });

const kit: FontKit = {
  faces: makeFaces({
    regular: new Uint8Array(fs.readFileSync(path.join(root, "fonts/Pretendard-Regular.ttf"))),
    semibold: new Uint8Array(fs.readFileSync(path.join(root, "fonts/Pretendard-SemiBold.ttf"))),
  }),
  subsetter: await createSubsetter(fs.readFileSync(require.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm"))),
};
const pdfium = await PDFiumLibrary.init();
// pdf.js wants these as URL-like paths with a trailing slash
const pdfjsDir = path.dirname(require.resolve("pdfjs-dist/package.json")).replaceAll("\\", "/");

function renderMupdf(file: string, page: number): Img {
  const doc = new mupdf.PDFDocument(fs.readFileSync(file));
  const pix = doc.loadPage(page).toPixmap(mupdf.Matrix.scale(SCALE, SCALE), mupdf.ColorSpace.DeviceRGB, false, true);
  const w = pix.getWidth(), h = pix.getHeight(), stride = pix.getStride(), n = stride / w;
  const src = pix.getPixels().slice();
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * stride + x * n, o = (y * w + x) * 4;
      data[o] = src[i]!; data[o + 1] = src[i + 1]!; data[o + 2] = src[i + 2]!; data[o + 3] = 255;
    }
  return { w, h, data };
}

async function fromPng(file: string): Promise<Img> {
  const img = await loadImage(fs.readFileSync(file));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
}

async function renderPoppler(file: string, page: number): Promise<Img> {
  const out = path.join(dir, "poppler-tmp");
  execFileSync("pdftoppm", ["-r", String(72 * SCALE), "-f", String(page + 1), "-l", String(page + 1), "-singlefile", "-png", file, out], { stdio: "ignore" });
  return fromPng(`${out}.png`);
}

async function renderPdfium(file: string, page: number): Promise<Img> {
  const doc = await pdfium.loadDocument(new Uint8Array(fs.readFileSync(file)));
  try {
    const r = await doc.getPage(page).render({ scale: SCALE, render: "bitmap" });
    return { w: r.width, h: r.height, data: r.data };
  } finally {
    doc.destroy();
  }
}

async function renderPdfjs(file: string, page: number): Promise<Img> {
  const task = pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(file)),
    standardFontDataUrl: `${pdfjsDir}/standard_fonts/`,
    cMapUrl: `${pdfjsDir}/cmaps/`,
    cMapPacked: true,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    const p = await doc.getPage(page + 1);
    const viewport = p.getViewport({ scale: SCALE });
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    await p.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
    return { w: canvas.width, h: canvas.height, data: canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data };
  } finally {
    await task.destroy();
  }
}

const RENDER = { MuPDF: async (f: string, p: number) => renderMupdf(f, p), poppler: renderPoppler, PDFium: renderPdfium, "pdf.js": renderPdfjs };

type Region = { kind: "box" | "highlight"; label: string; rect: mupdf.Rect };

/** The app's annotations on a page (page space), from MuPDF */
function appAnnotations(file: string, page: number): Region[] {
  const doc = new mupdf.PDFDocument(fs.readFileSync(file));
  const out: Region[] = [];
  for (const a of doc.loadPage(page).getAnnotations()) {
    const nm = a.getObject().get("NM");
    if (!nm.isString() || !nm.asString().startsWith(NM_PREFIX)) continue;
    const kind = a.getType() === "FreeText" ? "box" : a.getType() === "Highlight" ? "highlight" : null;
    if (kind) out.push({ kind, label: `${kind} p${page + 1}`, rect: a.getBounds() });
  }
  return out;
}

const lum = (d: Img["data"], i: number) => 0.3 * d[i]! + 0.59 * d[i + 1]! + 0.11 * d[i + 2]!;
const tinted = (d: Img["data"], i: number) => Math.max(d[i]!, d[i + 1]!, d[i + 2]!) - Math.min(d[i]!, d[i + 1]!, d[i + 2]!) > 40 && lum(d, i) > 140;
const inked = (d: Img["data"], i: number) => lum(d, i) < 140;

/** bbox (px) of the pixels a region's kind cares about, and their mean colour */
function measure(img: Img, r: Region) {
  const m = 3 * SCALE;
  const [x0, y0, x1, y1] = r.rect.map((v) => Math.round(v * SCALE)) as [number, number, number, number];
  const test = r.kind === "box" ? inked : tinted;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity, n = 0;
  const sum = [0, 0, 0];
  for (let y = Math.max(0, y0 - m); y < Math.min(img.h, y1 + m); y++)
    for (let x = Math.max(0, x0 - m); x < Math.min(img.w, x1 + m); x++) {
      const i = (y * img.w + x) * 4;
      if (!test(img.data, i)) continue;
      n++; sum[0] += img.data[i]!; sum[1] += img.data[i + 1]!; sum[2] += img.data[i + 2]!;
      bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
    }
  return { box: [bx0, by0, bx1, by1], n, mean: sum.map((v) => Math.round(v / Math.max(n, 1))) };
}

/** mean absolute difference (0–255) over a region between two renders */
function meanDiff(a: Img, b: Img, r: Region) {
  const [x0, y0, x1, y1] = r.rect.map((v) => Math.round(v * SCALE)) as [number, number, number, number];
  let total = 0, n = 0;
  for (let y = Math.max(0, y0); y < Math.min(a.h, b.h, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(a.w, b.w, x1); x++) {
      const i = (y * a.w + x) * 4, j = (y * b.w + x) * 4;
      total += Math.abs(a.data[i]! - b.data[j]!) + Math.abs(a.data[i + 1]! - b.data[j + 1]!) + Math.abs(a.data[i + 2]! - b.data[j + 2]!);
      n += 3;
    }
  return n ? total / n : 0;
}

const inputs: Variant[] = variants();
for (const f of fs.existsSync(path.join(root, "samples")) ? fs.readdirSync(path.join(root, "samples")) : [])
  if (/\.pdf$/i.test(f)) inputs.push({ name: path.basename(f, ".pdf"), bytes: new Uint8Array(fs.readFileSync(path.join(root, "samples", f))) });

type Row = { name: string; page: number; crops: Map<string, Img>; region: mupdf.Rect };
const rows: Row[] = [];
let worst = 0;
for (const v of inputs) {
  const r = await editRoundTrip(v.bytes, async () => kit);
  const file = path.join(dir, `${v.name}.pdf`);
  fs.writeFileSync(file, r.second.bytes);
  const pages = [...new Set(r.highlights.filter((h) => h.id.startsWith(NM_PREFIX)).map((h) => h.page).concat(r.boxes.map((b) => b.page)))].sort();
  console.log(`\n== ${v.name}  (${r.first.mode} then ${r.second.mode}, ${(r.second.bytes.length / 1024).toFixed(0)} KB${r.encrypted ? ", encrypted" : ""})`);
  for (const page of pages) {
    const regions = appAnnotations(file, page);
    const imgs = new Map<string, Img>();
    for (const e of ENGINES) {
      try {
        imgs.set(e, await RENDER[e](file, page));
      } catch (err) {
        console.log(`   ${e} p${page + 1}: FAILED ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const ref = imgs.get("MuPDF")!;
    for (const reg of regions) {
      const base = measure(ref, reg);
      const cells = ENGINES.slice(1).map((e) => {
        const img = imgs.get(e);
        if (!img) return `${e} -`;
        const m = measure(img, reg);
        if (!m.n) return `${e} NOTHING DRAWN`;
        const d = m.box.map((v, i) => v - base.box[i]!);
        const diff = meanDiff(ref, img, reg);
        worst = Math.max(worst, ...d.map(Math.abs));
        return `${e} [${d.join(" ")}] diff ${diff.toFixed(1)}${reg.kind === "highlight" ? ` rgb ${m.mean.join(",")}` : ""}`;
      });
      console.log(`   ${reg.label.padEnd(13)} ${reg.kind === "highlight" ? `MuPDF rgb ${base.mean.join(",")}  ` : ""}${cells.join(" | ")}`);
    }
    // crop around the app's annotations on this page for the contact sheet
    const u = regions.reduce<mupdf.Rect>((a, g) => [Math.min(a[0], g.rect[0]), Math.min(a[1], g.rect[1]), Math.max(a[2], g.rect[2]), Math.max(a[3], g.rect[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    rows.push({ name: `${v.name} p${page + 1}`, page, crops: imgs, region: [u[0] - 8, u[1] - 8, u[2] + 8, u[3] + 8] });
  }
}
console.log(`\nlargest edge offset against MuPDF: ${worst} px at ${SCALE}x`);

// contact sheets: one row per file and page, one column per engine, scaled to fit
const COL = 420, LABEL = 18, PER_SHEET = 6;
for (let s = 0; s * PER_SHEET < rows.length; s++) {
  const part = rows.slice(s * PER_SHEET, (s + 1) * PER_SHEET);
  const heights = part.map((r) => Math.ceil(((r.region[3] - r.region[1]) / (r.region[2] - r.region[0])) * COL));
  const sheet = createCanvas(COL * ENGINES.length + 10 * (ENGINES.length - 1), heights.reduce((a, h) => a + h + LABEL + 10, LABEL));
  const ctx = sheet.getContext("2d");
  ctx.fillStyle = "#ddd";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.fillStyle = "#000";
  ctx.font = "14px sans-serif";
  ENGINES.forEach((e, i) => ctx.fillText(e, i * (COL + 10) + 4, 14));
  let y = LABEL;
  part.forEach((row, k) => {
    ctx.fillStyle = "#000";
    ctx.fillText(row.name, 4, y + 14);
    y += LABEL;
    ENGINES.forEach((e, i) => {
      const img = row.crops.get(e);
      if (!img) return;
      const src = createCanvas(img.w, img.h);
      src.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
      const [x0, y0, x1, y1] = row.region.map((v) => v * SCALE);
      ctx.drawImage(src, x0!, y0!, x1! - x0!, y1! - y0!, i * (COL + 10), y, COL, heights[k]!);
    });
    y += heights[k]! + 10;
  });
  const out = path.join(dir, `compat-sheet-${s + 1}.png`);
  fs.writeFileSync(out, sheet.toBuffer("image/png"));
  console.log("wrote", out);
}
pdfium.destroy();
