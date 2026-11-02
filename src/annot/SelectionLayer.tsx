// The selected page text (select tool), and a Copy button above it.
import type { Quad } from "../pdf/engine/model";
import { Icon } from "../ui/Icon";
import { useKeepInside } from "./floating";
import { quadsBounds } from "./highlightStyle";
import type { TextSelection } from "./useTextSelection";

const BUTTON_HEIGHT_PX = 32;
const GAP_PX = 8;

export function SelectionLayer({ ts, scale }: { ts: TextSelection; scale: number }) {
  const sel = ts.selection;
  const bounds = sel && quadsBounds(sel.quads);
  let top = 0;
  if (bounds) {
    top = bounds[1] * scale - BUTTON_HEIGHT_PX - GAP_PX;
    if (top < 0) top = bounds[3] * scale + GAP_PX;
  }
  const left = bounds ? Math.max(0, bounds[0] * scale) : 0;
  const ref = useKeepInside<HTMLButtonElement>(left);
  if (!sel || !bounds) return null;
  return (
    <div className="text-selection">
      {sel.quads.map((q, i) => (
        <QuadShape key={i} q={q} scale={scale} />
      ))}
      <button
        ref={ref}
        className="copy-button"
        style={{ left, top }}
        title="Copy (Ctrl+C)"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => void ts.copy()}
      >
        <Icon name={ts.copied ? "check" : "copy"} size={15} />
        {ts.copied ? "Copied" : "Copy"}
        {!ts.copied && <kbd>Ctrl+C</kbd>}
      </button>
    </div>
  );
}

function QuadShape({ q, scale }: { q: Quad; scale: number }) {
  const [x0, y0, x1, y1] = quadsBounds([q]);
  const pts = [
    [q[0], q[1]],
    [q[2], q[3]],
    [q[6], q[7]],
    [q[4], q[5]],
  ]
    .map(([x, y]) => `${(x! - x0) * scale},${(y! - y0) * scale}`)
    .join(" ");
  return (
    <svg className="selection-shape" style={{ left: x0 * scale, top: y0 * scale }} width={(x1 - x0) * scale} height={(y1 - y0) * scale}>
      <polygon points={pts} />
    </svg>
  );
}
