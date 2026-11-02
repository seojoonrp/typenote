// Pretendard faces (parsed TTFs). No mupdf here: the main thread uses this for layout too.
import type { Weight } from "./model";
import { parseTTF, type TTF } from "./ttf";

export const RES_NAME: Record<Weight, string> = { regular: "PR", semibold: "PS" };
export const WEIGHT_OF_RES: Record<string, Weight | undefined> = { PR: "regular", PS: "semibold" };

export type Face = { weight: Weight; resName: string; ttf: TTF; bytes: Uint8Array };
export type Faces = Record<Weight, Face>;

export function makeFaces(bytes: Record<Weight, Uint8Array>): Faces {
  const face = (weight: Weight): Face => ({ weight, resName: RES_NAME[weight], ttf: parseTTF(bytes[weight]), bytes: bytes[weight] });
  return { regular: face("regular"), semibold: face("semibold") };
}
