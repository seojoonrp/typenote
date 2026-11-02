// Writes a CDP step file (for run-app.ps1) that drives the text box UI with real input events:
// typing, Korean IME composition, select/drag/nudge, styles, undo/redo, rotated page.
// Needs the dev hook window.__typenote (dev builds only) and a PDF with a /Rotate 90 page 2
// (spike/out/test.pdf).
//   node tools/text-test.mjs <work dir>
//   powershell -File tools/run-app.ps1 -Steps <work dir>/text-steps.json -Pdf <work dir>/text-test.pdf
import fs from "node:fs";

const dir = (process.argv[2] ?? "").replaceAll("\\", "/");
if (!dir) throw new Error("usage: node tools/text-test.mjs <work dir>");

const helpers = `
window.__pt = (x, y) => {
  const el = document.querySelector('.page');
  const r = el.getBoundingClientRect();
  const w = __typenote.store.getState().doc.info.pages[+el.dataset.page - 1].width;
  const s = r.width / w;
  return [r.left + x * s, r.top + y * s];
};
window.__box = (i, fx = 0.5, fy = 0.5, dx = 0, dy = 0) => {
  const b = [...document.querySelectorAll('.tbox')][i].getBoundingClientRect();
  return [b.left + b.width * fx + dx, b.top + b.height * fy + dy];
};
window.__el = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
window.__s = () => {
  const s = __typenote.store.getState();
  return {
    boxes: s.textBoxes.map((b) => ({ p: b.page, x: +b.x.toFixed(1), y: +b.y.toFixed(1), t: b.text, size: b.size, w: b.weight[0], c: b.color.map((v) => +v.toFixed(2)) })),
    undo: s.canUndo, redo: s.canRedo, dirty: s.dirty,
    active: document.activeElement?.tagName, editing: !!document.querySelector('.tbox-editor'),
    bar: !!document.querySelector('.attr-bar.floating'), warn: document.querySelector('.glyph-warning')?.textContent ?? null,
    page: document.querySelector('.pages')?.textContent,
  };
};
'ok'`;

const st = (label) => ({ label, eval: "__s()" });
const type = (text) => ({ cmd: "Input.insertText", params: { text }, label: `type ${JSON.stringify(text)}` });
const compose = (text) => ({ cmd: "Input.imeSetComposition", params: { text, selectionStart: text.length, selectionEnd: text.length }, label: `compose ${text}` });

const steps = [
  { wait: 2500 },
  { label: "helpers", eval: helpers },
  { key: "0", mods: 2, label: "fit page" },
  { key: "t", label: "text tool" },
  { wait: 300 },

  // A. type two lines, Esc commits
  { click: "__pt(80, 150)", label: "click to start a box" },
  { wait: 200 },
  st("A1 editing (expect editing, TEXTAREA)"),
  type("안녕하세요 Typenote"),
  { key: "Enter" },
  type("둘째 줄"),
  { key: "Escape" },
  { wait: 300 },
  st("A2 committed (1 box, 2 lines, selected)"),

  // B. IME: Esc and Enter during composition must not commit or add lines; no duplicated syllable
  { click: "__pt(80, 260)", label: "new box" },
  compose("한"),
  { key: "Escape", composing: true, label: "Esc while composing (ignored)" },
  st("B1 still editing"),
  type("한"),
  compose("글"),
  { key: "Enter", composing: true, label: "Enter while composing (ignored)" },
  type("글"),
  { key: "Escape" },
  { wait: 300 },
  st("B2 expect '한글' once"),
  // clicking away while a syllable is still composing keeps it exactly once
  { click: "__pt(80, 340)", label: "new box" },
  compose("자"),
  { click: "__pt(300, 640)", label: "click away mid-composition" },
  { key: "Escape", label: "end the empty box" },
  { wait: 300 },
  st("B3 expect '자' once, no empty box"),

  // C. select tool: select, drag, nudge (merged undo step)
  { key: "v", label: "select tool" },
  { click: "__box(0)", label: "select box 0" },
  st("C1 selected (bar)"),
  { drag: { from: "__box(0)", to: "__box(0, 0.5, 0.5, 60, 40)" }, label: "drag box 0" },
  { wait: 200 },
  st("C2 moved"),
  { key: "ArrowRight" }, { key: "ArrowRight" }, { key: "ArrowRight" },
  { key: "ArrowDown", mods: 8 },
  { wait: 200 },
  st("C3 nudged +3, +10"),
  { key: "z", mods: 2, label: "Ctrl+Z (all nudges)" },
  { wait: 200 },
  st("C4 back to dragged position"),
  { key: "z", mods: 2, label: "Ctrl+Z (drag)" },
  { wait: 200 },
  st("C5 back to original position"),

  // D. styles on the selected box
  { click: "__box(0)", label: "select box 0" },
  { key: "b", mods: 2, label: "Ctrl+B" },
  { key: ".", mods: 2 | 8, label: "Ctrl+Shift+." },
  { click: "__el('.attr-bar.floating .swatch[title=\"파랑\"]')", label: "blue swatch" },
  { wait: 200 },
  st("D1 semibold, 14pt, blue"),

  // E. double-click re-edits the same box
  { click: "__box(0)", count: 2, label: "double-click box 0" },
  { wait: 200 },
  type(" 추가"),
  { key: "Escape" },
  { wait: 200 },
  st("E1 text ends with ' 추가'"),

  // F. delete, undo, redo
  { key: "Delete" },
  st("F1 deleted"),
  { key: "z", mods: 2, label: "Ctrl+Z" },
  st("F2 restored"),
  { key: "y", mods: 2, label: "Ctrl+Y" },
  st("F3 deleted again"),
  { key: "z", mods: 2, label: "Ctrl+Z" },
  st("F4 restored"),

  // G. an empty box is not created
  { key: "t", label: "text tool" },
  { click: "__pt(400, 700)", label: "click, type nothing" },
  { key: "Escape" },
  st("G1 no new box"),

  // H. glyph missing from Pretendard
  { click: "__pt(80, 450)" },
  type("이모지 😀"),
  st("H1 warning shown"),
  { key: "Escape" },

  // I. rotated page
  { key: "Escape", label: "deselect" },
  { key: "PageDown", label: "to page 2 (/Rotate 90)" },
  { wait: 400 },
  { click: "__pt(80, 200)" },
  type("회전 페이지 상자"),
  { key: "Escape" },
  { wait: 300 },
  st("I1 box on page index 1"),
  { shot: `${dir}/text-p2.png` },
  { key: "PageUp", label: "back to page 1" },
  { wait: 600 },
  { key: "Escape", label: "deselect" },
  { wait: 300 },
  { shot: `${dir}/text-p1.png` },
  { wait: 3500 },
  st("J autosaved (dirty false)"),
];
fs.writeFileSync(`${dir}/text-steps.json`, JSON.stringify(steps, null, 2) + "\n");
console.log(`wrote ${dir}/text-steps.json; copy spike/out/test.pdf to ${dir}/text-test.pdf`);
