// ToUnicode CMap writer (2-byte CIDs -> UTF-16BE) and a small reader for verification.

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

function utf16Hex(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) out += hex4(s.charCodeAt(i));
  return out;
}

/** cidToText: CID (= GID) -> the text it stands for. */
export function buildToUnicode(cidToText: Map<number, string>): string {
  const entries = [...cidToText].sort((a, b) => a[0] - b[0]);
  const lines = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
  ];
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    lines.push(`${chunk.length} beginbfchar`);
    for (const [cid, text] of chunk) lines.push(`<${hex4(cid)}> <${utf16Hex(text)}>`);
    lines.push("endbfchar");
  }
  lines.push("endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end");
  return lines.join("\n") + "\n";
}

function hexToUtf16(h: string): string {
  let s = "";
  for (let i = 0; i + 3 < h.length; i += 4) s += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
  return s;
}

/** Parses bfchar and bfrange sections of a ToUnicode CMap. */
export function parseToUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      map.set(parseInt(m[1]!, 16), hexToUtf16(m[2]!));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1]!, 16);
      const hi = parseInt(m[2]!, 16);
      const dst = m[3]!;
      if (dst.startsWith("[")) {
        const items = [...dst.matchAll(/<([0-9A-Fa-f]*)>/g)].map((x) => hexToUtf16(x[1]!));
        for (let c = lo; c <= hi && c - lo < items.length; c++) map.set(c, items[c - lo]!);
      } else {
        const base = dst.slice(1, -1);
        const head = base.slice(0, -4);
        const last = parseInt(base.slice(-4), 16);
        for (let c = lo; c <= hi; c++) map.set(c, hexToUtf16(head + hex4(last + (c - lo))));
      }
    }
  }
  return map;
}
