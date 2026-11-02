import { useLayoutEffect, useRef } from "react";

/**
 * For a bar floating over the page at `left` px: shifts it left as far as needed to stay inside
 * the page (it would otherwise hang past the right edge). No-op for a bar without a left.
 */
export function useKeepInside(left: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el?.parentElement || typeof left !== "number") return;
    const max = el.parentElement.clientWidth - el.offsetWidth;
    el.style.left = `${Math.max(0, Math.min(left, max))}px`;
  });
  return ref;
}
