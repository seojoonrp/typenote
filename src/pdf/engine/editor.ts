// Edits app text boxes in an open document and saves it. Used by the worker session and tests.
import * as mupdf from "mupdf";
import { createFontObjects, rewriteFontObjects, type FontKit } from "./fonts";
import { findSharedFonts, locateFreeText, readTextBoxes, removeFreeText, usedCodepoints, writeFreeText } from "./freetext";
import { newBoxId, type TextBox, type TextBoxInput, type Weight } from "./model";

export type SaveMode = "incremental" | "full";
export type PutResult = { box: TextBox; missing: string[]; pages: number[] };

export class PdfEditor {
  /** Type0 font per weight, shared by every box of that weight (kept even when unused). */
  private fonts: Partial<Record<Weight, mupdf.PDFObject>>;
  /** glyph sets may have shrunk since the last subset (a box was deleted or edited) */
  private fontsStale = false;

  constructor(
    readonly doc: mupdf.PDFDocument,
    private loadKit: () => Promise<FontKit>,
  ) {
    this.fonts = findSharedFonts(doc);
  }

  textBoxes(): TextBox[] {
    return readTextBoxes(this.doc);
  }

  /** Creates or updates a box. Moving it to another page recreates it there under the same id. */
  async putTextBox(input: TextBoxInput): Promise<PutResult> {
    const kit = await this.loadKit();
    const box: TextBox = { ...input, id: input.id ?? newBoxId() };
    if (box.page < 0 || box.page >= this.doc.countPages()) throw new Error(`no page ${box.page}`);
    const pages = [box.page];
    let existing = locateFreeText(this.doc, box.id);
    if (existing && existing.page !== box.page) {
      removeFreeText(this.doc, existing);
      pages.push(existing.page);
      existing = undefined;
    }
    const face = kit.faces[box.weight];
    // the appearance stream only needs the font object to exist: glyph ids come from the full
    // font (RETAIN_GIDS), and the subset is brought up to date right after
    this.fonts[box.weight] ??= createFontObjects(this.doc, kit, face, [...box.text].map((c) => c.codePointAt(0)!));
    const { annot, missing } = writeFreeText(this.doc, face, this.fonts[box.weight]!, box, existing?.annot);
    this.syncFonts(kit);
    this.fontsStale = true;
    return { box: { ...box, objNum: annot.asIndirect() }, missing, pages };
  }

  /** Returns the page the box was on, or null if there is no such box. */
  deleteTextBox(id: string): number | null {
    const found = locateFreeText(this.doc, id);
    if (!found) return null;
    removeFreeText(this.doc, found);
    this.fontsStale = true;
    return found.page;
  }

  /**
   * Incremental save; a full save when asked (drops dead objects such as old font subsets) or
   * when the file had to be repaired on open, since MuPDF cannot append to a repaired file.
   */
  async save(full = false): Promise<{ bytes: Uint8Array; mode: SaveMode }> {
    if (this.fontsStale) {
      this.syncFonts(await this.loadKit());
      this.fontsStale = false;
    }
    const mode: SaveMode = !full && !this.doc.wasRepaired() && this.doc.canBeSavedIncrementally() ? "incremental" : "full";
    const bytes = this.doc.saveToBuffer(mode === "incremental" ? "incremental,compress" : "garbage,compress").asUint8Array().slice();
    return { bytes, mode };
  }

  /** Re-subsets each shared font to exactly the characters used (no-op when unchanged). */
  private syncFonts(kit: FontKit) {
    const used = usedCodepoints(this.doc);
    for (const weight of ["regular", "semibold"] as const) {
      const font = this.fonts[weight];
      if (font && used[weight].size > 0) rewriteFontObjects(kit, font, kit.faces[weight], used[weight]);
    }
  }
}
