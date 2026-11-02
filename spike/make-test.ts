// Usage: tsx make-test.ts <out.pdf>
// Builds the test input: p1 normal text page, p2 /Rotate 90, p3 /Rotate 270 + offset CropBox.
// Base text uses Malgun Gothic (system font) on purpose, so it can never be confused with
// the Pretendard objects the app writes.
import * as fs from "node:fs";
import * as mupdf from "mupdf";
import { fmt, uprightFormMatrix } from "./lib/freetext.ts";

const out = process.argv[2];
if (!out) {
  console.error("usage: tsx make-test.ts <out.pdf>");
  process.exit(2);
}

const doc = new mupdf.PDFDocument();
const malgun = new mupdf.Font("MalgunGothic", new Uint8Array(fs.readFileSync("C:/Windows/Fonts/malgun.ttf")));
const helv = new mupdf.Font("Helvetica");
const resources = { Font: { KR: doc.addFont(malgun), HV: doc.addSimpleFont(helv, "Latin") } };

type Line = { font: "KR" | "HV"; size: number; x: number; y: number; text: string };
const pages: { rotate: mupdf.Rotate; cropBox?: mupdf.Rect; lines: Line[] }[] = [
  {
    rotate: 0,
    lines: [
      { font: "KR", size: 16, x: 56, y: 80, text: "첫째 줄 하이라이트 대상: 한글 본문과 English 123" },
      { font: "HV", size: 12, x: 56, y: 110, text: "Second line in Helvetica. The quick brown fox jumps over the lazy dog." },
      { font: "KR", size: 12, x: 56, y: 132, text: "셋째 줄 — 일반 텍스트가 있는 페이지입니다. 여러 줄 하이라이트도 가능해야 합니다." },
      { font: "KR", size: 12, x: 56, y: 150, text: "넷째 줄: 가나다라마바사 아자차카타파하." },
    ],
  },
  {
    rotate: 90,
    lines: [
      { font: "KR", size: 16, x: 56, y: 80, text: "회전 페이지 (/Rotate 90) — 이 글과 상자가 화면 기준으로 똑바로 보여야 함" },
      { font: "HV", size: 12, x: 56, y: 110, text: "Rotated page, text should read left-to-right on screen." },
    ],
  },
  {
    rotate: 270,
    cropBox: [30, 40, 565, 800],
    lines: [{ font: "KR", size: 16, x: 56, y: 80, text: "회전 270 + CropBox 오프셋 페이지 (좌표 변환 확인용)" }],
  },
];

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
const apply = (m: mupdf.Matrix, x: number, y: number): [number, number] => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];

for (const spec of pages) {
  const pageObj = doc.addPage([0, 0, 595, 842], spec.rotate, resources, "% placeholder\n"); // empty contents would omit /Contents
  doc.insertPage(-1, pageObj);
  if (spec.cropBox) pageObj.put("CropBox", spec.cropBox);
}

pages.forEach((spec, i) => {
  const page = doc.loadPage(i);
  const ctm = page.getTransform();
  const inv = mupdf.Matrix.invert(ctm);
  const m = uprightFormMatrix(ctm);
  let content = "";
  for (const line of spec.lines) {
    const [ux, uy] = apply(inv, line.x, line.y);
    const str =
      line.font === "KR"
        ? `<${[...line.text].map((c) => hex4(malgun.encodeCharacter(c.codePointAt(0)!))).join("")}>`
        : `(${line.text.replace(/[()\\]/g, "\\$&")})`;
    content += `BT /${line.font} ${line.size} Tf ${m.slice(0, 4).join(" ")} ${fmt(ux)} ${fmt(uy)} Tm ${str} Tj ET\n`;
  }
  // thin frame around the visible area, to make rotation obvious in renders
  const b = page.getBounds();
  const corners = [apply(inv, b[0] + 20, b[1] + 20), apply(inv, b[2] - 20, b[1] + 20), apply(inv, b[2] - 20, b[3] - 20), apply(inv, b[0] + 20, b[3] - 20)];
  content += `0.6 0.6 0.6 RG 0.5 w ${corners.map(([x, y], k) => `${fmt(x)} ${fmt(y)} ${k ? "l" : "m"}`).join(" ")} h S\n`;
  // small filled marker at the visual top-left corner
  const [mx, my] = apply(inv, b[0] + 20, b[1] + 20);
  content += `1 0 0 rg ${fmt(mx - 4)} ${fmt(my - 4)} 8 8 re f\n`;
  page.getObject().get("Contents").writeStream(content);
  page.destroy();
});

doc.subsetFonts();
fs.writeFileSync(out, doc.saveToBuffer("garbage,compress").asUint8Array());
console.log(`wrote ${out}`);
