import * as fabric from "fabric";
import { removeColorDistance } from "@/ordre/lib/cakeEditorMath";

/** Filterinnstillinger lagres per bildelag i editor_state. */
export type CakeFilterSettings = {
  brightness: number; // -100 … 100
  contrast: number; // -100 … 100
  saturation: number; // -100 … 100
  sharpen: number; // 0 … 100
  temperature: number; // -100 (kaldt) … 100 (varmt)
  grayscale: boolean;
  removeWhite: boolean;
  removeWhiteThreshold: number; // 0 … 100
};

export const DEFAULT_FILTERS: CakeFilterSettings = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  sharpen: 0,
  temperature: 0,
  grayscale: false,
  removeWhite: false,
  removeWhiteThreshold: 20,
};

export type CakeFilterImage = fabric.FabricImage & {
  cakeFilters?: Partial<CakeFilterSettings>;
};

export function getCakeFilters(obj: fabric.Object | null): CakeFilterSettings {
  const stored = (obj as CakeFilterImage | null)?.cakeFilters;
  return { ...DEFAULT_FILTERS, ...(stored ?? {}) };
}

function sharpenMatrix(amount: number) {
  // 0 = ingen effekt, 1 = full skarphet.
  const a = Math.max(0, Math.min(1, amount));
  const c = 1 + 4 * a;
  const s = -a;
  return [0, s, 0, s, c, s, 0, s, 0];
}

function temperatureMatrix(t: number) {
  // Positiv = varmere (mer rødt, mindre blått).
  const k = Math.max(-100, Math.min(100, t)) / 100;
  const r = 1 + 0.25 * k;
  const b = 1 - 0.25 * k;
  return [
    r, 0, 0, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, b, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** Bygg Fabric-filtrene for et sett innstillinger. */
export function buildCakeFilters(s: CakeFilterSettings) {
  const filters: fabric.filters.BaseFilter<string>[] = [];
  if (s.brightness !== 0)
    filters.push(new fabric.filters.Brightness({ brightness: s.brightness / 100 }));
  if (s.contrast !== 0)
    filters.push(new fabric.filters.Contrast({ contrast: s.contrast / 100 }));
  if (s.saturation !== 0)
    filters.push(new fabric.filters.Saturation({ saturation: s.saturation / 100 }));
  if (s.temperature !== 0)
    filters.push(new fabric.filters.ColorMatrix({ matrix: temperatureMatrix(s.temperature) }));
  if (s.sharpen > 0)
    filters.push(
      new fabric.filters.Convolute({ matrix: sharpenMatrix(s.sharpen / 100) }),
    );
  if (s.grayscale) filters.push(new fabric.filters.Grayscale());
  if (s.removeWhite)
    filters.push(
      new fabric.filters.RemoveColor({
        color: "#FFFFFF",
        distance: removeColorDistance(s.removeWhiteThreshold),
      }),
    );
  return filters;
}

/** Legg filtrene på laget og husk innstillingene på objektet. */
export function applyCakeFilters(
  img: fabric.FabricImage,
  settings: CakeFilterSettings,
) {
  (img as CakeFilterImage).cakeFilters = settings;
  img.filters = buildCakeFilters(settings);
  img.applyFilters();
}
