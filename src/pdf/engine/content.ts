// Tiny content-stream tokenizer: enough to read back text-showing operators.

export type Token =
  | { t: "num"; v: number }
  | { t: "name"; v: string }
  | { t: "str"; bytes: number[] }
  | { t: "op"; v: string }
  | { t: "[" }
  | { t: "]" }
  | { t: "<<" }
  | { t: ">>" };

const DELIM = /[\s()<>[\]{}/%]/;

export function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (c === "%") {
      while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i++;
    } else if (c === "<" && s[i + 1] === "<") {
      out.push({ t: "<<" });
      i += 2;
    } else if (c === ">" && s[i + 1] === ">") {
      out.push({ t: ">>" });
      i += 2;
    } else if (c === "<") {
      const j = s.indexOf(">", i);
      let hex = s.slice(i + 1, j).replace(/\s/g, "");
      if (hex.length % 2) hex += "0";
      const bytes: number[] = [];
      for (let k = 0; k < hex.length; k += 2) bytes.push(parseInt(hex.slice(k, k + 2), 16));
      out.push({ t: "str", bytes });
      i = j + 1;
    } else if (c === "(") {
      const bytes: number[] = [];
      let depth = 1;
      i++;
      while (i < s.length && depth > 0) {
        const ch = s[i]!;
        if (ch === "\\") {
          const n = s[i + 1]!;
          const esc: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
          if (n in esc) {
            bytes.push(esc[n]!);
            i += 2;
          } else if (/[0-7]/.test(n)) {
            const m = /^[0-7]{1,3}/.exec(s.slice(i + 1))![0];
            bytes.push(parseInt(m, 8) & 0xff);
            i += 1 + m.length;
          } else i += 2;
          continue;
        }
        if (ch === "(") depth++;
        if (ch === ")" && --depth === 0) break;
        bytes.push(ch.charCodeAt(0) & 0xff);
        i++;
      }
      out.push({ t: "str", bytes });
      i++;
    } else if (c === "[" || c === "]") {
      out.push({ t: c });
      i++;
    } else if (c === "/") {
      let j = i + 1;
      while (j < s.length && !DELIM.test(s[j]!)) j++;
      out.push({ t: "name", v: s.slice(i + 1, j) });
      i = j;
    } else {
      let j = i;
      while (j < s.length && !DELIM.test(s[j]!)) j++;
      const w = s.slice(i, j) || s[i]!;
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) out.push({ t: "num", v: parseFloat(w) });
      else out.push({ t: "op", v: w });
      i = Math.max(j, i + 1);
    }
  }
  return out;
}

export type ShownText = { font: string; codes: number[] }[][]; // lines -> runs

/** Text runs per line for a stream using 2-byte (Identity-H) codes. */
export function shownText(stream: string): ShownText {
  const lines: ShownText = [[]];
  let font = "";
  let operands: Token[] = [];
  let started = false;
  const show = (bytes: number[]) => {
    const codes: number[] = [];
    for (let k = 0; k + 1 < bytes.length; k += 2) codes.push((bytes[k]! << 8) | bytes[k + 1]!);
    lines.at(-1)!.push({ font, codes });
    started = true;
  };
  const newline = () => {
    if (started) lines.push([]);
  };
  for (const tok of tokenize(stream)) {
    if (tok.t !== "op") {
      operands.push(tok);
      continue;
    }
    const strs = operands.filter((o): o is Extract<Token, { t: "str" }> => o.t === "str");
    switch (tok.v) {
      case "Tf":
        font = (operands.find((o) => o.t === "name") as { v: string } | undefined)?.v ?? font;
        break;
      case "Tj":
        strs.forEach((s) => show(s.bytes));
        break;
      case "TJ":
        strs.forEach((s) => show(s.bytes));
        break;
      case "'":
      case '"':
        lines.push([]);
        strs.forEach((s) => show(s.bytes));
        break;
      case "T*": // explicit next line, kept even after an empty line
        lines.push([]);
        break;
      case "Td":
      case "TD": {
        const ty = operands[1];
        if (ty && ty.t === "num" && ty.v !== 0) newline();
        break;
      }
    }
    operands = [];
  }
  return lines;
}
