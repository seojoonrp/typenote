// Document-level operations shared by write.ts and append.ts.
import * as fs from "node:fs";
import * as path from "node:path";
import * as mupdf from "mupdf";
import { createFontObjects, rewriteFontObjects, type Faces, type Weight } from "./fonts.ts";
import { createFreeText, findSharedFonts, usedCodepoints, type BoxSpec } from "./freetext.ts";

export type PlacedBox = BoxSpec & { page: number; label: string };

/**
 * Adds FreeTexts. Before creating them, the shared font for each weight is created or
 * re-subset in place (same object numbers) to cover every character used in the document.
 */
export async function addFreeTexts(doc: mupdf.PDFDocument, faces: Faces, boxes: PlacedBox[]) {
  const used = usedCodepoints(doc, boxes);
  const shared = findSharedFonts(doc);
  const fonts: Partial<Record<Weight, mupdf.PDFObject>> = {};
  for (const weight of ["regular", "semibold"] as const) {
    if (used[weight].size === 0) continue;
    const existing = shared[weight];
    if (existing) {
      const changed = await rewriteFontObjects(doc, existing, faces[weight], used[weight]);
      console.log(`  font ${weight}: obj ${existing.asIndirect()} ${changed ? "re-subset in place" : "unchanged"} (${used[weight].size} chars)`);
      fonts[weight] = existing;
    } else {
      fonts[weight] = await createFontObjects(doc, faces[weight], used[weight]);
      console.log(`  font ${weight}: created obj ${fonts[weight]!.asIndirect()} (${used[weight].size} chars)`);
    }
  }
  const results = [];
  for (const box of boxes) {
    const page = doc.loadPage(box.page);
    const r = createFreeText(doc, page, box, faces[box.weight], fonts[box.weight]!);
    console.log(`  FreeText "${box.label}" p${box.page + 1}: obj ${r.annot.asIndirect()} /Rect [${r.rect.map((v) => v.toFixed(2)).join(" ")}] /Matrix [${r.matrix.join(" ")}]`);
    page.destroy();
    results.push({ box, ...r });
  }
  return results;
}

/** Incremental save (temp file in the same folder, then rename); full save if the file was repaired. */
export function saveDocument(doc: mupdf.PDFDocument, outPath: string): "incremental" | "full" {
  const mode = !doc.wasRepaired() && doc.canBeSavedIncrementally() ? "incremental" : "full";
  const options = mode === "incremental" ? "incremental,compress" : "garbage,compress";
  const bytes = doc.saveToBuffer(options).asUint8Array();
  const tmp = path.join(path.dirname(outPath), `.${path.basename(outPath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, outPath);
  return mode;
}
