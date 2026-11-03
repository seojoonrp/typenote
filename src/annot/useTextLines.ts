// Where the current page has text, so the select and highlight tools can show an I-beam over it
// (and the normal pointer elsewhere).
import { useCallback, useEffect, useState } from "react";
import type { PdfClient } from "../pdf/client";

type Rect = [number, number, number, number];

/** pt of slack around a line, as the worker allows when a selection starts */
const LINE_SLOP = 1;

export function useTextLines(client: PdfClient, page: number) {
  const [lines, setLines] = useState<{ page: number; rects: Rect[] } | null>(null);
  useEffect(() => {
    let alive = true;
    client.textLines(page).then(
      (rects) => alive && setLines({ page, rects }),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [client, page]);

  /** Is (x, y) in page space on a text line? */
  return useCallback(
    (x: number, y: number) =>
      lines?.page === page && lines.rects.some((b) => x >= b[0] - LINE_SLOP && x <= b[2] + LINE_SLOP && y >= b[1] - LINE_SLOP && y <= b[3] + LINE_SLOP),
    [lines, page],
  );
}
