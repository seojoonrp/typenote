// Main-thread handle to the MuPDF worker.
import type { DocInfo, ErrorCode, RenderParams, RenderResult, Request, Response } from "./protocol";

export class PdfError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: PdfError) => void };
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export class PdfClient {
  private worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private pending = new Map<number, Pending>();
  private nextId = 1;

  constructor() {
    this.worker.addEventListener("message", (ev: MessageEvent<Response>) => {
      const msg = ev.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new PdfError(msg.code, msg.message));
    });
    // a worker that fails to load would otherwise leave every call hanging
    this.worker.addEventListener("error", (ev) => {
      const err = new PdfError("failed", `PDF 엔진 오류: ${ev.message || "worker failed to load"}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
  }

  private send<T>(msg: DistributiveOmit<Request, "id">, transfer: Transferable[] = []): { id: number; promise: Promise<T> } {
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    });
    this.worker.postMessage({ ...msg, id }, transfer);
    return { id, promise };
  }

  /** Takes ownership of the bytes (the buffer is transferred to the worker). */
  open(bytes: Uint8Array): Promise<DocInfo> {
    const buffer =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer
        ? bytes.buffer
        : bytes.slice().buffer;
    return this.send<DocInfo>({ kind: "open", bytes: buffer }, [buffer]).promise;
  }

  close(): Promise<void> {
    return this.send<void>({ kind: "close" }).promise;
  }

  render(params: RenderParams): { id: number; promise: Promise<RenderResult> } {
    return this.send<RenderResult>({ kind: "render", ...params });
  }

  cancel(ids: number[]) {
    if (ids.length) this.worker.postMessage({ kind: "cancel", ids, id: 0 } satisfies Request);
  }
}
