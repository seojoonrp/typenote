// The window: one tab per open document. Opens files (dialog, recent list, drag and drop,
// launch and the .pdf association, each as a new tab), closes them, and shows the start screen.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DocumentView, initialView } from "./DocumentView";
import { pathKey, Tabs, type Tab } from "./doc/Tabs";
import { PdfError } from "./pdf/client";
import type { TextBoxInput } from "./pdf/engine/model";
import { baseName, platform, type OpenedFile } from "./platform";
import { Icon } from "./ui/Icon";
import { LogoMark } from "./ui/Logo";
import { Menu } from "./ui/Menu";
import { TabBar } from "./ui/TabBar";

/** The folder part of a path, for the second line of a recent file. */
const dirName = (path: string) => path.slice(0, Math.max(0, path.length - baseName(path).length - 1));

// one tab list for the app's lifetime (not per render: StrictMode double-invokes initializers).
// The tabs' stores leave the window title alone; the shown document sets it.
let sharedTabs: Tabs | null = null;
const getTabs = () =>
  (sharedTabs ??= new Tabs({
    writePdf: platform.writePdf,
    pickSavePath: platform.pickSavePath,
    addRecentFile: platform.addRecentFile,
    setTitle: () => {},
  }));

/** Ctrl + these zoom the shown document, never the UI itself */
const ZOOM_KEYS = new Set(["=", "+", "-", "0", "1", "2"]);

/** Saves the tabs' edits; if some could not be saved, asks before letting them go. */
async function settle(list: Tab[]): Promise<boolean> {
  const failed: string[] = [];
  for (const t of list) {
    const s = t.store.getState();
    if (s.dirty && !(await t.store.save())) failed.push(s.doc?.name ?? "untitled");
  }
  if (failed.length === 0) return true;
  return platform.ask(`Changes to ${failed.join(", ")} could not be saved. Close without saving them?`, "Close", "Cancel");
}

export function App() {
  const tabs = getTabs();
  const { tabs: list, activeId } = useSyncExternalStore(tabs.subscribe, tabs.getState);
  const active = list.find((t) => t.id === activeId) ?? null;
  const [recent, setRecent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(0);
  /** paths being opened, so a second request for the same file does not open it twice */
  const openingPaths = useRef(new Set<string>());

  /** Opens a file as a new tab, or shows the tab that already has it. */
  const openLoaded = useCallback(
    async (load: () => Promise<OpenedFile>, path: string | null) => {
      if (path) {
        const existing = tabs.findByPath(path);
        if (existing) return tabs.activate(existing.id);
        if (openingPaths.current.has(pathKey(path))) return;
        openingPaths.current.add(pathKey(path));
      }
      setOpening((n) => n + 1);
      setError(null);
      const tab = tabs.create(initialView());
      try {
        const file = await load();
        await tab.store.open(file);
        tabs.add(tab);
        if (file.path) setRecent(await platform.addRecentFile(file.path));
      } catch (e) {
        tab.dispose();
        const reason = e instanceof PdfError ? e.message : `Could not open the file (${e instanceof Error ? e.message : String(e)})`;
        setError(path ? `${baseName(path)}: ${reason}` : reason);
        if (path && !(e instanceof PdfError)) setRecent(await platform.removeRecentFile(path));
      } finally {
        if (path) openingPaths.current.delete(pathKey(path));
        setOpening((n) => n - 1);
      }
    },
    [tabs],
  );

  const openPath = useCallback((path: string) => openLoaded(() => platform.readPath(path), path), [openLoaded]);

  const pick = useCallback(async () => {
    const file = await platform.pickPdf().catch((e: unknown) => {
      setError(String(e));
      return null;
    });
    if (file) void openLoaded(async () => file, file.path);
  }, [openLoaded]);

  const closeTab = useCallback(
    async (tab: Tab) => {
      tab.flush();
      if (await settle([tab])) tabs.remove(tab.id);
    },
    [tabs],
  );

  // launch files and files opened while running, recent list, drag & drop, closing the window
  useEffect(() => {
    void platform.recentFiles().then(setRecent);
  }, []);
  // one after another, so the tabs come in the order the files were given
  const openQueue = useRef<Promise<void>>(Promise.resolve());
  useEffect(
    () =>
      platform.onOpenRequest((p) => {
        openQueue.current = openQueue.current.then(() => openPath(p));
      }),
    [openPath],
  );
  useEffect(() => platform.onFileDrop((load, path) => void openLoaded(load, path)), [openLoaded]);
  useEffect(
    () =>
      platform.onCloseRequested(() => {
        tabs.active?.flush();
        return settle(tabs.getState().tabs);
      }),
    [tabs],
  );
  useEffect(() => {
    if (!active) platform.setTitle("typenote");
  }, [active]);

  // window shortcuts (never while an IME is composing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      // reloading the page would drop the open tabs
      if (!import.meta.env.DEV && (e.key === "F5" || (e.ctrlKey && e.code === "KeyR"))) {
        e.preventDefault();
        return;
      }
      if (!e.ctrlKey || e.altKey) return;
      if (ZOOM_KEYS.has(e.key)) {
        e.preventDefault();
      } else if (e.code === "KeyO") {
        e.preventDefault();
        void pick();
      } else if (e.code === "KeyW") {
        e.preventDefault();
        if (tabs.active) void closeTab(tabs.active);
      } else if (e.key === "Tab" || e.key === "PageDown" || e.key === "PageUp") {
        e.preventDefault();
        tabs.cycle(e.key === "PageUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabs, pick, closeTab]);

  // development hook for scripted checks (tools/): window.__typenote.store (the shown tab's), openPath()
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __typenote: unknown }).__typenote = {
      tabs,
      get store() {
        return tabs.active?.store ?? null;
      },
      openPath,
      addTestBox: (patch: Partial<TextBoxInput> = {}) => {
        const t = tabs.active;
        return t?.store.putTextBox({ page: t.view.page, x: 60, y: 60, text: "테스트 상자 Test 123\n둘째 줄", size: 14, weight: "regular", color: [0.1, 0.2, 0.8], ...patch });
      },
    };
  }, [tabs, openPath]);

  const recentItem = (p: string) => (
    <button key={p} onClick={() => void openPath(p)} title={p}>
      <Icon name="file" />
      <span className="mi-label">
        {baseName(p)}
        <span className="mi-note">{dirName(p)}</span>
      </span>
    </button>
  );

  const toolbarStart = (
    <>
      <button className="icon-button" onClick={() => void pick()} title="Open (Ctrl+O)" aria-label="Open">
        <Icon name="open" />
      </button>
      <Menu label={<Icon name="recent" />} title="Recent files" disabled={recent.length === 0} wide>
        {recent.map(recentItem)}
      </Menu>
    </>
  );

  const notice = error && (
    <div className="error" role="alert">
      <Icon name="alert" size={16} />
      <span className="error-text">{error}</span>
      <button onClick={() => setError(null)}>Dismiss</button>
    </div>
  );

  return (
    <div className="app">
      {list.length > 0 && (
        <TabBar tabs={list} activeId={activeId} onActivate={(t) => tabs.activate(t.id)} onClose={(t) => void closeTab(t)} onOpen={() => void pick()} />
      )}
      {active ? (
        <DocumentView key={active.id} tab={active} toolbarStart={toolbarStart} notice={notice} />
      ) : (
        <main className="start">
          {notice}
          <div className="start-body">
            <section className="start-hero">
              <LogoMark size={72} />
              <h1>typenote</h1>
              <p className="tagline">Type and highlight on PDFs, with Hangul that stays intact everywhere.</p>
              <button className="primary" onClick={() => void pick()} disabled={opening > 0}>
                <Icon name="open" />
                {opening > 0 ? "Opening…" : "Open PDF"}
                {opening === 0 && <kbd>Ctrl+O</kbd>}
              </button>
              <p className="drop-hint">
                <Icon name="drop" size={16} />
                or drop a PDF anywhere in this window
              </p>
            </section>
            {recent.length > 0 && (
              <section className="recent">
                <h2>Recent</h2>
                <ul>
                  {recent.map((p) => (
                    <li key={p}>{recentItem(p)}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
