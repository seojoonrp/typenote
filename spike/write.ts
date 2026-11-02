// Usage: tsx write.ts <in.pdf> <out.pdf>
// Adds the three spec FreeTexts (+ one extra on a /Rotate 270 + CropBox page if present)
// and a Highlight on the first text line of page 1, then saves incrementally.
import * as fs from "node:fs";
import * as mupdf from "mupdf";
import { loadFaces } from "./lib/fonts.ts";
import { addFreeTexts, saveDocument, type PlacedBox } from "./lib/document.ts";

// Provisional: samples/ only contain the user's cyan Acrobat highlights, so Acrobat's
// default yellow /C could not be read from a real file yet (see REPORT.md).
export const HIGHLIGHT_YELLOW: mupdf.AnnotColor = [1, 0.819611, 0];

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: tsx write.ts <in.pdf> <out.pdf>");
  process.exit(2);
}

const doc = new mupdf.PDFDocument(fs.readFileSync(input));
const faces = loadFaces(new URL("../fonts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
console.log(`# write ${input} -> ${output}`);

// --- Highlight on the first text line of page 1 -----------------------------------------
{
  const page = doc.loadPage(0);
  const st = page.toStructuredText("preserve-whitespace");
  const firstLine: mupdf.Quad[] = [];
  let line = -1;
  st.walk({
    beginLine() {
      line++;
    },
    onChar(_c, _origin, _font, _size, quad) {
      if (line === 0) firstLine.push(quad);
    },
  });
  // A char is selected only once the point passes its midpoint, so use the outer edges.
  const leftEdge = (q: mupdf.Quad): mupdf.Point => [(q[0] + q[4]) / 2 + 0.01, (q[1] + q[5]) / 2];
  const rightEdge = (q: mupdf.Quad): mupdf.Point => [(q[2] + q[6]) / 2 - 0.01, (q[3] + q[7]) / 2];
  const quads = st.highlight(leftEdge(firstLine[0]!), rightEdge(firstLine.at(-1)!));
  const annot = page.createAnnotation("Highlight");
  annot.setQuadPoints(quads);
  annot.setColor(HIGHLIGHT_YELLOW);
  annot.update();
  console.log(`  Highlight p1: obj ${annot.getObject().asIndirect()} quads=${JSON.stringify(quads.map((q) => q.map((v) => +v.toFixed(2))))}`);
  page.destroy();
}

// --- FreeTexts ----------------------------------------------------------------------------
const pageWithRotate = (deg: number) => {
  for (let i = 0; i < doc.countPages(); i++) {
    const r = doc.findPage(i).getInheritable("Rotate");
    if (!r.isNull() && ((r.asNumber() % 360) + 360) % 360 === deg) return i;
  }
  return -1;
};

const boxes: PlacedBox[] = [
  {
    label: "regular-12-black",
    page: 0,
    x: 56,
    y: 200,
    text: "Regular 12pt 검정 한 줄: 안녕하세요, Typenote!",
    size: 12,
    weight: "regular",
    color: [0, 0, 0],
  },
  {
    label: "semibold-18-blue-multiline",
    page: 0,
    x: 56,
    y: 250,
    text: "SemiBold 18pt 파랑 여러 줄\n한글 English 0123456789 섞기\n기호 ~!@#$%^&*()_+-=[]{};:'\",.<>/?\n“따옴표” ‘작은’ · … → ※ ㈜ ① ½ °C",
    size: 18,
    weight: "semibold",
    color: [0.05, 0.3, 0.85],
  },
];
const rot90 = pageWithRotate(90);
if (rot90 >= 0)
  boxes.push({
    label: "rotate90",
    page: rot90,
    x: 56,
    y: 160,
    text: "회전 90 페이지 위의 상자\n화면 기준으로 똑바로 보여야 함 (2줄)",
    size: 14,
    weight: "regular",
    color: [0.8, 0.1, 0.1],
  });
else console.warn("  no /Rotate 90 page: skipped rotated FreeText");
const rot270 = pageWithRotate(270);
if (rot270 >= 0)
  boxes.push({
    label: "extra-rotate270-cropbox",
    page: rot270,
    x: 56,
    y: 120,
    text: "추가: 회전 270 + CropBox 상자",
    size: 12,
    weight: "semibold",
    color: [0.1, 0.55, 0.2],
  });

await addFreeTexts(doc, faces, boxes);

const mode = saveDocument(doc, output);
console.log(`saved (${mode}) ${output}: ${fs.statSync(input).size} -> ${fs.statSync(output).size} bytes`);
