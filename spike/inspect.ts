// Usage: tsx inspect.ts <pdf>
// Dumps every FreeText / Highlight annotation and its appearance resources.
import * as fs from "node:fs";
import * as mupdf from "mupdf";
import { collectBlend, collectFonts, name, normalAppearance, streamText, textOrUndef } from "./lib/pdfobj.ts";

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;

const file = process.argv[2];
if (!file) {
  console.error("usage: tsx inspect.ts <pdf>");
  process.exit(2);
}

const doc = new mupdf.PDFDocument(fs.readFileSync(file));
console.log(`# ${file}`);
console.log(`pages=${doc.countPages()} versions=${doc.countVersions()} repaired=${doc.wasRepaired()} producer=${doc.getMetaData("info:Producer") ?? "-"} creator=${doc.getMetaData("info:Creator") ?? "-"}`);

let total = 0;
for (let i = 0; i < doc.countPages(); i++) {
  const page = doc.loadPage(i);
  const pobj = page.getObject();
  const rot = pobj.getInheritable("Rotate");
  for (const annot of page.getAnnotations()) {
    const type = annot.getType();
    if (type !== "FreeText" && type !== "Highlight") continue;
    total++;
    const obj = annot.getObject();
    const ap = normalAppearance(obj);
    console.log(`\n## page ${i + 1}${rot.isNull() ? "" : ` (Rotate ${rot.asNumber()})`} — ${type} obj ${obj.isIndirect() ? obj.asIndirect() : "?"}`);
    console.log(`  /Rect ${obj.get("Rect").toString(true)}  /NM ${textOrUndef(obj.get("NM")) ?? "-"}  /T ${textOrUndef(obj.get("T")) ?? "-"}`);
    console.log(`  /F ${obj.get("F").isNull() ? "-" : obj.get("F").asNumber()}  /M ${textOrUndef(obj.get("M")) ?? "-"}`);

    if (type === "FreeText") {
      const contents = textOrUndef(obj.get("Contents"));
      console.log(`  /Contents ${JSON.stringify(contents)}  hangul=${contents ? HANGUL.test(contents) : false}`);
      console.log(`  /DA ${JSON.stringify(textOrUndef(obj.get("DA")))}`);
      console.log(`  /DS ${JSON.stringify(textOrUndef(obj.get("DS")))}`);
      const rc = obj.get("RC");
      console.log(`  /RC ${rc.isNull() ? "absent" : JSON.stringify(rc.isStream() ? streamText(rc, 400) : textOrUndef(rc))}`);
      console.log(`  /IT ${name(obj.get("IT")) ?? "-"}  /Rotate ${obj.get("Rotate").isNull() ? "-" : obj.get("Rotate").asNumber()}  /BS ${obj.get("BS").toString(true)}`);
    } else {
      console.log(`  /C ${obj.get("C").toString(true)}  /CA ${obj.get("CA").isNull() ? "-" : obj.get("CA").asNumber()}  quads=${obj.get("QuadPoints").length / 8}`);
      console.log(`  /QuadPoints ${obj.get("QuadPoints").toString(true)}`);
    }

    if (!ap) {
      console.log("  /AP /N: absent");
      continue;
    }
    console.log(`  /AP /N obj ${ap.isIndirect() ? ap.asIndirect() : "inline"}  /BBox ${ap.get("BBox").toString(true)}  /Matrix ${ap.get("Matrix").toString(true)}`);
    if (type === "FreeText") {
      const fonts = collectFonts(ap);
      if (fonts.length === 0) console.log("  fonts: none");
      for (const f of fonts) {
        console.log(`  font ${f.where} /${f.resName}: obj ${f.objNum ?? "inline"} ${f.subtype} /BaseFont ${f.baseFont} /Encoding ${f.encoding ?? "-"} ToUnicode=${f.hasToUnicode} embedded=${f.embedded ?? "NO"}${f.fontFileLength ? ` (${f.fontFileLength} B, obj ${f.fontFileObjNum})` : ""}`);
        if (f.descendant) console.log(`      descendant ${f.descendant.subtype} /BaseFont ${f.descendant.baseFont} /CIDToGIDMap ${f.descendant.cidToGid ?? "-"} ordering=${f.descendant.ordering ?? "-"}`);
      }
    }
    const blend = collectBlend(ap);
    console.log(`  blend: ${blend.length ? blend.join(" | ") : "none (Normal)"}`);
    console.log(`  AP stream: ${JSON.stringify(streamText(ap, 700))}`);
    ap.get("Resources").get("XObject").forEach((xo, key) => {
      console.log(`  AP XObject /${String(key)} stream: ${JSON.stringify(streamText(xo, 700))}`);
    });
  }
}
console.log(`\nFreeText/Highlight total: ${total}`);
