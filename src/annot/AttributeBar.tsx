// Size stepper, weight toggle and colors for a text box (or the tool defaults).
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { Icon } from "../ui/Icon";
import { useKeepInside } from "./floating";
import { clampSize, COLOR_PRESETS, cssColor, hexToRgb, rgbToHex, sameColor, SIZE_PRESETS, type BoxStyle } from "./style";
import { KEEP_DRAFT_ATTR } from "./useTextTool";

type Props = {
  value: BoxStyle;
  onChange(patch: Partial<BoxStyle>, merge?: string): void;
  onStepSize(dir: 1 | -1): void;
  onDelete?: () => void;
  /** after editing a field, give focus back (e.g. to the text being typed) */
  onDone?: () => void;
  /** open the size list upward (the bar is above the box: the list would cover its text) */
  listUp?: boolean;
  className?: string;
  style?: CSSProperties;
};

/** mousedown on buttons would steal focus from the text being typed */
const keepFocus = (e: MouseEvent) => e.preventDefault();

export function AttributeBar({ value, onChange, onStepSize, onDelete, onDone, listUp, className, style }: Props) {
  const ref = useKeepInside(style?.left);
  const [sizeText, setSizeText] = useState(String(value.size));
  const [listOpen, setListOpen] = useState(false);
  /** a preset was just picked: the field's blur must not apply the old text over it */
  const picked = useRef(false);
  useEffect(() => setSizeText(String(value.size)), [value.size]);

  const applySize = () => {
    const n = parseFloat(sizeText.replace(",", "."));
    if (n > 0) onChange({ size: clampSize(n) });
    else setSizeText(String(value.size));
  };

  return (
    <div
      ref={ref}
      className={`attr-bar ${className ?? ""}`}
      style={style}
      {...{ [KEEP_DRAFT_ATTR]: "" }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button onMouseDown={keepFocus} onClick={() => onStepSize(-1)} title="Smaller (Ctrl+Shift+,)" aria-label="Smaller">
        <Icon name="minus" size={14} />
      </button>
      {/* a size field (any size can be typed) with the preset sizes below it */}
      <div className="size-field">
        <input
          className="size"
          inputMode="decimal"
          aria-label="Font size (pt)"
          value={sizeText}
          onFocus={(e) => {
            e.currentTarget.select();
            setListOpen(true);
          }}
          onClick={() => setListOpen(true)}
          onChange={(e) => setSizeText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") {
              applySize();
              setListOpen(false);
              onDone?.();
            } else if (e.key === "Escape") {
              setSizeText(String(value.size));
              setListOpen(false);
              onDone?.();
            }
          }}
          onBlur={() => {
            setListOpen(false);
            if (picked.current) picked.current = false;
            else applySize();
          }}
        />
        {listOpen && (
          <ul className={`size-list${listUp ? " up" : ""}`} role="listbox" aria-label="Font sizes">
            {SIZE_PRESETS.map((s) => (
              <li key={s}>
                <button
                  role="option"
                  aria-selected={s === value.size}
                  className={s === value.size ? "active" : ""}
                  // on mousedown, before the field's blur closes the list
                  onMouseDown={(e) => {
                    e.preventDefault();
                    picked.current = true;
                    setSizeText(String(s));
                    setListOpen(false);
                    onChange({ size: s });
                    onDone?.();
                    if (!onDone) picked.current = false;
                  }}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button onMouseDown={keepFocus} onClick={() => onStepSize(1)} title="Larger (Ctrl+Shift+.)" aria-label="Larger">
        <Icon name="plus" size={14} />
      </button>
      <button
        onMouseDown={keepFocus}
        className={`weight${value.weight === "semibold" ? " active" : ""}`}
        onClick={() => onChange({ weight: value.weight === "semibold" ? "regular" : "semibold" })}
        title="Bold (Ctrl+B)"
      >
        B
      </button>
      <span className="sep" />
      {COLOR_PRESETS.map((p) => (
        <button
          key={p.name}
          onMouseDown={keepFocus}
          className={`swatch${sameColor(p.color, value.color) ? " active" : ""}`}
          style={{ background: cssColor(p.color) }}
          title={p.name}
          aria-label={p.name}
          onClick={() => onChange({ color: p.color })}
        />
      ))}
      <input
        type="color"
        className="picker"
        title="Other color"
        aria-label="Other color"
        value={rgbToHex(value.color)}
        onChange={(e) => onChange({ color: hexToRgb(e.currentTarget.value) }, "color")}
        onBlur={() => onDone?.()}
      />
      {onDelete && (
        <>
          <span className="sep" />
          <button className="danger" onMouseDown={keepFocus} onClick={onDelete} title="Delete (Del)" aria-label="Delete">
            <Icon name="trash" size={16} />
          </button>
        </>
      )}
    </div>
  );
}
