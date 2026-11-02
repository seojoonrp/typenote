// Measures how closely the HTML overlay matches the PDF appearance stream.
//
//   node tools/overlay-test.mjs steps <work dir>       -> <work dir>/overlay-steps.json
//   powershell -File tools/run-app.ps1 -Steps <work dir>/overlay-steps.json -Pdf <work dir>/overlay-test.pdf
//   node tools/overlay-test.mjs compare <work dir>     -> per box: ink bbox offsets and overlap
//
// The steps add boxes through the dev hook, wait for autosave, then screenshot the page at 100%
// and 150% with the geometry needed to crop it. "compare" renders the saved PDF with MuPDF at
// the same device scale (boxes drawn from their appearance streams) and compares the ink of each
// box between the two. Use a copy of spike/out/test.pdf (page 1 is empty below y = 160pt).
import fs from "node:fs";

const [mode, rawDir] = process.argv.slice(2);
const dir = (rawDir ?? "").replaceAll("\\", "/");
if (!dir || (mode !== "steps" && mode !== "compare")) throw new Error("usage: node tools/overlay-test.mjs steps|compare <work dir>");

const BOXES = [
  { x: 60, y: 170, text: "Regular 10pt 가나다라 ABC 123", size: 10, weight: "regular", color: [0, 0, 0], tracking: -0.03 },
  { x: 60, y: 192, text: "SemiBold 18pt 한글 Wy\n둘째 줄: 똠 햏 뷁 (2)", size: 18, weight: "semibold", color: [0.05, 0.3, 0.85], tracking: -0.03 },
  { x: 60, y: 250, text: "Regular 24pt 큰 글씨 gjpqy", size: 24, weight: "regular", color: [0.85, 0.12, 0.12], tracking: -0.03 },
  { x: 60, y: 290, text: "작은 8pt 글씨 테스트 abc xyz", size: 8, weight: "regular", color: [0, 0, 0] },
];
// the first three with the Hangul letter spacing new boxes get (layout.ts HANGUL_TRACKING), the last without
const ZOOMS = [100, 150];

if (mode === "steps") {
  const geom = `(() => {
    const p = document.querySelector('.page').getBoundingClientRect();
    const w = __typenote.store.getState().doc.info.pages[0].width;
    const scale = p.width / w;
    const boxes = [...document.querySelectorAll('.tbox')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: (r.left - p.left) / scale, y: (r.top - p.top) / scale, w: r.width / scale, h: r.height / scale, text: el.textContent };
    });
    return { dpr: devicePixelRatio, scale, page: [p.left, p.top, p.width, p.height], boxes };
  })()`;
  const steps = [
    { wait: 2500 },
    ...BOXES.map((b, i) => ({ label: `add box ${i}`, eval: `__typenote.addTestBox(${JSON.stringify({ page: 0, ...b })}).then(() => 'ok')` })),
    { wait: 3800 },
    { label: "saved", eval: "__typenote.store.getState().dirty === false" },
    { key: "v", label: "select tool (no text cursor)" },
  ];
  for (const z of ZOOMS) {
    steps.push(
      { click: "(() => { const b = document.querySelector('button.zoom').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()", label: "zoom field" },
      { cmd: "Input.insertText", params: { text: String(z) } },
      { key: "Enter" },
      { key: "Home", label: "top of page 1 (the boxes must be on screen)" },
      { cmd: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x: 5, y: 5 }, label: "mouse away (no hover outline)" },
      { wait: 1500 },
      { label: `geometry ${z}%`, eval: geom, save: `${dir}/overlay-geom-${z}.json` },
      { shot: `${dir}/overlay-${z}.png` },
    );
  }
  fs.writeFileSync(`${dir}/overlay-steps.json`, JSON.stringify(steps, null, 2) + "\n");
  console.log(`wrote ${dir}/overlay-steps.json; copy spike/out/test.pdf to ${dir}/overlay-test.pdf`);
} else {
  const mupdf = await import("mupdf");
  const doc = new mupdf.PDFDocument(fs.readFileSync(`${dir}/overlay-test.pdf`));
  const page = doc.loadPage(0);

  const lum = (p, i) => 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
  /** ink mask of a device-pixel window of a pixmap */
  function mask(pix, x0, y0, w, h) {
    const n = pix.getNumberOfComponents() + (pix.getAlpha() ? 0 : 0);
    const stride = pix.getStride();
    const px = pix.getPixels();
    const comps = stride / pix.getWidth();
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const sx = x0 + x;
        const sy = y0 + y;
        if (sx < 0 || sy < 0 || sx >= pix.getWidth() || sy >= pix.getHeight()) continue;
        m[y * w + x] = lum(px, sy * stride + sx * comps) < 170 ? 1 : 0;
      }
    void n;
    return m;
  }
  function bbox(m, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [x0, y0, x1, y1];
  }
  /** shift (dx, dy) in [-r, r] maximizing the overlap of a onto b, and the IoU there */
  function bestShift(a, b, w, h, r = 3) {
    let best = { dx: 0, dy: 0, iou: -1 };
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        let inter = 0, union = 0;
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const ax = x - dx, ay = y - dy;
            const av = ax >= 0 && ay >= 0 && ax < w && ay < h ? a[ay * w + ax] : 0;
            const bv = b[y * w + x];
            if (av && bv) inter++;
            if (av || bv) union++;
          }
        const iou = union ? inter / union : 1;
        if (iou > best.iou) best = { dx, dy, iou };
      }
    return best;
  }

  for (const z of ZOOMS) {
    const g = JSON.parse(fs.readFileSync(`${dir}/overlay-geom-${z}.json`, "utf8"));
    const S = g.scale * g.dpr;
    const shot = new mupdf.Image(fs.readFileSync(`${dir}/overlay-${z}.png`)).toPixmap();
    const ap = page.toPixmap(mupdf.Matrix.scale(S, S), mupdf.ColorSpace.DeviceRGB, false, true);
    console.log(`\n== ${z}%  (${S.toFixed(3)} device px/pt, dpr ${g.dpr})`);
    for (const b of g.boxes) {
      const m = 3; // pt margin
      const w = Math.round((b.w + 2 * m) * S);
      const h = Math.round((b.h + 2 * m) * S);
      const ax = Math.round((g.page[0] + (b.x - m) * g.scale) * g.dpr);
      const ay = Math.round((g.page[1] + (b.y - m) * g.scale) * g.dpr);
      const bx = Math.round((b.x - m) * S);
      const by = Math.round((b.y - m) * S);
      const A = mask(shot, ax, ay, w, h);
      const B = mask(ap, bx, by, w, h);
      const ba = bbox(A, w, h);
      const bb = bbox(B, w, h);
      const d = ba.map((v, i) => v - bb[i]);
      const s = bestShift(A, B, w, h);
      console.log(
        `${JSON.stringify(b.text.slice(0, 22)).padEnd(26)} ink bbox overlay-AP [L ${d[0]} T ${d[1]} R ${d[2]} B ${d[3]}] px  best shift (${s.dx},${s.dy}) IoU ${s.iou.toFixed(2)}`,
      );
    }
  }
}
