// Messages between the main thread and the MuPDF worker.

/** Page size in MuPDF page space (pt, rotation and CropBox applied). */
export type PageSize = { width: number; height: number };

export type DocInfo = { docId: number; pageCount: number; pages: PageSize[] };

export type RenderParams = {
  docId: number;
  page: number;
  /** device pixels per pt */
  scale: number;
  /** lower renders first */
  priority: number;
  /** hide app-managed FreeText/Highlight (they are drawn by the HTML overlay instead) */
  hideAppAnnots: boolean;
};

export type RenderResult = { bitmap: ImageBitmap; width: number; height: number };

export type Request =
  | { id: number; kind: "open"; bytes: ArrayBuffer }
  | { id: number; kind: "close" }
  | ({ id: number; kind: "render" } & RenderParams)
  | { id: number; kind: "cancel"; ids: number[] };

export type ErrorCode = "needs-password" | "not-pdf" | "cancelled" | "stale" | "failed";

export type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; code: ErrorCode; message: string };
