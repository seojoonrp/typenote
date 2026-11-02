import { useState, type ReactNode } from "react";
import { Icon } from "./Icon";

type Props = { label: ReactNode; title?: string; disabled?: boolean; wide?: boolean; align?: "right"; children: ReactNode[] };

/** Dropdown: a button (label and a chevron) and a list of buttons; closes on pick, mouse leave or Esc. */
export function Menu({ label, title, disabled, wide, align, children }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu" onMouseLeave={() => setOpen(false)} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button className={`menu-button${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)} disabled={disabled} aria-expanded={open} title={title}>
        {label}
        <Icon name="chevron" size={14} />
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
