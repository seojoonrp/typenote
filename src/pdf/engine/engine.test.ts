// Phase 0's verify.ts checks, run against the app engine in Node.
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as mupdf from "mupdf";
import { beforeAll, describe, expect, it } from "vitest";
import { shownText } from "./content";
import { PdfEditor } from "./editor";
import { makeFaces, type FontKit } from "./fonts";
import { locateAppFreeTexts, normalAppearance } from "./freetext";
import { newHighlightId, type Quad, type RGB, type TextBox, type TextBoxInput } from "./model";
import { createSubsetter } from "./subset";
import { parseToUnicode } from "./tounicode";
import { parseTTF } from "./ttf";

let kit: FontKit;
const loadKit = async () => kit;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasm = fs.readFileSync(require.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm"));
  kit = {
    faces: makeFaces({
      regular: new Uint8Array(fs.readFileSync("fonts/Pretendard-Regular.ttf")),
      semibold: new Uint8Array(fs.readFileSync("fonts/Pretendard-SemiBold.ttf")),
    }),
    subsetter: await createSubsetter(wasm),
  };
});

/** p1 A4, p2 /Rotate 90, p3 /Rotate 270 + offset CropBox, p4 A4. */
function fixture(): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const helv = doc.addSimpleFont(new mupdf.Font("Helvetica"), "Latin");
  const specs: { rotate: mupdf.Rotate; crop?: mupdf.Rect }[] = [{ rotate: 0 }, { rotate: 90 }, { rotate: 270, crop: [30, 40, 565, 800] }, { rotate: 0 }];
  for (const s of specs) {
    const page = doc.addPage([0, 0, 595, 842], s.rotate, { Font: { F1: helv } }, "BT /F1 12 Tf 56 780 Td (Base page text) Tj ET");
    doc.insertPage(-1, page);
    if (s.crop) page.put("CropBox", s.crop);
  }
  return doc.saveToBuffer("compress").asUint8Array().slice();
}

const open = (bytes: Uint8Array) => new PdfEditor(new mupdf.PDFDocument(bytes), loadKit);

const BOXES: TextBoxInput[] = [
  { page: 0, x: 56, y: 200, text: "Regular 12pt 검정 한 줄: 안녕하세요, Typenote!", size: 12, weight: "regular", color: [0, 0, 0] },
  { page: 0, x: 56, y: 250, text: "SemiBold 18pt 파랑 여러 줄\n한글 English 0123456789\n기호 ~!@#$%^&*()_+-=[]{};:'\",.<>/?\n“따옴표” · … → ※ ㈜ ① ½ °C", size: 18, weight: "semibold", color: [0.05, 0.3, 0.85] },
  { page: 1, x: 56, y: 160, text: "회전 90 페이지 위의 상자\n두 번째 줄", size: 14, weight: "regular", color: [0.8, 0.1, 0.1] },
  { page: 2, x: 56, y: 120, text: "회전 270 + CropBox 상자", size: 12, weight: "semibold", color: [0.1, 0.55, 0.2] },
];

async function withBoxes(inputs = BOXES) {
  const ed = open(fixture());
  const boxes: TextBox[] = [];
  for (const b of inputs) boxes.push((await ed.putTextBox(b)).box);
  const saved = await ed.save();
  return { boxes, saved, reopened: new mupdf.PDFDocument(saved.bytes) };
}

/** NM -> appearance stream identity and bytes */
function apSnapshot(doc: mupdf.PDFDocument) {
  const m = new Map<string, { annot: number; ap: number; raw: string; decoded: string }>();
  for (const { annot } of locateAppFreeTexts(doc)) {
    const ap = normalAppearance(annot)!;
    m.set(annot.get("NM").asString(), {
      annot: annot.asIndirect(),
      ap: ap.asIndirect(),
      raw: Buffer.from(ap.readRawStream().asUint8Array()).toString("base64"),
      decoded: ap.readStream().asString(),
    });
  }
  return m;
}

/** Text the appearance stream actually shows, decoded through each font's ToUnicode CMap. */
function shownByAp(annot: mupdf.PDFObject): { text: string; missingOutlines: string[] } {
  const ap = normalAppearance(annot)!;
  const fonts = ap.get("Resources").get("Font");
  const missingOutlines: string[] = [];
  const text = shownText(ap.readStream().asString())
    .map((runs) =>
      runs
        .map((run) => {
          const font = fonts.get(run.font);
          const tu = parseToUnicode(font.get("ToUnicode").readStream().asString());
          const ttf = parseTTF(font.get("DescendantFonts").get(0).get("FontDescriptor").get("FontFile2").readStream().asUint8Array().slice());
          return run.codes
            .map((cid) => {
              const ch = tu.get(cid) ?? "�";
              if (!/\s/.test(ch) && ttf.glyphDataLength(cid) === 0) missingOutlines.push(ch);
              return ch;
            })
            .join("");
        })
        .join(""),
    )
    .join("\n");
  return { text, missingOutlines };
}

describe("PdfEditor", () => {
  it("embeds Pretendard subsets and the appearance text round-trips through ToUnicode", async () => {
    const { reopened } = await withBoxes();
    const found = locateAppFreeTexts(reopened);
    expect(found).toHaveLength(4);
    for (const { annot } of found) {
      const ap = normalAppearance(annot)!;
      ap.get("Resources").get("Font").forEach((font) => {
        expect(font.get("Subtype").asName()).toBe("Type0");
        expect(font.get("Encoding").asName()).toBe("Identity-H");
        const cid = font.get("DescendantFonts").get(0);
        expect(cid.get("Subtype").asName()).toBe("CIDFontType2");
        expect(cid.get("CIDToGIDMap").asName()).toBe("Identity");
        expect(cid.get("FontDescriptor").get("FontFile2").readStream().getLength()).toBeGreaterThan(0);
        expect(font.get("BaseFont").asName()).toMatch(/^[A-Z]{6}\+Pretendard-(Regular|SemiBold)$/);
      });
      const shown = shownByAp(annot);
      expect(shown.text).toBe(annot.get("Contents").asString().replace(/\r/g, "\n"));
      expect(shown.missingOutlines).toEqual([]);
    }
  });

  it("MuPDF's own text extraction of each box matches its text", async () => {
    const { reopened } = await withBoxes();
    for (let i = 0; i < reopened.countPages(); i++) {
      const page = reopened.loadPage(i);
      for (const a of page.getAnnotations()) {
        if (a.getType() !== "FreeText") continue;
        const text = a.toDisplayList().toStructuredText("preserve-whitespace").asText().replace(/\n+$/, "");
        expect(text).toBe(a.getObject().get("Contents").asString().replace(/\r/g, "\n"));
      }
    }
  });

  it("reads back the boxes it wrote", async () => {
    const { boxes, reopened } = await withBoxes();
    const read = new PdfEditor(reopened, loadKit).textBoxes();
    expect(read).toHaveLength(boxes.length);
    for (const b of boxes) {
      const r = read.find((x) => x.id === b.id)!;
      expect(r.id.startsWith("typenote-")).toBe(true);
      expect(r).toMatchObject({ page: b.page, text: b.text, size: b.size, weight: b.weight, color: b.color, objNum: b.objNum });
      expect(r.x).toBeCloseTo(b.x, 3);
      expect(r.y).toBeCloseTo(b.y, 3);
    }
  });

  it("keeps boxes upright on rotated pages", async () => {
    const { reopened } = await withBoxes();
    for (const { page, annot } of locateAppFreeTexts(reopened)) {
      const p = reopened.loadPage(page);
      const ctm = p.getTransform();
      const m = normalAppearance(annot)!.get("Matrix");
      const M = [0, 1, 2, 3, 4, 5].map((k) => m.get(k).asNumber()) as mupdf.Matrix;
      const net = mupdf.Matrix.concat(M, [ctm[0], ctm[1], ctm[2], ctm[3], 0, 0]).slice(0, 4).map((v) => Math.round(v));
      expect(net).toEqual([1, 0, 0, -1]);
      const dirs: mupdf.Point[] = [];
      const a = p.getAnnotations().find((x) => x.getObject().asIndirect() === annot.asIndirect())!;
      a.toDisplayList().toStructuredText("preserve-whitespace").walk({ beginLine: (_b, _w, d) => void dirs.push(d) });
      for (const d of dirs) expect([Math.round(d[0]), Math.round(d[1])]).toEqual([1, 0]);
    }
  });

  it("edits in place: same objects, other boxes untouched, fonts re-subset into the same objects", async () => {
    const { boxes, saved, reopened } = await withBoxes();
    const before = apSnapshot(reopened);
    const fontsBefore = locateAppFreeTexts(reopened).map(({ annot }) => normalAppearance(annot)!.get("Resources").get("Font").toString(true));
    const ed = open(saved.bytes);
    const target = boxes[0]!;
    const r = await ed.putTextBox({ ...target, text: "바뀐 내용: 뷁 똠 햏 쀍", size: 16, color: [0.5, 0, 0.5] });
    expect(r.box.objNum).toBe(target.objNum);
    const after = new mupdf.PDFDocument((await ed.save()).bytes);
    const snap = apSnapshot(after);
    expect(snap.get(target.id)!.annot).toBe(before.get(target.id)!.annot);
    expect(snap.get(target.id)!.ap).toBe(before.get(target.id)!.ap);
    expect(snap.get(target.id)!.decoded).not.toBe(before.get(target.id)!.decoded);
    for (const b of boxes.slice(1)) expect(snap.get(b.id)).toEqual(before.get(b.id));
    const fontsAfter = locateAppFreeTexts(after).map(({ annot }) => normalAppearance(annot)!.get("Resources").get("Font").toString(true));
    expect(fontsAfter).toEqual(fontsBefore);
    for (const { annot } of locateAppFreeTexts(after)) expect(shownByAp(annot).missingOutlines).toEqual([]);
    expect(shownByAp(after.newIndirect(target.objNum!)).text).toBe("바뀐 내용: 뷁 똠 햏 쀍");
  });

  it("moving within the page only changes /Rect", async () => {
    const { boxes, saved, reopened } = await withBoxes();
    const before = apSnapshot(reopened);
    const ed = open(saved.bytes);
    const b = boxes[2]!; // rotated page
    await ed.putTextBox({ ...b, x: b.x + 40, y: b.y + 25 });
    const moved = new PdfEditor(new mupdf.PDFDocument((await ed.save()).bytes), loadKit).textBoxes().find((x) => x.id === b.id)!;
    expect(moved.x).toBeCloseTo(b.x + 40, 3);
    expect(moved.y).toBeCloseTo(b.y + 25, 3);
    expect(apSnapshot(ed.doc).get(b.id)!.decoded).toBe(before.get(b.id)!.decoded);
  });

  it("moves a box to another page under the same id", async () => {
    const { boxes, saved } = await withBoxes();
    const ed = open(saved.bytes);
    const r = await ed.putTextBox({ ...boxes[0]!, page: 3 });
    expect(r.pages.sort()).toEqual([0, 3]);
    const read = new PdfEditor(new mupdf.PDFDocument((await ed.save()).bytes), loadKit).textBoxes();
    expect(read.filter((x) => x.id === boxes[0]!.id).map((x) => x.page)).toEqual([3]);
  });

  it("switching weight switches font resource and /DA", async () => {
    const { boxes, saved } = await withBoxes();
    const ed = open(saved.bytes);
    await ed.putTextBox({ ...boxes[0]!, weight: "semibold" });
    const doc = new mupdf.PDFDocument((await ed.save()).bytes);
    const annot = doc.newIndirect(boxes[0]!.objNum!);
    expect(annot.get("DA").asString()).toMatch(/^\/PS 12 Tf/);
    expect(normalAppearance(annot)!.get("Resources").get("Font").get("PS").isIndirect()).toBe(true);
    expect(shownByAp(annot).text).toBe(boxes[0]!.text);
  });

  it("deleting a box removes it and its glyphs leave the subset at save", async () => {
    const extra: TextBoxInput = { page: 3, x: 50, y: 50, text: "쀍뷁", size: 12, weight: "regular", color: [0, 0, 0] };
    const { boxes, saved } = await withBoxes([...BOXES, extra]);
    const ed = open(saved.bytes);
    const victim = boxes.at(-1)!;
    expect(ed.deleteTextBox(victim.id)).toBe(3);
    expect(ed.deleteTextBox(victim.id)).toBeNull();
    const doc = new mupdf.PDFDocument((await ed.save()).bytes);
    expect(locateAppFreeTexts(doc).map(({ annot }) => annot.get("NM").asString())).not.toContain(victim.id);
    const regular = normalAppearance(doc.newIndirect(boxes[0]!.objNum!))!.get("Resources").get("Font").get("PR");
    const tu = [...parseToUnicode(regular.get("ToUnicode").readStream().asString()).values()].join("");
    expect(tu).not.toContain("쀍");
    expect(tu).toContain("안");
  });

  it("consecutive saves stay incremental and append to the previous file", async () => {
    const ed1 = open(fixture());
    await ed1.putTextBox(BOXES[0]!);
    const s1 = await ed1.save();
    expect(s1.mode).toBe("incremental");
    const ed2 = open(s1.bytes);
    await ed2.putTextBox(BOXES[1]!);
    const s2 = await ed2.save();
    expect(s2.mode).toBe("incremental");
    expect(Buffer.from(s2.bytes.subarray(0, s1.bytes.length)).equals(Buffer.from(s1.bytes))).toBe(true);
    expect(new mupdf.PDFDocument(s2.bytes).countVersions()).toBe(new mupdf.PDFDocument(s1.bytes).countVersions() + 1);
  });

  it("MuPDF leaves our appearance streams alone through render, page.update() and highlight edits", async () => {
    const { saved } = await withBoxes();
    const doc = new mupdf.PDFDocument(saved.bytes);
    const before = apSnapshot(doc);
    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i);
      page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
      if (i === 0) {
        const h = page.createAnnotation("Highlight");
        h.setQuadPoints([[56, 60, 200, 60, 56, 75, 200, 75]]);
        h.setColor([1, 1, 0]);
        h.update();
      }
      page.update();
      for (const a of page.getAnnotations()) a.update();
      page.destroy();
    }
    const after = apSnapshot(new mupdf.PDFDocument(doc.saveToBuffer("incremental,compress").asUint8Array().slice()));
    expect(after).toEqual(before);
  });

  it("repaired files fall back to a full save", async () => {
    const broken = Buffer.from(fixture());
    broken.write("startxref\n9      ", broken.lastIndexOf("startxref"), "latin1");
    mupdf.setLog(() => {});
    const ed = open(new Uint8Array(broken));
    mupdf.setLog(null);
    expect(ed.doc.wasRepaired()).toBe(true);
    await ed.putTextBox(BOXES[0]!);
    const s = await ed.save();
    expect(s.mode).toBe("full");
    expect(new PdfEditor(new mupdf.PDFDocument(s.bytes), loadKit).textBoxes()).toHaveLength(1);
  });

  it("reports characters Pretendard has no glyph for", async () => {
    const ed = open(fixture());
    const r = await ed.putTextBox({ ...BOXES[0]!, text: "가😀나🎉" });
    expect(r.missing).toEqual(["😀", "🎉"]);
  });

  it("full save on request drops dead objects and keeps the boxes", async () => {
    const { saved } = await withBoxes();
    const ed = open(saved.bytes);
    await ed.putTextBox({ ...BOXES[0]!, text: "새 글자 쀍" });
    const inc = await ed.save();
    const full = await open(inc.bytes).save(true);
    expect(full.mode).toBe("full");
    expect(full.bytes.length).toBeLessThan(inc.bytes.length);
    expect(new PdfEditor(new mupdf.PDFDocument(full.bytes), loadKit).textBoxes()).toHaveLength(5);
  });
});

describe("highlights", () => {
  const CYAN: RGB = [0.219604, 0.898041, 1];

  /** quads of the base text line on a page, as the UI gets them from StructuredText */
  function lineQuads(doc: mupdf.PDFDocument, page: number): Quad[] {
    const st = doc.loadPage(page).toStructuredText("preserve-whitespace");
    let box: mupdf.Rect | null = null;
    st.walk({ beginLine: (b) => void (box ??= b) });
    const [x0, y0, x1, y1] = box!;
    return st.highlight([x0 + 0.5, (y0 + y1) / 2], [x1 - 0.5, (y0 + y1) / 2]) as Quad[];
  }

  const expectQuads = (a: Quad[], b: Quad[]) => {
    expect(a).toHaveLength(b.length);
    a.forEach((q, i) => q.forEach((v, k) => expect(v).toBeCloseTo(b[i]![k]!, 3)));
  };

  it("creates highlights that read back in page space, drawn with Multiply at their opacity", async () => {
    const ed = open(fixture());
    const quads = lineQuads(ed.doc, 0);
    expect(quads.length).toBe(1);
    const empty: Quad = [100, 300, 200, 300, 100, 330, 200, 330]; // no text under it, to check the color
    const id = newHighlightId();
    ed.putHighlight({ id, page: 0, quads: [...quads, empty], color: CYAN, opacity: 0.4 });
    const doc = new mupdf.PDFDocument((await ed.save()).bytes);

    const [h] = new PdfEditor(doc, loadKit).highlights();
    expect(h).toMatchObject({ id, page: 0, color: CYAN, opacity: 0.4 });
    expectQuads(h!.quads, [...quads, empty]);

    const annot = doc.newIndirect(h!.objNum!);
    const qp = annot.get("QuadPoints");
    expect(qp.get(1).asNumber()).toBeGreaterThan(qp.get(5).asNumber()); // UL above LL in user space
    const ap = annot.get("AP").get("N");
    expect(ap.get("Resources").get("ExtGState").get("GS").get("BM").asName()).toBe("Multiply");
    expect(ap.get("Resources").get("ExtGState").get("GS").get("ca").asNumber()).toBeCloseTo(0.4);
    expect(ap.get("Resources").get("XObject").get("Fm").get("Group").get("S").asName()).toBe("Transparency");

    // white × (1 − 0.4·(1 − c)) in the middle of the empty quad
    const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
    const px = pix.getPixels();
    const at = 315 * pix.getStride() + 150 * pix.getNumberOfComponents();
    CYAN.forEach((c, i) => expect(Math.abs(px[at + i]! - 255 * (1 - 0.4 * (1 - c)))).toBeLessThan(4));
  });

  it("keeps quads on rotated pages", async () => {
    const ed = open(fixture());
    for (const page of [1, 2]) {
      const quads = lineQuads(ed.doc, page);
      ed.putHighlight({ id: newHighlightId(), page, quads, color: CYAN, opacity: 1 });
      const read = new PdfEditor(new mupdf.PDFDocument((await ed.save()).bytes), loadKit).highlights().filter((h) => h.page === page);
      expectQuads(read[0]!.quads, quads);
    }
  });

  it("changes color and opacity in place", async () => {
    const ed = open(fixture());
    const quads = lineQuads(ed.doc, 0);
    const first = ed.putHighlight({ id: newHighlightId(), page: 0, quads, color: CYAN, opacity: 0.4 }).highlight;
    const again = ed.putHighlight({ ...first, color: [1, 0.819611, 0], opacity: 0.7 }).highlight;
    expect(again.objNum).toBe(first.objNum);
    const doc = new mupdf.PDFDocument((await ed.save()).bytes);
    expect(new PdfEditor(doc, loadKit).highlights()).toMatchObject([{ id: first.id, color: [1, 0.819611, 0], opacity: 0.7 }]);
    expect(doc.newIndirect(first.objNum!).get("AP").get("N").get("Resources").get("ExtGState").get("GS").get("CA").asNumber()).toBeCloseTo(0.7);
  });

  it("imports another program's highlight and deletes it together with its popup", async () => {
    const doc = new mupdf.PDFDocument(fixture());
    const page = doc.findPage(0);
    const annot = doc.addObject({
      Type: "Annot",
      Subtype: "Highlight",
      Rect: [56, 770, 160, 790],
      QuadPoints: [56, 790, 160, 790, 56, 770, 160, 770],
      C: [0.219604, 0.898041, 1],
      CA: 0.399994,
      NM: "(741bdd99-996f-438e-b1a7-764585fb2abe)",
      F: 4,
      P: page,
    });
    const popup = doc.addObject({ Type: "Annot", Subtype: "Popup", Rect: [600, 700, 780, 800], Parent: annot });
    annot.put("Popup", popup);
    page.put("Annots", [annot, popup]);
    const ed = open(doc.saveToBuffer("").asUint8Array().slice());

    const [h] = ed.highlights();
    expect(h).toMatchObject({ id: "741bdd99-996f-438e-b1a7-764585fb2abe", opacity: 0.399994 });
    expect(h!.quads[0]![1]).toBeCloseTo(842 - 790); // page space: y down
    expect(ed.deleteHighlight(h!.id)).toBe(0);
    const saved = new mupdf.PDFDocument((await ed.save()).bytes);
    expect(saved.findPage(0).get("Annots").length).toBe(0);
  });

  it("highlights without /NM get an obj: id and can still be edited and deleted", async () => {
    const doc = new mupdf.PDFDocument(fixture());
    const page = doc.loadPage(0);
    const a = page.createAnnotation("Highlight");
    a.setQuadPoints([[56, 60, 150, 60, 56, 75, 150, 75]]);
    a.setColor([1, 1, 0]);
    a.update();
    const ed = open(doc.saveToBuffer("").asUint8Array().slice());
    const [h] = ed.highlights();
    expect(h!.id).toBe(`obj:${h!.objNum}`);
    expect(h!.opacity).toBe(1);
    expect(ed.putHighlight({ ...h!, color: CYAN }).highlight.objNum).toBe(h!.objNum);
    expect(ed.deleteHighlight(h!.id)).toBe(0);
    expect(ed.highlights()).toEqual([]);
  });
});
