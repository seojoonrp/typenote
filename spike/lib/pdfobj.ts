// Read-only helpers for walking raw PDF objects with mupdf.js.
import * as mupdf from "mupdf";

export type PDFObject = mupdf.PDFObject;

export function name(obj: PDFObject): string | undefined {
  return obj.isName() ? obj.asName() : undefined;
}

export function objNum(obj: PDFObject): number | undefined {
  return obj.isIndirect() ? obj.asIndirect() : undefined;
}

export type FontInfo = {
  resName: string;
  where: string;
  objNum?: number;
  subtype?: string;
  baseFont?: string;
  encoding?: string;
  hasToUnicode: boolean;
  descendant?: { subtype?: string; baseFont?: string; cidToGid?: string; ordering?: string };
  embedded: "FontFile" | "FontFile2" | "FontFile3" | null;
  fontFileObjNum?: number;
  fontFileLength?: number;
};

function fontDescriptorOf(font: PDFObject): PDFObject | null {
  const fd = font.get("FontDescriptor");
  if (!fd.isNull()) return fd;
  const desc = font.get("DescendantFonts").get(0);
  if (!desc.isNull()) {
    const fd2 = desc.get("FontDescriptor");
    if (!fd2.isNull()) return fd2;
  }
  return null;
}

export function describeFont(resName: string, where: string, font: PDFObject): FontInfo {
  const info: FontInfo = {
    resName,
    where,
    objNum: objNum(font),
    subtype: name(font.get("Subtype")),
    baseFont: name(font.get("BaseFont")),
    encoding: name(font.get("Encoding")) ?? (font.get("Encoding").isNull() ? undefined : "(dict/stream)"),
    hasToUnicode: !font.get("ToUnicode").isNull(),
    embedded: null,
  };
  const desc = font.get("DescendantFonts").get(0);
  if (!desc.isNull()) {
    const c2g = desc.get("CIDToGIDMap");
    info.descendant = {
      subtype: name(desc.get("Subtype")),
      baseFont: name(desc.get("BaseFont")),
      cidToGid: c2g.isNull() ? undefined : c2g.isName() ? c2g.asName() : "(stream)",
      ordering: desc.get("CIDSystemInfo").get("Ordering").isString()
        ? desc.get("CIDSystemInfo").get("Ordering").asString()
        : undefined,
    };
  }
  const fd = fontDescriptorOf(font);
  if (fd) {
    for (const key of ["FontFile", "FontFile2", "FontFile3"] as const) {
      const ff = fd.get(key);
      if (!ff.isNull()) {
        info.embedded = key;
        info.fontFileObjNum = objNum(ff);
        info.fontFileLength = ff.readStream().getLength();
        break;
      }
    }
  }
  return info;
}

/** Recursively collect fonts used by a content stream owner (Form XObject, page). */
export function collectFonts(owner: PDFObject, where = "AP", out: FontInfo[] = [], seen = new Set<number>()): FontInfo[] {
  const n = objNum(owner);
  if (n !== undefined) {
    if (seen.has(n)) return out;
    seen.add(n);
  }
  const res = owner.get("Resources");
  if (res.isNull()) return out;
  res.get("Font").forEach((font, key) => {
    out.push(describeFont(String(key), where, font));
  });
  res.get("XObject").forEach((xo, key) => {
    if (name(xo.get("Subtype")) === "Form") collectFonts(xo, `${where}/${String(key)}`, out, seen);
  });
  return out;
}

/** Blend modes in ExtGState resources and transparency group info, recursively. */
export function collectBlend(owner: PDFObject, where = "AP", out: string[] = [], seen = new Set<number>()): string[] {
  const n = objNum(owner);
  if (n !== undefined) {
    if (seen.has(n)) return out;
    seen.add(n);
  }
  const res = owner.get("Resources");
  if (!res.isNull()) {
    res.get("ExtGState").forEach((gs, key) => {
      const bm = gs.get("BM");
      const ca = gs.get("ca");
      const CA = gs.get("CA");
      const parts = [`${where} gs /${String(key)}`];
      if (!bm.isNull()) parts.push(`BM=${bm.isArray() ? bm.toString() : name(bm)}`);
      if (!ca.isNull()) parts.push(`ca=${ca.asNumber()}`);
      if (!CA.isNull()) parts.push(`CA=${CA.asNumber()}`);
      out.push(parts.join(" "));
    });
    res.get("XObject").forEach((xo, key) => {
      if (name(xo.get("Subtype")) === "Form") collectBlend(xo, `${where}/${String(key)}`, out, seen);
    });
  }
  const group = owner.get("Group");
  if (!group.isNull()) out.push(`${where} Group=${group.toString(true)}`);
  return out;
}

export function streamText(stm: PDFObject, max = 600): string {
  const s = stm.readStream().asString();
  return s.length > max ? s.slice(0, max) + `… (+${s.length - max} chars)` : s;
}

export function textOrUndef(obj: PDFObject): string | undefined {
  return obj.isString() ? obj.asString() : undefined;
}

/** Returns the /AP /N stream (picking /AS state if /N is a dict of states). */
export function normalAppearance(annot: PDFObject): PDFObject | null {
  const n = annot.get("AP").get("N");
  if (n.isNull()) return null;
  if (n.isStream()) return n;
  const as = annot.get("AS");
  if (as.isName()) {
    const s = n.get(as.asName());
    if (s.isStream()) return s;
  }
  return null;
}
