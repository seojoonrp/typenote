// hb-subset via the raw harfbuzz-subset.wasm shipped in harfbuzzjs.
// harfbuzzjs v1's typed API has no subsetting, so the C API is driven directly.
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

// hb-subset.h (not shipped with the npm package; verified empirically by verify.ts:
// subset cmap must map every codepoint to the same GID as the original font)
const HB_MEMORY_MODE_READONLY = 1;
const HB_SUBSET_FLAGS_RETAIN_GIDS = 0x2;
const HB_SUBSET_SETS_DROP_TABLE_TAG = 3;

// Layout tables are useless inside a PDF (no shaping happens there).
const DROP_TABLES = ["GSUB", "GPOS", "GDEF", "DSIG"];

type HbExports = {
  memory: WebAssembly.Memory;
  _initialize(): void;
  malloc(n: number): number;
  free(p: number): void;
  hb_blob_create(data: number, len: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(b: number): void;
  hb_blob_get_length(b: number): number;
  hb_blob_get_data(b: number, lenPtr: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(f: number): void;
  hb_face_reference_blob(f: number): number;
  hb_set_add(s: number, v: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(i: number): void;
  hb_subset_input_unicode_set(i: number): number;
  hb_subset_input_set(i: number, which: number): number;
  hb_subset_input_get_flags(i: number): number;
  hb_subset_input_set_flags(i: number, flags: number): void;
  hb_subset_or_fail(face: number, input: number): number;
};

let hbPromise: Promise<HbExports> | undefined;

function loadHb(): Promise<HbExports> {
  hbPromise ??= (async () => {
    const path = fileURLToPath(import.meta.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm"));
    const { instance } = await WebAssembly.instantiate(fs.readFileSync(path), {});
    const ex = instance.exports as unknown as HbExports;
    ex._initialize();
    return ex;
  })();
  return hbPromise;
}

const tag = (s: string) => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;

/** Subset a TTF to the given codepoints, keeping original glyph IDs (CID = GID). */
export async function subsetRetainGids(font: Uint8Array, codepoints: Iterable<number>): Promise<Uint8Array> {
  const hb = await loadHb();
  const fontPtr = hb.malloc(font.byteLength);
  new Uint8Array(hb.memory.buffer).set(font, fontPtr);
  const blob = hb.hb_blob_create(fontPtr, font.byteLength, HB_MEMORY_MODE_READONLY, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);
  const input = hb.hb_subset_input_create_or_fail();
  if (!input) throw new Error("hb_subset_input_create_or_fail failed");
  try {
    const unicodes = hb.hb_subset_input_unicode_set(input);
    for (const cp of codepoints) hb.hb_set_add(unicodes, cp);
    const drop = hb.hb_subset_input_set(input, HB_SUBSET_SETS_DROP_TABLE_TAG);
    for (const t of DROP_TABLES) hb.hb_set_add(drop, tag(t));
    hb.hb_subset_input_set_flags(input, hb.hb_subset_input_get_flags(input) | HB_SUBSET_FLAGS_RETAIN_GIDS);

    const subsetFace = hb.hb_subset_or_fail(face, input);
    if (!subsetFace) throw new Error("hb_subset_or_fail failed");
    const out = hb.hb_face_reference_blob(subsetFace);
    const len = hb.hb_blob_get_length(out);
    const ptr = hb.hb_blob_get_data(out, 0);
    const result = new Uint8Array(hb.memory.buffer).slice(ptr, ptr + len);
    hb.hb_blob_destroy(out);
    hb.hb_face_destroy(subsetFace);
    return result;
  } finally {
    hb.hb_subset_input_destroy(input);
    hb.hb_face_destroy(face);
    hb.free(fontPtr);
  }
}
