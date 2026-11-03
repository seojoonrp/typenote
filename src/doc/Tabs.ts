// Open documents, one tab each, all in the one window. A tab has its own MuPDF worker (closing
// the tab ends it and frees its memory) and DocStore, and remembers its page and zoom for when
// it is shown again.
import { PdfClient } from "../pdf/client";
import type { ZoomMode } from "../viewer/Viewer";
import { DocStore, type DocHost } from "./DocStore";

export type TabView = { page: number; mode: ZoomMode; zoom: number };

export class Tab {
  readonly client = new PdfClient();
  readonly store: DocStore;
  /** Finishes edits in progress (the text being typed) before the tab is hidden or closed. */
  flush: () => void = () => {};

  constructor(
    readonly id: number,
    host: DocHost,
    public view: TabView,
  ) {
    this.store = new DocStore(this.client, host);
  }

  dispose() {
    this.store.dispose();
    this.client.dispose();
  }
}

/** Comparable form of a Windows path (case-insensitive, either slash). */
export const pathKey = (path: string) => path.replace(/\//g, "\\").toLowerCase();

export type TabsState = { tabs: Tab[]; activeId: number | null };

export class Tabs {
  private state: TabsState = { tabs: [], activeId: null };
  private listeners = new Set<() => void>();
  private nextId = 1;

  constructor(private host: DocHost) {}

  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  private set(patch: Partial<TabsState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  get active(): Tab | null {
    return this.state.tabs.find((t) => t.id === this.state.activeId) ?? null;
  }

  /** A tab that is not shown yet: `add` it once its document is open, or dispose it. */
  create(view: TabView): Tab {
    return new Tab(this.nextId++, this.host, view);
  }

  /** Appends the tab and shows it. */
  add(tab: Tab) {
    this.active?.flush();
    this.set({ tabs: [...this.state.tabs, tab], activeId: tab.id });
  }

  activate(id: number) {
    if (id === this.state.activeId) return;
    this.active?.flush();
    this.set({ activeId: id });
  }

  /** Moves a tab to position `index` (dragging tabs). */
  move(id: number, index: number) {
    const tabs = [...this.state.tabs];
    const from = tabs.findIndex((t) => t.id === id);
    if (from < 0) return;
    const [tab] = tabs.splice(from, 1);
    tabs.splice(Math.max(0, Math.min(tabs.length, index)), 0, tab!);
    if (tabs.some((t, i) => t !== this.state.tabs[i])) this.set({ tabs });
  }

  /** Shows the next (1) or previous (-1) tab, wrapping around. */
  cycle(dir: 1 | -1) {
    const { tabs } = this.state;
    const i = tabs.findIndex((t) => t.id === this.state.activeId);
    if (i < 0 || tabs.length < 2) return;
    this.activate(tabs[(i + dir + tabs.length) % tabs.length]!.id);
  }

  /** Removes and disposes the tab; closing the shown tab shows its right neighbour, else its left. */
  remove(id: number) {
    const { tabs, activeId } = this.state;
    const i = tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const rest = tabs.filter((t) => t.id !== id);
    const next = activeId === id ? (rest[i] ?? rest[i - 1] ?? null)?.id ?? null : activeId;
    this.set({ tabs: rest, activeId: next });
    tabs[i]!.dispose();
  }

  findByPath(path: string): Tab | undefined {
    const key = pathKey(path);
    return this.state.tabs.find((t) => {
      const p = t.store.getState().doc?.path;
      return p != null && pathKey(p) === key;
    });
  }
}
