// Main-thread handle to the MuPDF worker.
import type { HighlightInput, TextBoxInput } from "./engine/model";
import type {
  ErrorCode,
  OpenResult,
  PutHighlightResult,
  PutTextBoxResult,
  RenderParams,
  RenderResult,
  Request,
  Response,
  SaveResult,
  SelectTextParams,
  SelectTextResult,
} from "./protocol";

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
  open(bytes: Uint8Array): Promise<OpenResult> {
    const buffer =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer
        ? bytes.buffer
        : bytes.slice().buffer;
    return this.send<OpenResult>({ kind: "open", bytes: buffer }, [buffer]).promise;
  }

  /** Creates (no id) or updates a text box; the result carries its id and object number. */
  putTextBox(box: TextBoxInput): Promise<PutTextBoxResult> {
    return this.send<PutTextBoxResult>({ kind: "putTextBox", box }).promise;
  }

  /** Resolves to the page the box was on, or null if it did not exist. */
  deleteTextBox(boxId: string): Promise<number | null> {
    return this.send<number | null>({ kind: "deleteTextBox", boxId }).promise;
  }

  putHighlight(highlight: HighlightInput): Promise<PutHighlightResult> {
    return this.send<PutHighlightResult>({ kind: "putHighlight", highlight }).promise;
  }

  /** Resolves to the page the highlight was on, or null if it did not exist. */
  deleteHighlight(highlightId: string): Promise<number | null> {
    return this.send<number | null>({ kind: "deleteHighlight", highlightId }).promise;
  }

  /** Line quads of the page text selected between two points (or the word at `from`). */
  selectText(params: SelectTextParams): Promise<SelectTextResult> {
    return this.send<SelectTextResult>({ kind: "selectText", ...params }).promise;
  }

  /** The bytes to write to disk; the worker continues from them for the next save. */
  save(full = false): Promise<SaveResult> {
    return this.send<SaveResult>({ kind: "save", full }).promise;
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
