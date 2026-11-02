// Messages between the main thread and the MuPDF worker.
import type { PutHighlightResult, SaveMode } from "./engine/editor";
import type { Highlight, HighlightInput, Quad, TextBox, TextBoxInput } from "./engine/model";

export type { PutHighlightResult };

/** Page size in MuPDF page space (pt, rotation and CropBox applied). */
export type PageSize = { width: number; height: number };

export type DocInfo = { docId: number; pageCount: number; pages: PageSize[] };
export type OpenResult = DocInfo & { textBoxes: TextBox[]; highlights: Highlight[] };
export type PutTextBoxResult = { box: TextBox; missing: string[]; pages: number[] };
export type SaveResult = { bytes: Uint8Array; mode: SaveMode; textBoxes: TextBox[]; highlights: Highlight[] };

/** "chars": from one point to another, like a drag; "word": the word under `from`. */
export type SelectMode = "chars" | "word";
export type SelectTextParams = { page: number; from: [number, number]; to: [number, number]; mode: SelectMode };
/** One quad per line; empty when `from` is not on text (or the page has none, e.g. a scan). */
export type SelectTextResult = Quad[];

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
  | { id: number; kind: "putHighlight"; highlight: HighlightInput }
  | { id: number; kind: "deleteHighlight"; highlightId: string }
  | ({ id: number; kind: "selectText" } & SelectTextParams)
  | { id: number; kind: "save"; full: boolean };

export type ErrorCode = "needs-password" | "not-pdf" | "cancelled" | "stale" | "no-document" | "failed";

export type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; code: ErrorCode; message: string };
