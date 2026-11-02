// Annotation model shared by the worker and the UI (SPEC "데이터 모델").

export type RGB = [number, number, number]; // 0–1
export type Weight = "regular" | "semibold";

/** An app-owned FreeText. x/y: top-left of the box in MuPDF page space (pt). Lines split on "\n". */
export type TextBox = {
  id: string;
  page: number;
  x: number;
  y: number;
  text: string;
  size: number;
  weight: Weight;
  color: RGB;
  objNum?: number;
};

/** New boxes have no id yet; the engine assigns one. */
export type TextBoxInput = Omit<TextBox, "id" | "objNum"> & { id?: string };

/** /NM prefix that marks a FreeText as ours */
export const NM_PREFIX = "typenote-";

export const newBoxId = () => `${NM_PREFIX}${crypto.randomUUID()}`;

/** Four corners in MuPDF page space, in the order UL, UR, LL, LR (as StructuredText returns them). */
export type Quad = [number, number, number, number, number, number, number, number];

/**
 * Any Highlight annotation in the document (ours or another program's). id: its /NM, or
 * "obj:<number>" when it has none. Quads: one per line, MuPDF page space.
 */
export type Highlight = {
  id: string;
  page: number;
  quads: Quad[];
  color: RGB;
  /** /CA, 0–1 */
  opacity: number;
  objNum?: number;
};

export type HighlightInput = Omit<Highlight, "objNum">;

export const newHighlightId = () => `${NM_PREFIX}hl-${crypto.randomUUID()}`;
