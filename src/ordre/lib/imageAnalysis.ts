/**
 * Analyse av et bildeobjekt før det legges i kakeprint-køen.
 * To ting gjelder spiselig print spesielt: gjennomsiktig bakgrunn blir hvit
 * på papiret (ikke usynlig), og nesten helt hvite bilder kan ikke trykkes —
 * spiselig blekk har ikke hvitt, og arket er hvitt fra før.
 */

export type ImageAnalysis = {
  width: number;
  height: number;
  hasTransparency: boolean;
  isVeryLight: boolean;
  meanLuminance: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Kunne ikke lese bildet"));
    img.src = src;
  });
}

export async function analyzeImageFile(file: File): Promise<ImageAnalysis> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const width = img.naturalWidth;
    const height = img.naturalHeight;

    // Nedskalert prøve holder — vi ser etter tendenser, ikke enkeltpiksler.
    const s = 120;
    const cw = Math.max(1, Math.min(s, width));
    const ch = Math.max(1, Math.round((cw * height) / Math.max(1, width)) || 1);
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return {
        width,
        height,
        hasTransparency: false,
        isVeryLight: false,
        meanLuminance: 1,
      };
    }
    ctx.drawImage(img, 0, 0, cw, ch);
    const { data } = ctx.getImageData(0, 0, cw, ch);

    let transparentPixels = 0;
    let lumSum = 0;
    let lightPixels = 0;
    const total = cw * ch;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 250) transparentPixels++;
      const lum =
        (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      lumSum += lum;
      if (lum > 0.93) lightPixels++;
    }

    const meanLuminance = lumSum / total;
    return {
      width,
      height,
      hasTransparency: transparentPixels / total > 0.02,
      isVeryLight: lightPixels / total > 0.9 || meanLuminance > 0.96,
      meanLuminance,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
