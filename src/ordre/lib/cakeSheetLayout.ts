/**
 * Nesting av kakebilder på ark.
 *
 * Vi pakker med «shelf»-metoden: bildene sorteres etter høyde og legges på
 * hyller fra venstre mot høyre. Får et bilde ikke plass i bredden, prøver vi
 * å rotere det 90°. Alle mål er millimeter og inkluderer utfall (bleed) —
 * kuttmargen mellom bildene kommer i tillegg, slik at klippemerkene ikke
 * lander oppå nabobildet.
 */

export type SheetOrientation = "portrait" | "landscape";

export type SheetSize = { widthMm: number; heightMm: number };

/** Ark vi trykker på. */
export const SHEET_SIZES: Record<string, SheetSize> = {
  A4: { widthMm: 210, heightMm: 297 },
  A3: { widthMm: 297, heightMm: 420 },
};

export const DEFAULT_MARGIN_MM = 8;
/** Kuttmarg mellom to bilder — plass til klippemerker, QR og etikettstripe. */
export const DEFAULT_GAP_MM = 14;

export function sheetSize(
  sheet: string,
  orientation: SheetOrientation = "portrait",
): SheetSize {
  const base = SHEET_SIZES[sheet] ?? SHEET_SIZES.A4;
  return orientation === "landscape"
    ? { widthMm: base.heightMm, heightMm: base.widthMm }
    : base;
}

export type PackItem = {
  id: string;
  /** Fysisk bredde uten utfall. */
  widthMm: number;
  heightMm: number;
  bleedMm?: number;
  isRound?: boolean;
  /** Runde bilder roteres ikke — det gir ingen gevinst. */
  rotatable?: boolean;
};

export type Placement = {
  id: string;
  /** Venstre/topp for bildeflaten uten utfall. */
  xMm: number;
  yMm: number;
  /** Bildeflatens mål slik den plasseres (byttet om når rotated = true). */
  widthMm: number;
  heightMm: number;
  bleedMm: number;
  rotated: boolean;
};

export type PackedPage = {
  sheet: string;
  orientation: SheetOrientation;
  widthMm: number;
  heightMm: number;
  placements: Placement[];
};

export type PackOptions = {
  sheet?: string;
  orientation?: SheetOrientation;
  marginMm?: number;
  gapMm?: number;
  /** Bånd nederst på arket som er reservert til linjal og instruks. */
  reservedBottomMm?: number;
};

export type PackResult = {
  pages: PackedPage[];
  /** Bilder som ikke får plass på arket i det hele tatt. */
  unplaceable: PackItem[];
};

function outer(item: PackItem) {
  const bleed = item.bleedMm ?? 0;
  return { w: item.widthMm + 2 * bleed, h: item.heightMm + 2 * bleed, bleed };
}

/**
 * Får bildet plass på arket i det hele tatt — eventuelt rotert?
 */
export function fitsOnSheet(
  item: PackItem,
  size: SheetSize,
  marginMm = DEFAULT_MARGIN_MM,
  reservedBottomMm = 0,
): { fits: boolean; rotated: boolean } {
  const { w, h } = outer(item);
  const availW = size.widthMm - 2 * marginMm;
  const availH = size.heightMm - 2 * marginMm - reservedBottomMm;
  if (w <= availW && h <= availH) return { fits: true, rotated: false };
  if (item.rotatable !== false && !item.isRound && h <= availW && w <= availH) {
    return { fits: true, rotated: true };
  }
  return { fits: false, rotated: false };
}

/** Shelf-pakking av flere bilder på ett eller flere ark. */
export function packSheets(items: PackItem[], opts: PackOptions = {}): PackResult {
  const sheet = opts.sheet ?? "A4";
  const orientation = opts.orientation ?? "portrait";
  const size = sheetSize(sheet, orientation);
  const margin = opts.marginMm ?? DEFAULT_MARGIN_MM;
  const gap = opts.gapMm ?? DEFAULT_GAP_MM;
  const reservedBottom = opts.reservedBottomMm ?? 0;
  const availW = size.widthMm - 2 * margin;
  const availH = size.heightMm - 2 * margin - reservedBottom;

  const unplaceable: PackItem[] = [];
  const queue = [...items]
    .filter((it) => {
      if (!it.widthMm || !it.heightMm) {
        unplaceable.push(it);
        return false;
      }
      if (!fitsOnSheet(it, size, margin, reservedBottom).fits) {
        unplaceable.push(it);
        return false;
      }
      return true;
    })
    .sort((a, b) => outer(b).h - outer(a).h);

  const pages: PackedPage[] = [];
  let placements: Placement[] = [];
  let cursorX = margin;
  let shelfY = margin;
  let shelfHeight = 0;

  const newPage = () => {
    if (placements.length > 0) {
      pages.push({ sheet, orientation, ...size, placements });
    }
    placements = [];
    cursorX = margin;
    shelfY = margin;
    shelfHeight = 0;
  };

  /** Naturlig retning hvis den får plass i bredden, ellers rotert. */
  const orient = (item: PackItem, widthBudget: number) => {
    const o = outer(item);
    if (o.w <= widthBudget) return { w: o.w, h: o.h, rotated: false };
    const canRotate = item.rotatable !== false && !item.isRound;
    if (canRotate && o.h <= widthBudget) return { w: o.h, h: o.w, rotated: true };
    return null;
  };

  for (const item of queue) {
    const o = outer(item);
    let pick = orient(item, margin + availW - cursorX);

    if (!pick) {
      // Ny hylle
      shelfY += shelfHeight + (shelfHeight > 0 ? gap : 0);
      cursorX = margin;
      shelfHeight = 0;
      pick = orient(item, availW);
    }
    if (!pick) {
      unplaceable.push(item);
      continue;
    }

    if (shelfY + pick.h > margin + availH) {
      newPage();
      pick = orient(item, availW);
      if (!pick) {
        unplaceable.push(item);
        continue;
      }
    }

    const { w, h, rotated } = pick;


    placements.push({
      id: item.id,
      xMm: cursorX + o.bleed,
      yMm: shelfY + o.bleed,
      widthMm: rotated ? item.heightMm : item.widthMm,
      heightMm: rotated ? item.widthMm : item.heightMm,
      bleedMm: o.bleed,
      rotated,
    });

    cursorX += w + gap;
    shelfHeight = Math.max(shelfHeight, h);
  }

  if (placements.length > 0) {
    pages.push({ sheet, orientation, ...size, placements });
  }

  return { pages, unplaceable };
}
