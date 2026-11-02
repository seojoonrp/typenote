// Smoke test for the release build (frontend built in, no dev hook): open a PDF, type a Korean
// box, drag a highlight, let autosave write the file. Uses only the DOM and real input.
//   node tools/release-test.mjs <work dir>      -> <work dir>/release-steps.json
//   copy spike/out/test.pdf to <work dir>/release-test.pdf, then
//   powershell -File tools/run-app.ps1 -Release -Steps <work dir>/release-steps.json -Pdf <work dir>/release-test.pdf
//   cd spike && npx tsx inspect.ts <work dir>/release-test.pdf      (the box and highlight are in the file)
import fs from "node:fs";

const dir = (process.argv[2] ?? "").replaceAll("\\", "/");
if (!dir) throw new Error("usage: node tools/release-test.mjs <work dir>");

// spike/out/test.pdf page 1 is 595 pt wide, first text line at y ≈ 63–84 pt
const helpers = `
window.__pt = (x, y) => {
  const r = document.querySelector('.page').getBoundingClientRect();
  const s = r.width / 595;
  return [r.left + x * s, r.top + y * s];
};
'ok'`;

const steps = [
  { wait: 3500 },
  { label: "helpers", eval: helpers },
  {
    label: "opened",
    eval: "({ title: document.title, pages: document.querySelector('.pages')?.textContent, bitmap: !!document.querySelector('.page canvas:not(.blank)'), devHook: typeof window.__typenote, problem: document.querySelector('.problem')?.textContent ?? null })",
  },
  { key: "t", label: "text tool" },
  { click: "__pt(60, 300)", label: "click on the page" },
  { wait: 300 },
  { cmd: "Input.insertText", params: { text: "릴리스 빌드 확인 Release 123" } },
  { key: "Escape", label: "commit" },
  { wait: 300 },
  { label: "boxes", eval: "[...document.querySelectorAll('.tbox')].map((b) => b.textContent)" },
  { key: "h", label: "highlight tool" },
  { drag: { from: "__pt(60, 73)", to: "__pt(300, 73)" }, label: "drag over line 1" },
  { wait: 600 },
  { label: "highlight shapes", eval: "document.querySelectorAll('.hl-shape').length" },
  { key: "v" },
  { cmd: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x: 5, y: 5 }, label: "mouse away" },
  { wait: 4000 },
  { label: "save status", eval: "document.querySelector('.save-status')?.textContent" },
  { shot: `${dir}/release.png` },
];

fs.writeFileSync(`${dir}/release-steps.json`, JSON.stringify(steps, null, 2) + "\n");
console.log(`wrote ${dir}/release-steps.json`);
