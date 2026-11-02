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
