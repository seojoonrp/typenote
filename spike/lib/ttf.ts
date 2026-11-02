// Minimal TrueType reader: just the tables needed for cmap lookup, metrics,
// FontDescriptor values and glyph-presence checks. No shaping, no kerning.

export type TTF = {
  bytes: Uint8Array;
  tables: Map<string, { offset: number; length: number }>;
  unitsPerEm: number;
  bbox: [number, number, number, number];
  numGlyphs: number;
  hhea: { ascender: number; descender: number; lineGap: number };
  os2: {
    weightClass: number;
    typoAscender: number;
    typoDescender: number;
    typoLineGap: number;
    winAscent: number;
    winDescent: number;
    capHeight: number;
    xHeight: number;
    useTypoMetrics: boolean;
  };
  italicAngle: number;
  isFixedPitch: boolean;
  postscriptName: string;
  /** codepoint -> glyph id */
  cmap: Map<number, number>;
  advance(gid: number): number;
  /** byte length of the glyph outline in 'glyf' (0 = empty glyph) */
  glyphDataLength(gid: number): number;
};

export function parseTTF(bytes: Uint8Array): TTF {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number) => dv.getUint16(o);
  const i16 = (o: number) => dv.getInt16(o);
  const u32 = (o: number) => dv.getUint32(o);

  const tables = new Map<string, { offset: number; length: number }>();
  const numTables = u16(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(bytes[rec]!, bytes[rec + 1]!, bytes[rec + 2]!, bytes[rec + 3]!);
    tables.set(tag, { offset: u32(rec + 8), length: u32(rec + 12) });
  }
  const t = (tag: string) => {
    const e = tables.get(tag);
    if (!e) throw new Error(`missing table ${tag}`);
    return e.offset;
  };

  const head = t("head");
  const unitsPerEm = u16(head + 18);
  const bbox: [number, number, number, number] = [i16(head + 36), i16(head + 38), i16(head + 40), i16(head + 42)];
  const indexToLocFormat = i16(head + 50);

  const hhea = t("hhea");
  const numberOfHMetrics = u16(hhea + 34);
  const numGlyphs = u16(t("maxp") + 4);

  const os2 = t("OS/2");
  const os2Version = u16(os2);
  const fsSelection = u16(os2 + 62);

  const post = t("post");

  const hmtx = t("hmtx");
  const advance = (gid: number) => u16(hmtx + 4 * Math.min(gid, numberOfHMetrics - 1));

  const glyphDataLength = (gid: number) => {
    if (gid < 0 || gid >= numGlyphs) return 0;
    const loca = t("loca");
    if (indexToLocFormat === 0) return (u16(loca + 2 * (gid + 1)) - u16(loca + 2 * gid)) * 2;
    return u32(loca + 4 * (gid + 1)) - u32(loca + 4 * gid);
  };

  return {
    bytes,
    tables,
    unitsPerEm,
    bbox,
    numGlyphs,
    hhea: { ascender: i16(hhea + 4), descender: i16(hhea + 6), lineGap: i16(hhea + 8) },
    os2: {
      weightClass: u16(os2 + 4),
      typoAscender: i16(os2 + 68),
      typoDescender: i16(os2 + 70),
      typoLineGap: i16(os2 + 72),
      winAscent: u16(os2 + 74),
      winDescent: u16(os2 + 76),
      xHeight: os2Version >= 2 ? i16(os2 + 86) : 0,
      capHeight: os2Version >= 2 ? i16(os2 + 88) : 0,
      useTypoMetrics: (fsSelection & (1 << 7)) !== 0,
    },
    italicAngle: dv.getInt32(post + 4) / 65536,
    isFixedPitch: u32(post + 12) !== 0,
    postscriptName: readPostScriptName(bytes, dv, t("name")),
    cmap: readCmap(dv, t("cmap")),
    advance,
    glyphDataLength,
  };
}

function readPostScriptName(bytes: Uint8Array, dv: DataView, name: number): string {
  const count = dv.getUint16(name + 2);
  const strings = name + dv.getUint16(name + 4);
  let fallback = "";
  for (let i = 0; i < count; i++) {
    const r = name + 6 + i * 12;
    const platform = dv.getUint16(r);
    const nameId = dv.getUint16(r + 6);
    if (nameId !== 6) continue;
    const len = dv.getUint16(r + 8);
    const off = strings + dv.getUint16(r + 10);
    const raw = bytes.subarray(off, off + len);
    if (platform === 3 || platform === 0) {
      let s = "";
      for (let j = 0; j + 1 < raw.length; j += 2) s += String.fromCharCode((raw[j]! << 8) | raw[j + 1]!);
      return s;
    }
    fallback = String.fromCharCode(...raw);
  }
  return fallback;
}

function readCmap(dv: DataView, cmap: number): Map<number, number> {
  const n = dv.getUint16(cmap + 2);
  let fmt4 = -1;
  let fmt12 = -1;
  for (let i = 0; i < n; i++) {
    const r = cmap + 4 + i * 8;
    const platform = dv.getUint16(r);
    const encoding = dv.getUint16(r + 2);
    const sub = cmap + dv.getUint32(r + 4);
    const format = dv.getUint16(sub);
    if (format === 12 && (platform === 3 && encoding === 10 || platform === 0)) fmt12 = sub;
    if (format === 4 && (platform === 3 && encoding === 1 || platform === 0)) fmt4 = sub;
  }
  const map = new Map<number, number>();
  if (fmt12 >= 0) {
    const groups = dv.getUint32(fmt12 + 12);
    for (let g = 0; g < groups; g++) {
      const r = fmt12 + 16 + g * 12;
      const start = dv.getUint32(r);
      const end = dv.getUint32(r + 4);
      const gid = dv.getUint32(r + 8);
      for (let c = start; c <= end; c++) map.set(c, gid + (c - start));
    }
    return map;
  }
  if (fmt4 < 0) throw new Error("no usable cmap subtable");
  const segX2 = dv.getUint16(fmt4 + 6);
  const ends = fmt4 + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  for (let s = 0; s < segX2 / 2; s++) {
    const end = dv.getUint16(ends + 2 * s);
    const start = dv.getUint16(starts + 2 * s);
    const delta = dv.getInt16(deltas + 2 * s);
    const rangeOffAt = ranges + 2 * s;
    const rangeOff = dv.getUint16(rangeOffAt);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let gid: number;
      if (rangeOff === 0) gid = (c + delta) & 0xffff;
      else {
        gid = dv.getUint16(rangeOffAt + rangeOff + 2 * (c - start));
        if (gid !== 0) gid = (gid + delta) & 0xffff;
      }
      if (gid !== 0) map.set(c, gid);
    }
  }
  return map;
}
