// Messages between the main thread and the MuPDF worker.
import type { SaveMode } from "./engine/editor";
import type { TextBox, TextBoxInput } from "./engine/model";

/** Page size in MuPDF page space (pt, rotation and CropBox applied). */
export type PageSize = { width: number; height: number };

export type DocInfo = { docId: number; pageCount: number; pages: PageSize[] };
export type OpenResult = DocInfo & { textBoxes: TextBox[] };
export type PutTextBoxResult = { box: TextBox; missing: string[]; pages: number[] };
export type SaveResult = { bytes: Uint8Array; mode: SaveMode; textBoxes: TextBox[] };

export type RenderParams = {
  docId: number;
  page: number;
  /** device pixels per pt */
  scale: number;
  /** lower renders first */
  priority: number;
  /** annotations drawn by the HTML overlay instead of the base bitmap */
  hide: HiddenAnnots;
};

export type HiddenAnnots = { textBoxes: boolean; highlights: boolean };

export type RenderResult = { bitmap: ImageBitmap; width: number; height: number };

export type Request =
  | { id: number; kind: "open"; bytes: ArrayBuffer }
  | { id: number; kind: "close" }
  | ({ id: number; kind: "render" } & RenderParams)
  | { id: number; kind: "cancel"; ids: number[] }
  | { id: number; kind: "putTextBox"; box: TextBoxInput }
  | { id: number; kind: "deleteTextBox"; boxId: string }
  | { id: number; kind: "save"; full: boolean };

export type ErrorCode = "needs-password" | "not-pdf" | "cancelled" | "stale" | "no-document" | "failed";

export type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; code: ErrorCode; message: string };
