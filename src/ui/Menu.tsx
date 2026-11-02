import { useState, type ReactNode } from "react";

/** Dropdown: a button and a list of buttons; closes on pick, mouse leave or Esc. */
export function Menu({ label, disabled, wide, align, children }: { label: string; disabled?: boolean; wide?: boolean; align?: "right"; children: ReactNode[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu" onMouseLeave={() => setOpen(false)} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button onClick={() => setOpen((o) => !o)} disabled={disabled} aria-expanded={open}>
        {label}
      </button>
      {open && (
        <ul className={`menu-list${wide ? " wide" : ""}${align === "right" ? " right" : ""}`} onClick={() => setOpen(false)}>
          {children.map((child, i) => (
            <li key={i}>{child}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
