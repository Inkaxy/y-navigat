/**
 * Innlasting av kildebilder til editoren.
 *
 * iPhone-bilder er ofte HEIC og gjerne 10 MB. Nettleseren kan ikke dekode HEIC,
 * og et ubehandlet 8000 px-bilde sprenger minnet på iPad. Derfor: dekod HEIC
 * klientside, respekter EXIF-orientering og skaler ned til noe lerretet klarer.
 */

export const MAX_SOURCE_PX = 5000;

export type LoadedSource = {
  /** Object-URL til et PNG/JPEG nettleseren garantert kan tegne. */
  url: string;
  width: number;
  height: number;
  /** True når bildet ble skalert ned fra originalen. */
  downscaled: boolean;
};

function isHeic(file: Blob, name?: string) {
  const type = (file.type || "").toLowerCase();
  if (type.includes("heic") || type.includes("heif")) return true;
  const n = (name ?? (file as File).name ?? "").toLowerCase();
  return n.endsWith(".heic") || n.endsWith(".heif");
}

async function decodeHeic(blob: Blob): Promise<Blob> {
  const mod = await import("heic2any");
  const convert = (mod.default ?? mod) as (opts: {
    blob: Blob;
    toType?: string;
    quality?: number;
  }) => Promise<Blob | Blob[]>;
  const out = await convert({ blob, toType: "image/jpeg", quality: 0.92 });
  return Array.isArray(out) ? out[0] : out;
}

async function toBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      // faller tilbake til <img> under
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Bildet kunne ikke åpnes"));
      img.src = url;
    });
  } finally {
    // URL-en frigjøres når bildet er tegnet inn på lerretet under.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function blobFromCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("Bildet kunne ikke gjøres om"));
    }, "image/png");
  });
}

/** Dekod (HEIC om nødvendig), orienter riktig og skaler ned til maks 5000 px. */
export async function loadCakeSource(
  input: Blob,
  name?: string,
  maxPx = MAX_SOURCE_PX,
): Promise<LoadedSource> {
  const blob = isHeic(input, name) ? await decodeHeic(input) : input;
  const bitmap = await toBitmap(blob);
  const w = "width" in bitmap ? bitmap.width : 0;
  const h = "height" in bitmap ? bitmap.height : 0;
  if (!w || !h) throw new Error("Bildet kunne ikke åpnes");

  const scale = Math.min(1, maxPx / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Bildet kunne ikke åpnes");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, outW, outH);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  const outBlob = await blobFromCanvas(canvas);
  return {
    url: URL.createObjectURL(outBlob),
    width: outW,
    height: outH,
    downscaled: scale < 1,
  };
}

/** Samme behandling, men fra en URL (lagret original i bøtta). */
export async function loadCakeSourceFromUrl(
  url: string,
  maxPx = MAX_SOURCE_PX,
): Promise<LoadedSource> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Bildet kunne ikke hentes");
  const blob = await res.blob();
  return loadCakeSource(blob, url, maxPx);
}
