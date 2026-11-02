// Writes a CDP step file (for run-app.ps1) that drives the highlight tool with real input:
// drag (with live preview), multi-line drag, drag from empty space, double-click word, popover
// color and opacity, delete/undo, select tool, text tool, rotated page, autosave.
// Uses spike/out/test.pdf: page 1 text lines at y ≈ 63–84, 97–114, 119–135, 137–153 pt.
//   node tools/highlight-test.mjs <work dir>
//   powershell -File tools/run-app.ps1 -Steps <work dir>/highlight-steps.json -Pdf <work dir>/highlight-test.pdf
// then tools/highlight-compare.mjs compares hl-p1.png / hl-p2.png with the saved file.
import fs from "node:fs";

const dir = (process.argv[2] ?? "").replaceAll("\\", "/");
if (!dir) throw new Error("usage: node tools/highlight-test.mjs <work dir>");

const helpers = `
window.__pt = (x, y) => {
  const el = document.querySelector('.page');
  const r = el.getBoundingClientRect();
  const w = __typenote.store.getState().doc.info.pages[+el.dataset.page - 1].width;
  const s = r.width / w;
  return [r.left + x * s, r.top + y * s];
};
window.__el = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
window.__s = () => {
  const s = __typenote.store.getState();
  return {
    hl: s.highlights.map((h) => ({ p: h.page, q: h.quads.length, x0: +h.quads[0][0].toFixed(1), y0: +h.quads[0][1].toFixed(1), c: h.color.map((v) => +v.toFixed(2)), a: h.opacity })),
    boxes: s.textBoxes.length, dirty: s.dirty, undo: s.canUndo,
    shapes: document.querySelectorAll('.hl-shape').length,
    popover: !!document.querySelector('.hl-layer .attr-bar.floating'),
    page: document.querySelector('.pages')?.textContent,
  };
};
window.__setRange = (sel, v) => {
  const el = document.querySelector(sel);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.value;
};
'ok'`;

const st = (label) => ({ label, eval: "__s()" });
const steps = [
  { wait: 2500 },
  { label: "helpers", eval: helpers },
  { key: "0", mods: 2, label: "fit page" },
  { key: "h", label: "highlight tool" },
  { wait: 300 },

  // 1. drag across part of line 1, checking the live preview mid-drag
  { click: "__pt(60, 73)", label: "plain click on text" },
  st("1a nothing created by a click"),
  { press: "__pt(60, 73)" },
  { move: "__pt(120, 74)" },
  { move: "__pt(200, 74)" },
  { wait: 300 },
  st("1b mid-drag: a preview shape, no highlight yet"),
  { move: "__pt(300, 73)" },
  { wait: 200 },
  { release: "__pt(300, 73)" },
  { wait: 400 },
  st("1c one highlight, one quad, cyan 40%"),

  // 2. multi-line drag: line 2 to line 4 -> one highlight with 3 quads
  { drag: { from: "__pt(100, 105)", to: "__pt(200, 145)" }, label: "drag lines 2-4" },
  { wait: 400 },
  st("2 second highlight with 3 quads"),

  // 3. drag starting where there is no text does nothing
  { drag: { from: "__pt(300, 400)", to: "__pt(450, 430)" }, label: "drag on empty area" },
  { wait: 400 },
  st("3 still 2 highlights"),

  // 4. double-click a word (not highlighted yet); double-clicking a highlighted word only selects
  { click: "__pt(360, 73)", count: 2, label: "double-click a word at the end of line 1" },
  { wait: 400 },
  st("4a third highlight, one quad (the word)"),
  { click: "__pt(70, 127)", count: 2, label: "double-click a word inside highlight 2" },
  { wait: 400 },
  st("4b still 3 highlights, highlight 2 selected"),
  { key: "Escape" },

  // 5. click a highlight: popover; color, opacity; delete; undo
  { click: "__pt(150, 73)", label: "click highlight 1" },
  { wait: 200 },
  st("5a popover shown"),
  { click: "__el('.hl-layer .attr-bar.floating .swatch[title=\"Yellow\"]')", label: "yellow" },
  { label: "opacity 70%", eval: "__setRange('.hl-layer .attr-bar.floating input.opacity', 70)" },
  { wait: 200 },
  st("5b yellow 70%"),
  { shot: `${dir}/hl-popover.png` },
  { key: "Delete" },
  { wait: 200 },
  st("5c deleted"),
  { key: "z", mods: 2, label: "Ctrl+Z" },
  { wait: 200 },
  st("5d restored (yellow 70%)"),

  // 6. select tool: click selects, Esc deselects
  { key: "v", label: "select tool" },
  { click: "__pt(150, 73)", label: "click highlight 1" },
  st("6a popover in select tool"),
  { key: "Escape" },
  st("6b deselected"),

  // 7. text tool: a click on a highlight starts a text box instead
  { key: "t", label: "text tool" },
  { click: "__pt(150, 73)", label: "click highlight 1 with the text tool" },
  { wait: 200 },
  { label: "editing?", eval: "!!document.querySelector('.tbox-editor')" },
  { key: "Escape", label: "leave the empty box" },
  st("7 no text box, no highlight selected"),

  // 8. rotated page
  { key: "h", label: "highlight tool" },
  { key: "PageDown" },
  { wait: 500 },
  { drag: { from: "__pt(60, 105)", to: "__pt(250, 105)" }, label: "drag on page 2 line 2" },
  { wait: 400 },
  st("8 highlight on page index 1"),
  { shot: `${dir}/hl-p2.png` },
  { key: "PageUp" },
  { wait: 600 },
  { key: "v" },
  { cmd: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x: 5, y: 5 }, label: "mouse away" },
  { wait: 300 },
  { shot: `${dir}/hl-p1.png` },
  { wait: 3500 },
  st("9 autosaved"),
];

fs.writeFileSync(`${dir}/highlight-steps.json`, JSON.stringify(steps, null, 2) + "\n");
console.log(`wrote ${dir}/highlight-steps.json; copy spike/out/test.pdf to ${dir}/highlight-test.pdf`);
