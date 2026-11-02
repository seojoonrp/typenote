// Page bitmaps keyed by (page, render scale), fetched from the worker on demand.
import type { PdfClient } from "../pdf/client";
import { PdfError } from "../pdf/client";
import type { HiddenAnnots } from "../pdf/protocol";
import { LruCache } from "./lru";

export type PageBitmap = { page: number; scale: number; bitmap: ImageBitmap; width: number; height: number };
export type Want = { page: number; scale: number; priority: number };

/** Total cached pixels (RGBA, so ×4 bytes). */
const BUDGET_PIXELS = 72_000_000;

const keyOf = (page: number, scale: number) => `${page}@${scale.toFixed(4)}`;

export class RenderCache {
  private cache = new LruCache<string, PageBitmap>(BUDGET_PIXELS, (_k, v) => v.bitmap.close());
  private inflight = new Map<string, number>();
  private wanted = new Set<string>();
  private docId = 0;
  /** bumped per page when its content changes; renders started before that are discarded */
  private generation = new Map<number, number>();
  /** cached but outdated: still shown until the fresh render arrives */
  private outdated = new Set<string>();

  constructor(
    private client: PdfClient,
    private onReady: (page: number) => void,
    private hide: HiddenAnnots,
  ) {}

  setDoc(docId: number) {
    this.client.cancel([...this.inflight.values()]);
    this.inflight.clear();
    this.wanted.clear();
    this.cache.clear();
    this.outdated.clear();
    this.generation.clear();
    this.docId = docId;
  }

  /** The pages' content changed: re-render them on the next ensure(), showing the old bitmaps meanwhile. */
  invalidate(pages: number[]) {
    const stale: number[] = [];
    for (const page of pages) {
      this.generation.set(page, (this.generation.get(page) ?? 0) + 1);
      for (const k of this.cache.keys()) if (this.cache.peek(k)!.page === page) this.outdated.add(k);
      for (const [k, id] of this.inflight) {
        if (k.startsWith(`${page}@`)) {
          stale.push(id);
          this.inflight.delete(k);
        }
      }
    }
    this.client.cancel(stale);
  }

  /** Exact match if cached, else the closest cached scale for that page (sharper first). */
  best(page: number, scale: number): PageBitmap | undefined {
    const exact = this.cache.peek(keyOf(page, scale));
    if (exact) return exact;
    let above: PageBitmap | undefined;
    let below: PageBitmap | undefined;
    for (const k of this.cache.keys()) {
      const e = this.cache.peek(k)!;
      if (e.page !== page) continue;
      if (e.scale >= scale) {
        if (!above || e.scale < above.scale) above = e;
      } else if (!below || e.scale > below.scale) below = e;
    }
    return above ?? below;
  }

  /** Requests what is missing, cancels queued work that is no longer wanted. */
  ensure(wants: Want[]) {
    this.wanted = new Set(wants.map((w) => keyOf(w.page, w.scale)));
    const stale: number[] = [];
    for (const [k, id] of this.inflight) {
      if (!this.wanted.has(k)) {
        stale.push(id);
        this.inflight.delete(k);
      }
    }
    this.client.cancel(stale);

    for (const w of wants) {
      const k = keyOf(w.page, w.scale);
      if ((this.cache.get(k) && !this.outdated.has(k)) || this.inflight.has(k)) continue;
      const docId = this.docId;
      const gen = this.generation.get(w.page) ?? 0;
      const { id, promise } = this.client.render({ docId, page: w.page, scale: w.scale, priority: w.priority, hide: this.hide });
      this.inflight.set(k, id);
      promise.then(
        (r) => {
          if (this.inflight.get(k) === id) this.inflight.delete(k);
          if (docId !== this.docId || gen !== (this.generation.get(w.page) ?? 0)) {
            r.bitmap.close();
            return;
          }
          this.outdated.delete(k);
          this.cache.set(k, { page: w.page, scale: w.scale, ...r }, r.width * r.height, (key) => this.wanted.has(key));
          this.onReady(w.page);
        },
        (e: unknown) => {
          if (this.inflight.get(k) === id) this.inflight.delete(k);
          if (!(e instanceof PdfError && (e.code === "cancelled" || e.code === "stale"))) console.error("render failed", w, e);
        },
      );
    }
    this.cache.trim((key) => this.wanted.has(key));
  }

  dispose() {
    this.setDoc(-1);
  }
}
