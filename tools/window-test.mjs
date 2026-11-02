// Checks "one window per document" in the real app: launches the debug build (dev server on
// 1420 must be running) with the DevTools protocol on, then launches it again the way the .pdf
// file association does and inspects every window over CDP.
//   node tools/window-test.mjs <work dir>      (copies spike/out/test.pdf to a.pdf, b.pdf, c.pdf)
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const dir = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: node tools/window-test.mjs <work dir>");
const root = path.resolve(import.meta.dirname, "..");
const exe = path.join(root, "src-tauri", "target", "debug", "typenote.exe");
for (const n of ["a", "b", "c"]) fs.copyFileSync(path.join(root, "spike", "out", "test.pdf"), path.join(dir, `${n}.pdf`));
const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9222" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** starts the app; the first launch keeps running, later ones hand over and exit */
function launch(args, cwd = dir) {
  const p = spawn(exe, args, { cwd, env, stdio: "ignore" });
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve("running"), 3000);
    p.on("exit", (code) => {
      clearTimeout(t);
      resolve(`exited ${code}`);
    });
  });
}

async function pages() {
  try {
    const list = await (await fetch("http://127.0.0.1:9222/json")).json();
    return list.filter((t) => t.type === "page");
  } catch {
    return [];
  }
}

async function evaluate(target, expression) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  const result = new Promise((resolve) => {
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) resolve(msg.result?.result?.value ?? msg.result?.exceptionDetails?.text);
    });
    // a window that closes itself never answers
    ws.addEventListener("close", () => resolve(null));
    setTimeout(() => resolve(null), 5000);
  });
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  const value = await result;
  ws.close();
  return value;
}

/** every window: its label, the open document and whether it has focus */
async function windows() {
  const out = [];
  for (const t of await pages()) {
    const v = await evaluate(
      t,
      `({ label: window.__TAURI_INTERNALS__.metadata.currentWindow.label, doc: __typenote.store.getState().doc?.name ?? null, focus: document.hasFocus() })`,
    );
    out.push(v);
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

async function showing(name) {
  for (const t of await pages()) if ((await evaluate(t, "__typenote.store.getState().doc?.name")) === name) return t;
  throw new Error(`no window shows ${name}`);
}

async function settle(count) {
  for (let i = 0; i < 40 && (await pages()).length !== count; i++) await sleep(250);
  await sleep(1500);
}

const show = async (label) => console.log(label.padEnd(58), JSON.stringify(await windows()));
const a = path.join(dir, "a.pdf");
const b = path.join(dir, "b.pdf");

try {
  console.log("first launch, no file:", await launch([]));
  await settle(1);
  await show("1 one window, no document");

  console.log("launch a.pdf:", await launch([a]));
  await settle(1);
  await show("2 the empty window took a.pdf");

  console.log("launch b.pdf:", await launch([b]));
  await settle(2);
  await show("3 new window for b.pdf");

  console.log("launch A.PDF (other spelling):", await launch([a.toUpperCase()]));
  await settle(2);
  await show("4 still two windows; a's window focused");

  const bTarget = await showing("b.pdf");
  await evaluate(bTarget, `__typenote.openPath(${JSON.stringify(a)}).then(() => 'ok')`);
  await sleep(800);
  await show("5 opening a.pdf from b's window leaves b alone");

  const label = await evaluate(bTarget, "window.__TAURI_INTERNALS__.metadata.currentWindow.label");
  await evaluate(bTarget, `window.__TAURI_INTERNALS__.invoke('plugin:window|destroy', { label: ${JSON.stringify(label)} }).then(() => 'ok', (e) => String(e))`);
  await settle(1);
  await show("6 b's window closed");
  console.log("launch b.pdf again:", await launch([b]));
  await settle(2);
  await show("7 b.pdf opens in a new window again");

  console.log("launch c.pdf by a relative path:", await launch(["c.pdf"], dir));
  await settle(3);
  await show("8 relative path resolved against the caller's folder");
} finally {
  spawn("taskkill", ["/IM", "typenote.exe", "/F"], { stdio: "ignore" });
}
