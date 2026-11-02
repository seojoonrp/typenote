// Usage: tsx verify.ts <pdf> [--baseline <earlier.pdf>]
// Automated checks for app FreeTexts and Highlights. Renders every page to spike/out/
// (MuPDF, plus poppler pdftoppm when available) for visual inspection.
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import * as mupdf from "mupdf";
import { collectBlend, collectFonts, name, normalAppearance } from "./lib/pdfobj.ts";
import { findAppFreeTexts, splitLines } from "./lib/freetext.ts";
import { parseToUnicode } from "./lib/tounicode.ts";
import { parseTTF } from "./lib/ttf.ts";
import { shownText } from "./lib/content.ts";

const args = process.argv.slice(2);
const file = args[0];
const baselineIdx = args.indexOf("--baseline");
const baseline = baselineIdx >= 0 ? args[baselineIdx + 1] : undefined;
if (!file) {
  console.error("usage: tsx verify.ts <pdf> [--baseline <earlier.pdf>]");
  process.exit(2);
}

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "out");
fs.mkdirSync(OUT, { recursive: true });
const stem = path.join(OUT, path.basename(file, ".pdf"));

type Result = { check: string; pass: boolean | null; detail: string };
const results: Result[] = [];
const record = (check: string, pass: boolean | null, detail: string) => {
  results.push({ check, pass, detail });
  console.log(`${pass === null ? "INFO" : pass ? "PASS" : "FAIL"}  ${check}: ${detail}`);
};

const bytes = new Uint8Array(fs.readFileSync(file));
const doc = new mupdf.PDFDocument(bytes);
const fts = findAppFreeTexts(doc);
console.log(`# verify ${file}: ${doc.countPages()} pages, ${fts.length} app FreeTexts, versions=${doc.countVersions()}`);

// --- 1. render ------------------------------------------------------------------------------
{
  const files: string[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const png = `${stem}-p${i + 1}.png`;
    fs.writeFileSync(png, page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true).asPNG());
    files.push(path.basename(png));
    page.destroy();
  }
  record("render (MuPDF)", null, files.join(", "));
  const pop = spawnSync("pdftoppm", ["-r", "144", "-png", file, `${stem}-poppler`], { encoding: "utf8" });
  if (pop.error) record("render (poppler)", null, `pdftoppm unavailable: ${pop.error.message}`);
  else record("render (poppler)", pop.status === 0 ? null : false, `${path.basename(stem)}-poppler-*.png${pop.stderr.trim() ? ` stderr: ${pop.stderr.trim().split("\n").join(" | ")}` : ""}`);
}

// --- 2. font embedding ---------------------------------------------------------------------------
const toUnicodeCache = new Map<number, Map<number, string>>();
const fontBytesCache = new Map<number, ReturnType<typeof parseTTF>>();
{
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const ft of fts) {
    const ap = normalAppearance(ft.annot);
    if (!ap) {
      problems.push(`${ft.annot.asIndirect()}: no /AP /N`);
      continue;
    }
    for (const f of collectFonts(ap)) {
      seen.add(`${f.objNum} ${f.baseFont}`);
      if (f.subtype !== "Type0" || f.descendant?.subtype !== "CIDFontType2") problems.push(`${f.baseFont}: ${f.subtype}/${f.descendant?.subtype}`);
      if (f.embedded !== "FontFile2" || !f.fontFileLength) problems.push(`${f.baseFont}: embedded=${f.embedded}`);
      if (!f.hasToUnicode) problems.push(`${f.baseFont}: no ToUnicode`);
      if (f.encoding !== "Identity-H" || f.descendant?.cidToGid !== "Identity") problems.push(`${f.baseFont}: enc=${f.encoding} c2g=${f.descendant?.cidToGid}`);
    }
  }
  record("FontFile2 embedded (mupdf objects)", problems.length === 0 && fts.length > 0, problems.length ? problems.join("; ") : `fonts: ${[...seen].join(", ")}`);

  const pf = spawnSync("pdffonts", [file], { encoding: "utf8" });
  if (pf.error) record("pdffonts emb/uni", null, `pdffonts unavailable: ${pf.error.message}`);
  else {
    const rows = pf.stdout.split(/\r?\n/).filter((l) => l.includes("Pretendard"));
    // name type encoding emb sub uni object ID
    const bad = rows.filter((l) => {
      const cols = l.trim().split(/\s+/);
      const n = cols.length;
      return !(cols[n - 5] === "yes" && cols[n - 3] === "yes"); // emb, uni
    });
    record("pdffonts emb/uni", rows.length > 0 && bad.length === 0, rows.length ? rows.map((r) => r.replace(/\s+/g, " ").trim()).join(" | ") : "no Pretendard rows listed");
  }
}

// --- 3/4. ToUnicode round trip + glyph presence --------------------------------------------------
{
  const mismatches: string[] = [];
  const missingGlyphs: string[] = [];
  let glyphsChecked = 0;
  for (const ft of fts) {
    const ap = normalAppearance(ft.annot)!;
    const fontRes = ap.get("Resources").get("Font");
    const lines = shownText(ap.readStream().asString());
    const decoded = lines
      .map((runs) =>
        runs
          .map((run) => {
            const font = fontRes.get(run.font);
            const num = font.asIndirect();
            if (!toUnicodeCache.has(num)) toUnicodeCache.set(num, parseToUnicode(font.get("ToUnicode").readStream().asString()));
            if (!fontBytesCache.has(num)) {
              const ff = font.get("DescendantFonts").get(0).get("FontDescriptor").get("FontFile2");
              fontBytesCache.set(num, parseTTF(ff.readStream().asUint8Array().slice()));
            }
            const tu = toUnicodeCache.get(num)!;
            const ttf = fontBytesCache.get(num)!;
            return run.codes
              .map((cid) => {
                const ch = tu.get(cid) ?? "�";
                glyphsChecked++;
                if (!/\s/.test(ch) && ttf.glyphDataLength(cid) === 0) missingGlyphs.push(`${ch}(cid ${cid}) in ${font.get("BaseFont").asName()}`);
                return ch;
              })
              .join("");
          })
          .join(""),
      )
      .join("\n");
    const expected = splitLines(ft.text).join("\n");
    if (decoded !== expected) mismatches.push(`obj ${ft.annot.asIndirect()}: ${JSON.stringify(decoded)} != ${JSON.stringify(expected)}`);
  }
  record("ToUnicode(AP GIDs) == /Contents", mismatches.length === 0 && fts.length > 0, mismatches.length ? mismatches.join("; ") : `${fts.length} boxes match`);
  record("every AP glyph has outline in embedded subset", missingGlyphs.length === 0 && glyphsChecked > 0, missingGlyphs.length ? missingGlyphs.slice(0, 20).join(", ") : `${glyphsChecked} glyphs checked`);
}

// --- 5. AP stability: open -> render -> page.update() -> incremental save -------------------------
type Snap = { apNum: number; raw: string; decoded: string; dict: string; fonts: string };
const snapshot = (d: mupdf.PDFDocument) => {
  const m = new Map<string, Snap>();
  for (const ft of findAppFreeTexts(d)) {
    const ap = normalAppearance(ft.annot)!;
    m.set(ft.annot.get("NM").asString(), {
      apNum: ap.asIndirect(),
      raw: Buffer.from(ap.readRawStream().asUint8Array()).toString("base64"),
      decoded: ap.readStream().asString(),
      dict: ap.resolve().toString(true).replace(/\/Length \d+/, ""),
      fonts: ap.get("Resources").get("Font").toString(true),
    });
  }
  return m;
};
const diffSnaps = (a: Map<string, Snap>, b: Map<string, Snap>) => {
  const diffs: string[] = [];
  for (const [nm, s] of a) {
    const t = b.get(nm);
    if (!t) diffs.push(`${nm}: missing`);
    else
      for (const k of ["apNum", "raw", "decoded", "dict", "fonts"] as const)
        if (s[k] !== t[k]) diffs.push(`${nm.slice(0, 18)}…: ${k} changed`);
  }
  return diffs;
};
for (const editHighlight of [false, true]) {
  const d = new mupdf.PDFDocument(bytes);
  const before = snapshot(d);
  for (let i = 0; i < d.countPages(); i++) {
    const page = d.loadPage(i);
    page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
    page.toStructuredText("preserve-whitespace");
    if (editHighlight)
      for (const a of page.getAnnotations())
        if (a.getType() === "Highlight") {
          a.setColor([0.5, 1, 0.5]); // what the app does on a color change
          a.update();
        }
    page.update();
    page.destroy();
  }
  const saved = d.saveToBuffer("incremental,compress").asUint8Array().slice();
  const prefixOk = saved.length >= bytes.length && Buffer.from(saved.subarray(0, bytes.length)).equals(Buffer.from(bytes));
  const appended = Buffer.from(saved.subarray(bytes.length)).toString("latin1");
  const written = [...appended.matchAll(/(\d+) 0 obj/g)].map((m) => m[1]);
  const after = snapshot(new mupdf.PDFDocument(saved));
  const diffs = diffSnaps(before, after);
  record(
    `AP bytes unchanged after open->render->${editHighlight ? "highlight color change->" : ""}page.update()->incremental save`,
    diffs.length === 0 && before.size > 0 && prefixOk && (!editHighlight || written.length > 0),
    `${before.size} APs compared; prefix preserved=${prefixOk}; appended ${saved.length - bytes.length} B, objects rewritten: [${written.join(" ")}]${diffs.length ? "; " + diffs.join(", ") : ""}`,
  );
}
{

  // Not something the app should do, but tells us whether MuPDF would rebuild our AP if asked.
  const e = new mupdf.PDFDocument(bytes);
  const eBefore = snapshot(e);
  const updated: string[] = [];
  for (let i = 0; i < e.countPages(); i++) {
    const page = e.loadPage(i);
    for (const a of page.getAnnotations()) {
      if (a.getType() !== "FreeText") continue;
      if (a.update()) updated.push(String(a.getObject().asIndirect()));
    }
  }
  const eDiffs = diffSnaps(eBefore, snapshot(e));
  record("experiment: explicit annot.update() on our FreeText", null, `update() returned true for [${updated.join(" ")}]; ${eDiffs.length ? "AP changed: " + eDiffs.join(", ") : "AP unchanged"}`);
}

// --- setHiddenForEditing: base bitmap must equal the page without annotations -------------------
{
  const d = new mupdf.PDFDocument(bytes);
  const out: string[] = [];
  let ok = true;
  for (let i = 0; i < d.countPages(); i++) {
    const page = d.loadPage(i);
    const annots = page.getAnnotations();
    for (const a of annots) {
      const t = a.getType();
      if (t === "Highlight" || (t === "FreeText" && a.getObject().get("NM").isString() && a.getObject().get("NM").asString().startsWith("typenote-"))) a.setHiddenForEditing(true);
    }
    // getPixels() is a view into WASM memory that detaches when memory grows: copy at once
    const pixels = (extras: boolean) => Buffer.from(page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, extras).getPixels().slice());
    const hidden = pixels(true);
    const bare = pixels(false);
    for (const a of annots) a.setHiddenForEditing(false);
    const shown = pixels(true);
    const same = hidden.equals(bare);
    const differs = !shown.equals(bare);
    if (annots.length) {
      out.push(`p${i + 1}: hidden==bare ${same}, shown!=bare ${differs}`);
      ok &&= same && differs;
    }
    page.destroy();
  }
  record("setHiddenForEditing(true) hides app annots in base render", ok, out.join("; "));
}

// --- 6. baseline: boxes from an earlier save still intact ---------------------------------------
if (baseline) {
  const b = new mupdf.PDFDocument(fs.readFileSync(baseline));
  const before = snapshot(b);
  const now = snapshot(doc);
  const diffs = [...diffSnaps(before, now)].filter((x) => !x.endsWith("fonts changed"));
  const fontObjs = (s: Map<string, Snap>) => [...new Set([...s.values()].map((v) => v.fonts))].sort().join(" ");
  record(
    `boxes from ${path.basename(baseline)} keep the same AP object + bytes`,
    diffs.length === 0 && before.size > 0,
    `${before.size} earlier boxes; ${diffs.length ? diffs.join(", ") : "all identical"}; font refs before: ${fontObjs(before)} after: ${fontObjs(now)}`,
  );
}

// --- 7. Highlights -------------------------------------------------------------------------------
{
  const rows: string[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    for (const a of page.getAnnotations()) {
      if (a.getType() !== "Highlight") continue;
      const o = a.getObject();
      const ap = normalAppearance(o);
      rows.push(`p${i + 1} obj ${o.asIndirect()} /C ${o.get("C").toString(true)} /CA ${o.get("CA").isNull() ? "-" : o.get("CA").asNumber()} quads=${a.getQuadPoints().length} blend=[${ap ? collectBlend(ap).join("; ") : "no AP"}]`);
    }
    page.destroy();
  }
  const allMultiply = rows.length > 0 && rows.every((r) => r.includes("BM=Multiply"));
  record("Highlight AP blend mode", rows.length ? allMultiply : null, rows.join(" | ") || "no highlights");
}

// --- 8. rotation: upright on screen -------------------------------------------------------------
{
  const rows: string[] = [];
  const extractMismatch: string[] = [];
  let ok = true;
  for (const ft of fts) {
    const page = doc.loadPage(ft.page);
    const rot = page.getObject().getInheritable("Rotate");
    const ap = normalAppearance(ft.annot)!;
    const m = ap.get("Matrix");
    const M: mupdf.Matrix = m.isNull() ? [1, 0, 0, 1, 0, 0] : ([0, 1, 2, 3, 4, 5].map((k) => m.get(k).asNumber()) as mupdf.Matrix);
    const ctm = page.getTransform();
    const net = mupdf.Matrix.concat(M, [ctm[0], ctm[1], ctm[2], ctm[3], 0, 0]).slice(0, 4).map((v) => Math.round(v * 1000) / 1000);
    const upright = net[0]! > 0 && net[1] === 0 && net[2] === 0 && net[3]! < 0;

    // Independent check through MuPDF's own text extraction of the annotation appearance
    // (page.toStructuredText() leaves annotations out; the annot display list has them).
    const annot = page.getAnnotations().find((a) => a.getObject().asIndirect() === ft.annot.asIndirect())!;
    const dirs: mupdf.Point[] = [];
    const st = annot.toDisplayList().toStructuredText("preserve-whitespace");
    st.walk({ beginLine: (_b, _w, d) => void dirs.push(d) });
    const extracted = st.asText().replace(/\n+$/, "");
    if (extracted !== splitLines(ft.text).join("\n")) extractMismatch.push(`obj ${ft.annot.asIndirect()}: ${JSON.stringify(extracted)}`);
    const dirOk = dirs.length > 0 && dirs.every((d) => Math.abs(d[0] - 1) < 1e-3 && Math.abs(d[1]) < 1e-3);
    if (!rot.isNull() && rot.asNumber() !== 0) {
      rows.push(`p${ft.page + 1} Rotate ${rot.asNumber()} obj ${ft.annot.asIndirect()}: form->page linear [${net.join(" ")}] upright=${upright}; stext line dirs=${JSON.stringify(dirs.map((d) => d.map((v) => +v.toFixed(3))))}`);
      ok &&= upright && dirOk;
    } else ok &&= upright && dirOk;
    page.destroy();
  }
  record("MuPDF text extraction of FreeText == /Contents", extractMismatch.length === 0 && fts.length > 0, extractMismatch.join("; ") || `${fts.length} boxes match`);
  record("FreeText upright on rotated pages", rows.length ? ok : null, rows.join(" | ") || "no rotated-page boxes");
}

fs.writeFileSync(`${stem}-verify.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => r.pass === false).length;
console.log(`\n${results.filter((r) => r.pass).length} pass, ${failed} fail, ${results.filter((r) => r.pass === null).length} info`);
process.exitCode = failed ? 1 : 0;
