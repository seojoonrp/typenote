// Pretendard on the main thread: registered as a FontFace for the overlay and parsed for layout
// (the same TTF bytes the worker embeds, so overlay and PDF place every glyph the same way).
import { useEffect, useState } from "react";
import regularUrl from "../../fonts/Pretendard-Regular.ttf?url";
import semiboldUrl from "../../fonts/Pretendard-SemiBold.ttf?url";
import { makeFaces, type Faces } from "../pdf/engine/faces";

/** A private family name, so nothing installed on the system can stand in for it. */
export const FONT_FAMILY = "TypenotePretendard";

let loading: Promise<Faces> | null = null;

export function loadFaces(): Promise<Faces> {
  loading ??= (async () => {
    const [regular, semibold] = await Promise.all(
      [regularUrl, semiboldUrl].map(async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      }),
    );
    for (const [bytes, weight] of [
      [regular!, "400"],
      [semibold!, "600"],
    ] as const) {
      const face = new FontFace(FONT_FAMILY, bytes.slice(), { weight });
      await face.load();
      document.fonts.add(face);
    }
    return makeFaces({ regular: regular!, semibold: semibold! });
  })().catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** Faces once loaded (null until then). */
export function useFaces(): Faces | null {
  const [faces, setFaces] = useState<Faces | null>(null);
  useEffect(() => {
    let alive = true;
    loadFaces().then(
      (f) => alive && setFaces(f),
      (e: unknown) => console.error("fonts failed to load", e),
    );
    return () => {
      alive = false;
    };
  }, []);
  return faces;
}
