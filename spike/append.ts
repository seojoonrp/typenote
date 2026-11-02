// Usage: tsx append.ts <in.pdf> <out.pdf>
// Adds FreeTexts with Hangul syllables the input has never used, re-subsets the shared
// fonts into the same object numbers, and saves a second incremental update.
import * as fs from "node:fs";
import * as mupdf from "mupdf";
import { loadFaces } from "./lib/fonts.ts";
import { addFreeTexts, saveDocument, type PlacedBox } from "./lib/document.ts";
import { findSharedFonts, usedCodepoints } from "./lib/freetext.ts";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: tsx append.ts <in.pdf> <out.pdf>");
  process.exit(2);
}

const doc = new mupdf.PDFDocument(fs.readFileSync(input));
const faces = loadFaces(new URL("../fonts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
console.log(`# append ${input} -> ${output}`);

const boxes: PlacedBox[] = [
  { label: "append-regular", page: 0, x: 56, y: 420, text: "추가된 상자: 뷁 똠 햏 웹툰 꿻 쀍 (append 1)", size: 14, weight: "regular", color: [0.45, 0.1, 0.6] },
  { label: "append-semibold-rot90", page: 1, x: 56, y: 260, text: "회전 페이지에 추가: 굵은 숲 뭘 됐 (append 2)", size: 16, weight: "semibold", color: [0, 0.45, 0.45] },
];

const before = usedCodepoints(doc);
for (const b of boxes) {
  const fresh = [...new Set(b.text)].filter((ch) => /[가-힣]/.test(ch) && !before[b.weight].has(ch.codePointAt(0)!));
  console.log(`  ${b.label}: Hangul not in ${b.weight} subset before: ${fresh.join("")}`);
}
const fontsBefore = Object.fromEntries(Object.entries(findSharedFonts(doc)).map(([w, f]) => [w, `${f.asIndirect()} ${f.get("BaseFont").asName()}`]));

await addFreeTexts(doc, faces, boxes);

const fontsAfter = Object.fromEntries(Object.entries(findSharedFonts(doc)).map(([w, f]) => [w, `${f.asIndirect()} ${f.get("BaseFont").asName()}`]));
console.log(`  shared fonts before: ${JSON.stringify(fontsBefore)}`);
console.log(`  shared fonts after:  ${JSON.stringify(fontsAfter)}`);

const mode = saveDocument(doc, output);
console.log(`saved (${mode}) ${output}: ${fs.statSync(input).size} -> ${fs.statSync(output).size} bytes`);
