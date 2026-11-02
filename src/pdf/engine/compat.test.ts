// Edit/save/reopen round trips on PDFs with different file structures (corpus.ts).
import * as fs from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { editRoundTrip, variants } from "./corpus";
import { makeFaces, type FontKit } from "./fonts";
import { createSubsetter } from "./subset";

let kit: FontKit;
const loadKit = async () => kit;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  kit = {
    faces: makeFaces({
      regular: new Uint8Array(fs.readFileSync("fonts/Pretendard-Regular.ttf")),
      semibold: new Uint8Array(fs.readFileSync("fonts/Pretendard-SemiBold.ttf")),
    }),
    subsetter: await createSubsetter(fs.readFileSync(require.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm"))),
  };
});

const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) < 0.01);

describe("compatibility round trips", () => {
  for (const v of variants()) {
    it(v.name, async () => {
      const r = await editRoundTrip(v.bytes, loadKit);

      // a repaired file is rewritten in full once; after that saves append
      expect(r.first.mode).toBe(v.repaired ? "full" : "incremental");
      expect(r.second.mode).toBe("incremental");
      expect(r.repairedAfterFirst).toBe(false);
      expect(r.repairedAfterSecond).toBe(false);
      expect(Buffer.from(r.second.bytes.subarray(0, r.first.bytes.length)).equals(Buffer.from(r.first.bytes))).toBe(true);
      if (!v.repaired) expect(Buffer.from(r.first.bytes.subarray(0, v.bytes.length)).equals(Buffer.from(v.bytes))).toBe(true);
      expect(r.encrypted).toBe(!!v.encrypted);

      // the model reads back what was written
      expect(r.boxes).toHaveLength(1);
      const { objNum, ...box } = r.boxes[0]!;
      expect(objNum).toBeGreaterThan(0);
      expect({ ...box, x: 0, y: 0 }).toEqual({ ...r.expected.box, x: 0, y: 0 });
      expect(close([box.x, box.y], [r.expected.box.x, r.expected.box.y])).toBe(true);
      const ours = r.highlights.filter((h) => r.expected.highlights.some((e) => e.id === h.id));
      expect(ours.map((h) => [h.id, h.page, h.color, h.opacity])).toEqual(r.expected.highlights.map((h) => [h.id, h.page, h.color, h.opacity]));
      for (const h of ours) {
        const e = r.expected.highlights.find((x) => x.id === h.id)!;
        expect(h.quads.every((q, i) => close(q, e.quads[i]!))).toBe(true);
      }

      // MuPDF extracts the box text from the appearance (embedded font, ToUnicode, decryption)
      expect([...r.extracted.values()]).toEqual([r.expected.box.text]);

      // other programs' annotations are untouched: one app FreeText and one more highlight
      const expected = { ...r.before, "FreeText(app)": 1, Highlight: (r.before.Highlight ?? 0) + 2 };
      expect(r.after).toEqual(expected);
    });
  }
});
