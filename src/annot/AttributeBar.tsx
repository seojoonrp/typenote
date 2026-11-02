// Size stepper, weight toggle and colors for a text box (or the tool defaults).
import { useEffect, useState, type CSSProperties, type MouseEvent } from "react";
import { clampSize, COLOR_PRESETS, cssColor, hexToRgb, rgbToHex, sameColor, SIZE_PRESETS, type BoxStyle } from "./style";
import { KEEP_DRAFT_ATTR } from "./useTextTool";

type Props = {
  value: BoxStyle;
  onChange(patch: Partial<BoxStyle>, merge?: string): void;
  onStepSize(dir: 1 | -1): void;
  onDelete?: () => void;
  /** after editing a field, give focus back (e.g. to the text being typed) */
  onDone?: () => void;
  className?: string;
  style?: CSSProperties;
};

/** mousedown on buttons would steal focus from the text being typed */
const keepFocus = (e: MouseEvent) => e.preventDefault();

export function AttributeBar({ value, onChange, onStepSize, onDelete, onDone, className, style }: Props) {
  const [sizeText, setSizeText] = useState(String(value.size));
  useEffect(() => setSizeText(String(value.size)), [value.size]);

  const applySize = () => {
    const n = parseFloat(sizeText.replace(",", "."));
    if (n > 0) onChange({ size: clampSize(n) });
    else setSizeText(String(value.size));
  };

  return (
    <div
      className={`attr-bar ${className ?? ""}`}
      style={style}
      {...{ [KEEP_DRAFT_ATTR]: "" }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button onMouseDown={keepFocus} onClick={() => onStepSize(-1)} title="작게 (Ctrl+Shift+,)">
        −
      </button>
      <input
        className="size"
        list="typenote-size-presets"
        inputMode="decimal"
        aria-label="글자 크기 (pt)"
        value={sizeText}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setSizeText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter") {
            applySize();
            onDone?.();
          } else if (e.key === "Escape") {
            setSizeText(String(value.size));
            onDone?.();
          }
        }}
        onBlur={applySize}
      />
      <datalist id="typenote-size-presets">
        {SIZE_PRESETS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <button onMouseDown={keepFocus} onClick={() => onStepSize(1)} title="크게 (Ctrl+Shift+.)">
        +
      </button>
      <button
        onMouseDown={keepFocus}
        className={`weight${value.weight === "semibold" ? " active" : ""}`}
        onClick={() => onChange({ weight: value.weight === "semibold" ? "regular" : "semibold" })}
        title="굵게 (Ctrl+B)"
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
        title="다른 색"
        aria-label="다른 색"
        value={rgbToHex(value.color)}
        onChange={(e) => onChange({ color: hexToRgb(e.currentTarget.value) }, "color")}
        onBlur={() => onDone?.()}
      />
      {onDelete && (
        <>
          <span className="sep" />
          <button onMouseDown={keepFocus} onClick={onDelete} title="삭제 (Delete)">
            삭제
          </button>
        </>
      )}
    </div>
  );
}
