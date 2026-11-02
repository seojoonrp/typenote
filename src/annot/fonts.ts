// Pretendard on the main thread: registered as a FontFace for the overlay and parsed for layout
// (the same TTF bytes the worker embeds, so overlay and PDF place every glyph the same way).
import { useEffect, useState } from "react";
import regularUrl from "../../fonts/Pretendard-Regular.ttf?url";
import semiboldUrl from "../../fonts/Pretendard-SemiBold.ttf?url";
import { makeFaces, withHangulTracking, type Faces } from "../pdf/engine/faces";
import { HANGUL_TRACKING } from "../pdf/engine/layout";

/** A private family name, so nothing installed on the system can stand in for it. */
export const FONT_FAMILY = "TypenotePretendard";

let loading: Promise<Faces> | null = null;
let loaded: Faces | null = null;
/** letter spacing (em) -> registered family whose Hangul glyphs carry it */
const trackedFamilies = new Map<number, string>();

async function registerFamily(family: string, faces: Faces, tracking: number) {
  for (const face of [faces.regular, faces.semibold]) {
    const bytes = tracking ? withHangulTracking(face, tracking) : new Uint8Array(face.bytes);
    const ff = new FontFace(family, bytes, { weight: face.weight === "semibold" ? "600" : "400" });
    document.fonts.add(ff);
    await ff.load();
  }
}

/**
 * The overlay family for a box's Hangul letter spacing. The current default is registered with
 * the fonts; any other value (from an older file) is registered on first use.
 */
export function familyFor(tracking = 0): string {
  if (!tracking) return FONT_FAMILY;
  let family = trackedFamilies.get(tracking);
  if (!family) {
    family = `${FONT_FAMILY}T${Math.round(-tracking * 1e4)}`;
    trackedFamilies.set(tracking, family);
    if (loaded) void registerFamily(family, loaded, tracking).catch((e: unknown) => console.error("font failed to load", e));
  }
  return family;
}

export function loadFaces(): Promise<Faces> {
  loading ??= (async () => {
    const [regular, semibold] = await Promise.all(
      [regularUrl, semiboldUrl].map(async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      }),
    );
    const faces = makeFaces({ regular: regular!, semibold: semibold! });
    await registerFamily(FONT_FAMILY, faces, 0);
    const tracked = `${FONT_FAMILY}T${Math.round(-HANGUL_TRACKING * 1e4)}`;
    await registerFamily(tracked, faces, HANGUL_TRACKING);
    trackedFamilies.set(HANGUL_TRACKING, tracked);
    loaded = faces;
    return faces;
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
