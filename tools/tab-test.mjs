// Checks tabs in the real app: launches the debug build (dev server on 1420 must be running)
// with the DevTools protocol on, then launches it again the way the .pdf file association does,
// and drives the one window over CDP (real keys for the tab shortcuts).
//   node tools/tab-test.mjs <work dir>      (copies spike/out/test.pdf to a.pdf … d.pdf there)
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const dir = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: node tools/tab-test.mjs <work dir>");
const root = path.resolve(import.meta.dirname, "..");
const exe = path.join(root, "src-tauri", "target", "debug", "typenote.exe");
for (const n of ["a", "b", "c", "d", "n10", "N2", "n1"]) fs.copyFileSync(path.join(root, "spike", "out", "test.pdf"), path.join(dir, `${n}.pdf`));
const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9222" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const started = [];
/** starts the app; the first launch keeps running, later ones hand over and exit */
function launch(args, cwd = dir) {
  const p = spawn(exe, args, { cwd, env, stdio: "ignore" });
  started.push(p);
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

let ws = null;
let nextId = 1;
async function connect() {
  let target;
  for (let i = 0; i < 40 && !(target = (await pages())[0]); i++) await sleep(250);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
}
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve) => {
    const on = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== id) return;
      ws.removeEventListener("message", on);
      resolve(msg.result);
    };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }))?.result?.value;

/** a real key press (modifiers: 2 Ctrl, 8 Shift) */
async function key(k, code, vk, modifiers = 0) {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers });
  await sleep(400);
}

const state = `({
  windows: 0,
  tabs: __typenote.tabs.getState().tabs.map((t) => (t.store.getState().dirty ? "*" : "") + (t.store.getState().doc?.name ?? "?")),
  shown: __typenote.store?.getState().doc?.name ?? null,
  page: document.querySelector('.pages')?.textContent ?? null,
  tabBar: document.querySelectorAll('.tabbar .tab').length,
})`;
async function show(label) {
  const s = await evaluate(state);
  s.windows = (await pages()).length;
  console.log(label.padEnd(54), JSON.stringify(s));
}

const a = path.join(dir, "a.pdf");
const b = path.join(dir, "b.pdf");
const c = path.join(dir, "c.pdf");

try {
  console.log("first launch, no file:", await launch([]));
  await connect();
  await sleep(1500);
  await show("1 one window, no tabs");

  console.log("launch a.pdf:", await launch([a]));
  await sleep(1500);
  await show("2 a.pdf in a tab");

  console.log("launch b.pdf:", await launch([b]));
  await sleep(1500);
  await show("3 b.pdf in a second tab, still one window");

  console.log("launch A.PDF (other spelling):", await launch([a.toUpperCase()]));
  await sleep(1000);
  await show("4 no new tab; a's tab shown");

  await evaluate(`__typenote.openPath(${JSON.stringify(b)}).then(() => 'ok')`);
  await sleep(500);
  await show("5 opening b.pdf from the app shows its tab");

  await evaluate("__typenote.addTestBox().then(() => 'ok')");
  await key("Tab", "Tab", 9, 2);
  await show("6 box added in b, Ctrl+Tab -> a (b unsaved)");
  await sleep(3500);
  await show("7 b autosaved in the background");

  await key("End", "End", 35);
  await show("8 End: last page in a");
  await key("Tab", "Tab", 9, 2 | 8);
  await key("Tab", "Tab", 9, 2 | 8);
  await show("9 Ctrl+Shift+Tab twice -> back to a, page kept");

  await key("Tab", "Tab", 9, 2);
  await key("w", "KeyW", 87, 2);
  await show("10 Ctrl+Tab to b, Ctrl+W closes it");

  console.log("launch b.pdf and c.pdf at once:", await launch([b, c]));
  await sleep(2000);
  await show("11 two more tabs in the given order, the last one shown");

  console.log("launch d.pdf by a relative path:", await launch(["d.pdf"], dir));
  await sleep(1500);
  await show("12 relative path resolved against the caller's folder");

  await evaluate(`__typenote.openPaths(${JSON.stringify(["n10.pdf", "N2.pdf", "n1.pdf"].map((n) => path.join(dir, n)))})`);
  await sleep(3000);
  await show("13 three at once -> n1, N2, n10 (name order), n10 shown");

  // drag the first tab past the third: it follows the pointer and lands third
  const tabAt = (i) => `(() => { const r = document.querySelectorAll('.tabbar .tab')[${i}].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width]; })()`;
  const [fx, fy] = await evaluate(tabAt(0));
  const [tx] = await evaluate(tabAt(2));
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: fx, y: fy });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: fx, y: fy, button: "left", buttons: 1, clickCount: 1 });
  for (let k = 1; k <= 10; k++) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: fx + ((tx + 10 - fx) * k) / 10, y: fy, button: "left", buttons: 1 });
    await sleep(30);
  }
  console.log("   dragging:", await evaluate(`document.querySelector('.tab.dragging')?.textContent ?? null`));
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: tx + 10, y: fy, button: "left", buttons: 0, clickCount: 1 });
  await sleep(500);
  await show("14 first tab (b) dragged to third place, shown");
  const left = await evaluate(`[...document.querySelectorAll('.tabbar .tab')].map((t) => t.style.transform || '-').join(' ')`);
  console.log("   transforms after drop:", left);

  // I-beam only over text lines (select tool, then highlight tool)
  await sleep(1000);
  const cursorScan = async (layer) => {
    const lines = await evaluate(`__typenote.tabs.active.client.textLines(__typenote.tabs.active.view.page)`);
    const sz = await evaluate(`__typenote.store.getState().doc.info.pages[__typenote.tabs.active.view.page]`);
    const r = await evaluate(`(() => { const r = document.querySelector('${layer}').getBoundingClientRect(); return [r.left, r.top, r.width]; })()`);
    const k = r[2] / sz.width;
    const [x0, y0, x1, y1] = lines[0];
    const on = [r[0] + ((x0 + x1) / 2) * k, r[1] + ((y0 + y1) / 2) * k];
    const off = [r[0] + 5 * k, r[1] + (sz.height - 5) * k];
    const read = async ([x, y]) => {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await sleep(50);
      return evaluate(`getComputedStyle(document.querySelector('${layer}')).cursor + ' ' + document.elementFromPoint(${x}, ${y})?.className`);
    };
    return { lines: lines.length, onText: await read(on), offText: await read(off) };
  };
  await key("v", "KeyV", 86); // the tool is remembered between runs
  console.log("15 select tool cursor:   ", JSON.stringify(await cursorScan(".text-layer")));
  await key("h", "KeyH", 72);
  console.log("16 highlight tool cursor:", JSON.stringify(await cursorScan(".hl-layer")));
} finally {
  ws?.close();
  // only what this script started (never an installed copy the user is running)
  for (const p of started) if (p.exitCode === null) p.kill();
}
