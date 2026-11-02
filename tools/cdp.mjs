// Minimal CDP client for the WebView2 inside the Tauri app (started by run-app.ps1).
// usage: node cdp.mjs <steps.json>, a list of steps:
//   {"eval": "js expr"} | {"cmd": "Domain.method", "params": {...}} | {"wait": ms} | {"shot": "out.png"}
//   | {"ps": "PowerShell script"}  (runs in the background, e.g. to lock the file from another process)
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

for (const step of steps) {
  if (step.wait) await new Promise((r) => setTimeout(r, step.wait));
  else if (step.ps) {
    // -EncodedCommand avoids Windows command-line quoting mangling the script; not detached,
    // since a detached console process never ran here
    const encoded = Buffer.from(step.ps, "utf16le").toString("base64");
    spawn("powershell", ["-NoProfile", "-EncodedCommand", encoded], { stdio: "ignore" }).unref();
    console.log("started powershell script");
  }
  else if (step.shot) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(step.shot, Buffer.from(r.result.data, "base64"));
    console.log("shot", step.shot);
  }
  else if (step.eval) {
    const r = await send("Runtime.evaluate", { expression: step.eval, awaitPromise: true, returnByValue: true });
    console.log(step.label ?? "eval", "=>", JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? r.error));
  } else if (step.cmd) {
    const r = await send(step.cmd, step.params);
    console.log(step.label ?? step.cmd, r.error ? "ERROR " + JSON.stringify(r.error) : "ok");
  }
}
ws.close();
