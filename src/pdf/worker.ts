// Worker entry. The session (MuPDF, engine) is imported lazily: mupdf initializes with a
// top-level await, and a static import would register this listener only afterwards, dropping
// messages that arrive meanwhile. Messages are handled strictly in order.
import type { Request, Response } from "./protocol";

const port = self as unknown as Worker;
const reply = (msg: Response, transfer: Transferable[] = []) => port.postMessage(msg, transfer);
const session = import("./session");

let inbox: Promise<void> = Promise.resolve();

port.addEventListener("message", (ev: MessageEvent<Request>) => {
  const msg = ev.data;
  inbox = inbox.then(() =>
    session.then(
      (s) => s.handle(msg, reply),
      (e: unknown) => {
        if (msg.kind !== "cancel") reply({ id: msg.id, ok: false, code: "failed", message: `Could not load MuPDF: ${String(e)}` });
      },
    ),
  );
});
