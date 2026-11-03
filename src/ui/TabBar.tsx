// The window's top strip: the mark, one tab per open document (name, unsaved dot, save problem,
// close) and a button that opens another file. Middle click closes a tab too.
import { useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import type { Tab } from "../doc/Tabs";
import { Icon } from "./Icon";
import { LogoMark } from "./Logo";

type Props = {
  tabs: Tab[];
  activeId: number | null;
  onActivate(tab: Tab): void;
  onClose(tab: Tab): void;
  onMove(tab: Tab, index: number): void;
  onOpen(): void;
};

const DRAG_THRESHOLD_PX = 5;

export function TabBar({ tabs, activeId, onActivate, onClose, onMove, onOpen }: Props) {
  const navRef = useRef<HTMLElement>(null);
  const live = useRef({ tabs, onMove });
  live.current = { tabs, onMove };

  /**
   * Press on a tab: it is shown at once (like Chrome); dragging it sideways moves it among the
   * others, the tab following the pointer and swapping places as it passes a neighbour's middle.
   */
  const press = (tab: Tab) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as Element).closest(".tab-close")) return;
    onActivate(tab);
    const el = e.currentTarget;
    // on the window, not captured: reordering moves the tab's node, which drops pointer capture
    const startX = e.clientX;
    const grab = e.clientX - el.getBoundingClientRect().left;
    let dragging = false;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      el.classList.add("dragging");
      const { tabs: list, onMove: moveTab } = live.current;
      const others = [...navRef.current!.querySelectorAll<HTMLElement>(".tab")].filter((t) => t !== el);
      const left = ev.clientX - grab;
      const mid = left + el.offsetWidth / 2;
      const index = others.filter((t) => {
        const r = t.getBoundingClientRect();
        return r.left + r.width / 2 < mid;
      }).length;
      if (list.findIndex((t) => t.id === tab.id) !== index) moveTab(tab, index);
      // follow the pointer from wherever the tab now sits
      el.style.transform = "";
      el.style.transform = `translateX(${left - el.getBoundingClientRect().left}px)`;
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      el.style.transform = "";
      el.classList.remove("dragging");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return (
    <nav className="tabbar" role="tablist" ref={navRef}>
      <span className="tabbar-mark">
        <LogoMark size={22} />
      </span>
      {tabs.map((t) => (
        <TabItem key={t.id} tab={t} active={t.id === activeId} onPress={press(t)} onClose={() => onClose(t)} />
      ))}
      <button className="tab-new" title="Open a PDF (Ctrl+O)" aria-label="Open a PDF" onClick={onOpen}>
        <Icon name="plus" size={16} />
      </button>
    </nav>
  );
}

function TabItem({ tab, active, onPress, onClose }: { tab: Tab; active: boolean; onPress(e: ReactPointerEvent<HTMLDivElement>): void; onClose(): void }) {
  const { doc, dirty, saveProblem } = useSyncExternalStore(tab.store.subscribe, tab.store.getState);
  const name = doc?.name ?? "…";
  return (
    <div
      role="tab"
      aria-selected={active}
      className={`tab${active ? " active" : ""}${dirty ? " dirty" : ""}`}
      title={doc?.path ?? name}
      onPointerDown={onPress}
      // middle button: no autoscroll, close on release
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => {
        if (e.button === 1) onClose();
      }}
    >
      {saveProblem ? (
        <span className="tab-problem" title={`Not saved: ${saveProblem.message}`}>
          <Icon name="alert" size={14} />
        </span>
      ) : (
        <span className="tab-icon">
          <Icon name="file" size={14} />
        </span>
      )}
      <span className="tab-name">{name}</span>
      <button
        className="tab-close"
        title={dirty ? "Unsaved changes · Close (Ctrl+W)" : "Close (Ctrl+W)"}
        aria-label={`Close ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <span className="tab-dot" />
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
