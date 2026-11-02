// Writes a CDP step file (for run-app.ps1) that exercises saving in the real app:
// autosave, locked file (another process holds it), outside change (conflict) and overwrite.
// Needs the dev hook window.__typenote (dev builds only).
//   node tools/save-test.mjs <work dir>      -> <work dir>/save-steps.json, edits <work dir>/save-test.pdf
//   powershell -File tools/run-app.ps1 -Steps <work dir>/save-steps.json -Pdf <work dir>/save-test.pdf
// Use forward slashes in <work dir>: PowerShell accepts them and no shell layer eats them.
import fs from "node:fs";

const dir = (process.argv[2] ?? "").replaceAll("\\", "/");
if (!dir) throw new Error("usage: node tools/save-test.mjs <work dir>");
const pdf = `${dir}/save-test.pdf`;
const marker = `${dir}/save-test-marker.txt`;
const st = (label) => ({
  label,
  eval: "(() => { const s = __typenote.store.getState(); return { boxes: s.textBoxes.length, dirty: s.dirty, problem: s.saveProblem && s.saveProblem.kind, status: document.querySelector('.save-status')?.textContent }; })()",
});
const add = (label, patch) => ({ label, eval: `__typenote.addTestBox(${JSON.stringify(patch)}).then(r => r.box.id.slice(0, 18))` });
const log = (what) => `Add-Content -Path '${marker}' -Value ('${what} ' + (Get-Date).ToString('HH:mm:ss.fff'))`;
const steps = [
  { wait: 2500 },
  st("opened"),
  add("add box", {}),
  { wait: 3800 },
  st("autosaved (expect dirty false)"),
  { ps: `${log("start")}; $f = [IO.File]::Open('${pdf}', 'Open', 'Read', 'None'); ${log("locked")}; Start-Sleep -Seconds 12; $f.Close(); ${log("released")}` },
  { wait: 3500 },
  add("add box while locked", { y: 300, text: "잠김 테스트" }),
  { wait: 3800 },
  st("while locked (expect problem locked)"),
  { wait: 16000 },
  st("after release (expect retried, dirty false)"),
  { ps: `[IO.File]::AppendAllText('${pdf}', '% changed by another program'); ${log("appended")}` },
  { wait: 3500 },
  add("add box after outside change", { y: 360, text: "충돌 테스트" }),
  { wait: 3800 },
  st("after outside change (expect problem conflict)"),
  { label: "overwrite", eval: "__typenote.store.save({ overwrite: true })" },
  st("after overwrite (expect dirty false)"),
  add("add box, then the window closes", { y: 420, text: "닫을 때 저장" }),
];
fs.writeFileSync(`${dir}/save-steps.json`, JSON.stringify(steps, null, 2) + "\n");
console.log(`wrote ${dir}/save-steps.json; copy a test PDF to ${pdf}`);
