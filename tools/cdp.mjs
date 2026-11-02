// Minimal CDP client for the WebView2 inside the Tauri app (started by run-app.ps1).
// usage: node cdp.mjs <steps.json>, a list of steps:
//   {"eval": "js expr", "save"?: "out.json"} | {"cmd": "Domain.method", "params": {...}} | {"wait": ms} | {"shot": "out.png"}
//   | {"ps": "PowerShell script"}  (runs in the background, e.g. to lock the file from another process)
//   | {"click": "js expr -> [clientX, clientY]", "count"?: 2, "mods"?: 8}   real mouse events
//   | {"drag": {"from": "js expr", "to": "js expr"}, "mods"?: 0}
//   | {"press": "js expr"} | {"move": "js expr"} | {"release": "js expr"}   a drag in pieces
//   | {"key": "Escape", "mods"?: 2, "composing"?: true}   (mods: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift)
// Every step may have a "label".
import fs from "node:fs";
import { spawn } from "node:child_process";

const steps = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
let targets = [];
for (let i = 0; i < 40; i++) {
  try {
    targets = await (await fetch("http://127.0.0.1:9222/json")).json();
    if (targets.some((t) => t.type === "page")) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
console.log("targets:", targets.map((t) => `${t.type} ${t.url} "${t.title}"`).join(" | "));
const page = targets.find((t) => t.type === "page" && /tauri\.localhost|^tauri:/.test(t.url)) ?? targets.find((t) => t.type === "page");
if (!page) throw new Error("no page target");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? r.error;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// key name -> [code, windows virtual key code, text]
const KEYS = {
  Escape: ["Escape", 27], Enter: ["Enter", 13, "\r"], Delete: ["Delete", 46], Backspace: ["Backspace", 8], Tab: ["Tab", 9],
  ArrowLeft: ["ArrowLeft", 37], ArrowUp: ["ArrowUp", 38], ArrowRight: ["ArrowRight", 39], ArrowDown: ["ArrowDown", 40],
  PageUp: ["PageUp", 33], PageDown: ["PageDown", 34], Home: ["Home", 36], End: ["End", 35],
  ".": ["Period", 190], ",": ["Comma", 188], "=": ["Equal", 187], "-": ["Minus", 189],
};
function keyInfo(key) {
  if (KEYS[key]) return KEYS[key];
  if (/^[a-z]$/i.test(key)) return [`Key${key.toUpperCase()}`, key.toUpperCase().charCodeAt(0), key];
  if (/^[0-9]$/.test(key)) return [`Digit${key}`, key.charCodeAt(0), key];
  throw new Error(`unknown key ${key}`);
}

async function mouse(type, [x, y], extra = {}) {
  await send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, pointerType: "mouse", ...extra });
}

for (const step of steps) {
  const label = step.label;
  if (step.wait) await sleep(step.wait);
  else if (step.ps) {
    // -EncodedCommand avoids Windows command-line quoting mangling the script; not detached,
    // since a detached console process never ran here
    const encoded = Buffer.from(step.ps, "utf16le").toString("base64");
    spawn("powershell", ["-NoProfile", "-EncodedCommand", encoded], { stdio: "ignore" }).unref();
    console.log("started powershell script");
  } else if (step.shot) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(step.shot, Buffer.from(r.result.data, "base64"));
    console.log("shot", step.shot);
  } else if (step.eval) {
    const value = await evaluate(step.eval);
    if (step.save) fs.writeFileSync(step.save, JSON.stringify(value, null, 2));
    console.log(label ?? "eval", "=>", JSON.stringify(value));
  } else if (step.click) {
    const at = await evaluate(step.click);
    const modifiers = step.mods ?? 0;
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at[0], y: at[1], modifiers });
    for (let n = 1; n <= (step.count ?? 1); n++) {
      await mouse("mousePressed", at, { clickCount: n, modifiers });
      await mouse("mouseReleased", at, { clickCount: n, modifiers });
    }
    console.log(label ?? "click", "at", at.map((v) => Math.round(v)).join(","));
  } else if (step.drag) {
    const from = await evaluate(step.drag.from);
    const to = await evaluate(step.drag.to);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from[0], y: from[1] });
    await mouse("mousePressed", from, { clickCount: 1 });
    for (let i = 1; i <= 10; i++) {
      const p = [from[0] + ((to[0] - from[0]) * i) / 10, from[1] + ((to[1] - from[1]) * i) / 10];
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p[0], y: p[1], button: "left", buttons: 1 });
      await sleep(16);
    }
    await mouse("mouseReleased", to, { clickCount: 1 });
    console.log(label ?? "drag", from.map(Math.round).join(","), "->", to.map(Math.round).join(","));
  } else if (step.press || step.move || step.release) {
    const at = await evaluate(step.press ?? step.move ?? step.release);
    if (step.press) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at[0], y: at[1] });
      await mouse("mousePressed", at, { clickCount: 1 });
    } else if (step.move) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at[0], y: at[1], button: "left", buttons: 1 });
    } else await mouse("mouseReleased", at, { clickCount: 1 });
    console.log(label ?? (step.press ? "press" : step.move ? "move" : "release"), "at", at.map(Math.round).join(","));
  } else if (step.key) {
    const [code, vk, text] = keyInfo(step.key);
    const modifiers = step.mods ?? 0;
    // while an IME composes, Windows reports VK_PROCESSKEY (229) for every key
    const windowsVirtualKeyCode = step.composing ? 229 : vk;
    const key = step.key.length === 1 && modifiers & 8 ? step.key.toUpperCase() : step.key;
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers, key, code, windowsVirtualKeyCode });
    if (text && !(modifiers & 2) && !step.composing) await send("Input.dispatchKeyEvent", { type: "char", modifiers, key, code, text, windowsVirtualKeyCode });
    await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers, key, code, windowsVirtualKeyCode });
    console.log(label ?? "key", step.key, modifiers ? `mods ${modifiers}` : "", step.composing ? "(composing)" : "");
  } else if (step.cmd) {
    const r = await send(step.cmd, step.params);
    console.log(label ?? step.cmd, r.error ? "ERROR " + JSON.stringify(r.error) : "ok");
  }
}
ws.close();
