// hb-subset via the raw harfbuzz-subset.wasm shipped in harfbuzzjs (its typed v1 API has no
// subsetting). The caller supplies the wasm bytes, so this runs in the worker and in Node tests.

// hb-subset.h values (not shipped with the npm package). RETAIN_GIDS is verified by the engine
// tests: the subset's cmap must map every codepoint to the same GID as the original font.
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

export type Subsetter = {
  /** Subset a TTF to the given codepoints, keeping original glyph IDs (CID = GID). */
  subset(font: Uint8Array, codepoints: Iterable<number>): Uint8Array;
};

const tag = (s: string) => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;

export async function createSubsetter(wasm: BufferSource): Promise<Subsetter> {
  const { instance } = await WebAssembly.instantiate(wasm, {});
  const hb = instance.exports as unknown as HbExports;
  hb._initialize();

  return {
    subset(font, codepoints) {
      const fontPtr = hb.malloc(font.byteLength);
      new Uint8Array(hb.memory.buffer).set(font, fontPtr);
      const blob = hb.hb_blob_create(fontPtr, font.byteLength, HB_MEMORY_MODE_READONLY, 0, 0);
      const face = hb.hb_face_create(blob, 0);
      hb.hb_blob_destroy(blob);
      const input = hb.hb_subset_input_create_or_fail();
      try {
        if (!input) throw new Error("hb_subset_input_create_or_fail failed");
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
        if (input) hb.hb_subset_input_destroy(input);
        hb.hb_face_destroy(face);
        hb.free(fontPtr);
      }
    },
  };
}
