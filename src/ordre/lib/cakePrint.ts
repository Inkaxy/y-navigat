/**
 * Én felles utskriftsvei for kakebilder.
 *
 * Alt som skal på papir går herfra — utskriftsruta, editorens «Skriv ut»,
 * PDF-nedlasting og kalibrerings-testarket. Bildet plasseres i en boks med
 * eksakte millimeterverdier, sentrert på A4, uten skalering av noe slag.
 * Ingen max-width, ingen object-fit: contain.
 */
import jsPDF from "jspdf";
import QRCode from "qrcode";
import type { CakeImage } from "@/ordre/lib/cakeImages";
import type { CakeImageFormat } from "@/ordre/lib/cakeFormats";
import { formatDims } from "@/ordre/lib/cakeFormats";
import {
  fitsOnSheet,
  packSheets,
  sheetSize,
  type PackItem,
  type Placement,
  type SheetOrientation,
} from "@/ordre/lib/cakeSheetLayout";
import { resolveLabelNumber } from "@/ordre/lib/labelNumber";

/** Linjal langs kanten — måler du 50 mm med linjal, har skriveren ikke skalert. */
export const RULER_MM = 50;

export type CakePrintItem = {
  /** Raden bildet hører til. Kan mangle ved testark. */
  image?: CakeImage | null;
  /** Bildekilde: signert URL eller data-URL fra editoren. */
  url: string;
  /** Fysisk størrelse. Overstyrer verdiene på raden. */
  widthMm?: number | null;
  heightMm?: number | null;
  isRound?: boolean;
  labelNumber?: string | null;
  orderRef?: string | null;
  customerName?: string | null;
  deliveryDate?: string | null;
  title?: string | null;
  /** Ark formatet krever (A4/A3). */
  sheet?: string | null;
  bleedMm?: number | null;
  /** Fra ordrelinjen: produktnavn og tekst på kaken. */
  productName?: string | null;
  cakeText?: string | null;
};

export type CakePrintKind = "print" | "reprint" | "pdf" | "test";

/** Fysisk størrelse for et bilde — fra raden, ellers fra formatet. */
export function physicalSize(
  image: CakeImage | null | undefined,
  format?: CakeImageFormat | null,
): { widthMm: number | null; heightMm: number | null; isRound: boolean } {
  if (image?.width_mm && image?.height_mm) {
    return {
      widthMm: Number(image.width_mm),
      heightMm: Number(image.height_mm),
      isRound: image.shape === "round",
    };
  }
  if (format) {
    const d = formatDims(format);
    return { widthMm: d.widthMm, heightMm: d.heightMm, isRound: d.isRound };
  }
  return { widthMm: null, heightMm: null, isRound: false };
}

export function itemToPrint(
  image: CakeImage,
  url: string,
  format?: CakeImageFormat | null,
  extra?: { productName?: string | null; cakeText?: string | null },
): CakePrintItem {
  const size = physicalSize(image, format);
  return {
    image,
    url,
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    isRound: size.isRound,
    labelNumber: image.resolved_label_number ?? resolveLabelNumber(image),
    sheet: format?.sheet ?? "A4",
    bleedMm: format?.bleed_mm ?? 0,
    productName: extra?.productName ?? null,
    cakeText: extra?.cakeText ?? null,
    orderRef: image.order_ref ?? null,
    customerName: image.customer_name ?? null,
    deliveryDate: image.delivery_date ?? null,
    title: image.title ?? null,
  };
}

/** Korreksjonsfaktoren fra kalibrering — 200 mm skal bli 200 mm på papiret. */
export function applyScale(mm: number | null | undefined, scale = 1) {
  if (mm == null) return null;
  return Math.round(mm * scale * 100) / 100;
}

/**
 * Kalibreringen korrigerer skriverens akser, ikke bildets. Når pakkeren legger
 * bildet på tvers, bytter bildets bredde og høyde plass på arket — da må
 * X-korreksjonen følge arkets bredde og Y-korreksjonen arkets høyde.
 */
export function scaledPlacementSize(
  item: { widthMm?: number | null; heightMm?: number | null },
  scale: number,
  scaleY: number,
  rotated: boolean,
): { widthMm: number; heightMm: number } {
  const w = item.widthMm ?? 0;
  const h = item.heightMm ?? 0;
  return rotated
    ? { widthMm: (applyScale(h, scale) ?? 0), heightMm: (applyScale(w, scaleY) ?? 0) }
    : { widthMm: (applyScale(w, scale) ?? 0), heightMm: (applyScale(h, scaleY) ?? 0) };
}


async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (blob.size === 0) throw new Error("Tom fil");
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Kunne ikke lese bildet"));
    r.readAsDataURL(blob);
  });
}

/**
 * Baker bildene inn som data-URL-er FØR utskriften bygges. Da finnes det
 * ingen nettverkskall igjen når PDF-en lages — hverken utløpt signert URL
 * eller kappløp mot `print()` kan gi tomme ark.
 */
async function embedCakeImages(
  items: CakePrintItem[],
): Promise<{ items: CakePrintItem[]; failed: CakePrintItem[] }> {
  const failed: CakePrintItem[] = [];
  const out = await Promise.all(
    items.map(async (item) => {
      if (!item.url) {
        failed.push(item);
        return { ...item, url: "" };
      }
      if (item.url.startsWith("data:")) return item;
      try {
        return { ...item, url: await urlToDataUrl(item.url) };
      } catch (e) {
        console.error("[cakePrint] kunne ikke hente bildet", item.url, e);
        failed.push(item);
        return { ...item, url: "" };
      }
    }),
  );
  return { items: out, failed };
}

/** Navn på et ark, til feilmeldinger. */
export function cakeItemLabel(item: CakePrintItem): string {
  return (
    item.labelNumber ??
    item.title ??
    item.orderRef ??
    item.customerName ??
    item.image?.id ??
    "ukjent bilde"
  );
}

/* ------------------------------------------------------------------ */
/* Ark, retning og bildekoding                                         */
/* ------------------------------------------------------------------ */

/** Nederste bånd på arket: linjal, instruks og bunntekst. */
const FOOT_BAND_MM = 22;
const PAGE_MARGIN_MM = 10;
/** Etikettstripe under hvert bilde: QR + nummer + kunde. */
const CAPTION_MM = 12;
const QR_MM = 10;

/**
 * Hvor bildet faktisk skal tegnes for en plassering, og hvor etikettstripa
 * havner. Pakkeren regner CAPTION_MM inn i høyden på bildet; når plasseringen
 * er rotert bytter bredde og høyde plass, og stripa havner i margen til høyre.
 */
export function placementGeometry(
  place: Placement,
  captionMm = CAPTION_MM,
): {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  rotated: boolean;
  captionXMm: number;
  captionYMm: number;
} {
  if (!place.rotated) {
    const heightMm = place.heightMm - captionMm;
    return {
      xMm: place.xMm,
      yMm: place.yMm,
      widthMm: place.widthMm,
      heightMm,
      rotated: false,
      captionXMm: place.xMm,
      captionYMm: place.yMm + heightMm + 2,
    };
  }
  const widthMm = place.widthMm - captionMm;
  return {
    xMm: place.xMm,
    yMm: place.yMm,
    widthMm,
    heightMm: place.heightMm,
    rotated: true,
    captionXMm: place.xMm + widthMm + 2,
    captionYMm: place.yMm,
  };
}

/**
 * jsPDF roterer bildet rundt nedre venstre hjørne av den uroterte boksen.
 * Her regner vi om til de argumentene som gir nøyaktig den boksen vi vil ha
 * på arket: `paperWidthMm` × `paperHeightMm` med øvre venstre hjørne i (x, y).
 */
export function rotatedImageDraw(
  xMm: number,
  yMm: number,
  paperWidthMm: number,
  paperHeightMm: number,
): { xMm: number; yMm: number; widthMm: number; heightMm: number; rotation: 90 } {
  return {
    xMm: xMm + paperWidthMm,
    yMm: yMm + paperHeightMm - paperWidthMm,
    widthMm: paperHeightMm,
    heightMm: paperWidthMm,
    rotation: 90,
  };
}

export const PRINT_INSTRUCTION =
  "Skriv ut i 100 % — ingen tilpasning til side («scale to fit» av).";

export function hasPrintableSize(item: CakePrintItem): boolean {
  return !!item.widthMm && !!item.heightMm;
}

/** Hvilket ark og hvilken retning holder for alle bildene? */
export function chooseSheet(items: CakePrintItem[]): {
  sheet: string;
  orientation: SheetOrientation;
} {
  const sized = items.filter(hasPrintableSize);
  const wanted = sized.some((i) => (i.sheet ?? "A4") === "A3") ? "A3" : "A4";
  const candidates: Array<{ sheet: string; orientation: SheetOrientation }> = [
    { sheet: wanted, orientation: "portrait" },
    { sheet: wanted, orientation: "landscape" },
    { sheet: "A3", orientation: "portrait" },
    { sheet: "A3", orientation: "landscape" },
  ];
  for (const c of candidates) {
    const size = sheetSize(c.sheet, c.orientation);
    const ok = sized.every(
      (i) =>
        fitsOnSheet(
          {
            id: i.image?.id ?? "x",
            widthMm: i.widthMm ?? 0,
            heightMm: i.heightMm ?? 0,
            bleedMm: i.bleedMm ?? 0,
            isRound: i.isRound,
          },
          size,
          PAGE_MARGIN_MM,
          FOOT_BAND_MM,
        ).fits,
    );
    if (ok) return c;
  }
  return { sheet: wanted, orientation: "portrait" };
}

/**
 * Fotolag komprimeres til JPEG (mindre PDF), men bilder med gjennomsiktighet
 * — typisk tekstlag fra editoren — må forbli PNG.
 */
export async function encodeArtwork(
  dataUrl: string,
): Promise<{ data: string; format: "JPEG" | "PNG" }> {
  if (typeof document === "undefined") return { data: dataUrl, format: "PNG" };
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Kunne ikke dekode bildet"));
      i.src = dataUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { data: dataUrl, format: "PNG" };
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = false;
    const step = Math.max(4, Math.floor(px.length / 4 / 20000) * 4);
    for (let i = 3; i < px.length; i += step) {
      if (px[i] < 250) {
        transparent = true;
        break;
      }
    }
    if (transparent) return { data: dataUrl, format: "PNG" };
    return { data: canvas.toDataURL("image/jpeg", 0.92), format: "JPEG" };
  } catch (e) {
    console.warn("[cakePrint] kunne ikke rekode bildet, bruker original", e);
    return { data: dataUrl, format: "PNG" };
  }
}

export function editorUrlFor(id: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/ordre/kakebilder/editor/${id}`;
}

async function qrDataUrl(text: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(text, { margin: 0, width: 256 });
  } catch (e) {
    console.warn("[cakePrint] kunne ikke lage QR-kode", e);
    return null;
  }
}

export type CakeSkipped = { item: CakePrintItem; reason: string };

export type CakePdfResult = {
  pdf: jsPDF;
  skipped: CakeSkipped[];
  pageCount: number;
  sheet: string;
  orientation: SheetOrientation;
};

export type CakePdfOptions = {
  scale?: number;
  scaleY?: number;
  /** Pakk flere små bilder på samme ark. Standard: på. */
  nest?: boolean;
  /** Navnet på skriveren arket ble laget for — trykkes i bunnteksten. */
  printerLabel?: string | null;
  /**
   * Hopp over bilder uten format i stedet for å skrive et varselark.
   * Standard: hopp over når det er flere enn ett bilde (bulk).
   */
  skipMissingFormat?: boolean;
};

/**
 * Bygger PDF-en som både forhåndsvisning, skriver og nedlasting bruker.
 * Millimeter hele veien, aldri punkter.
 */
export async function buildCakePdf(
  items: CakePrintItem[],
  opts: CakePdfOptions = {},
): Promise<CakePdfResult> {
  const scale = opts.scale ?? 1;
  const scaleY = opts.scaleY ?? scale;
  const skipMissing = opts.skipMissingFormat ?? items.length > 1;
  const printerLabel = opts.printerLabel ?? null;
  const skipped: CakeSkipped[] = [];

  const printable: CakePrintItem[] = [];
  const missingFormat: CakePrintItem[] = [];
  for (const item of items) {
    if (hasPrintableSize(item)) printable.push(item);
    else if (skipMissing)
      skipped.push({
        item,
        reason: "Mangler format — sett format i editoren før utskrift.",
      });
    else missingFormat.push(item);
  }

  const { sheet, orientation } = chooseSheet(printable);
  const size = sheetSize(sheet, orientation);
  const pdf = new jsPDF({
    orientation,
    unit: "mm",
    format: sheet.toLowerCase() as "a4" | "a3",
  });

  const byId = new Map<string, CakePrintItem>();
  const packItems: PackItem[] = printable.map((item, idx) => {
    const id = item.image?.id ?? `item-${idx}`;
    byId.set(id, item);
    return {
      id,
      widthMm: applyScale(item.widthMm, scale) ?? 0,
      heightMm: (applyScale(item.heightMm, scaleY) ?? 0) + CAPTION_MM,
      bleedMm: item.bleedMm ?? 0,
      isRound: item.isRound,
      rotatable: !item.isRound,
    };
  });

  const packed = opts.nest === false
    ? {
        pages: packItems.map((p) => ({
          sheet,
          orientation,
          ...size,
          placements: [
            {
              id: p.id,
              xMm: (size.widthMm - p.widthMm) / 2,
              yMm: (size.heightMm - FOOT_BAND_MM - p.heightMm) / 2,
              widthMm: p.widthMm,
              heightMm: p.heightMm,
              bleedMm: p.bleedMm ?? 0,
              rotated: false,
            },
          ],
        })),
        unplaceable: [] as PackItem[],
      }
    : packSheets(packItems, {
        sheet,
        orientation,
        marginMm: PAGE_MARGIN_MM,
        reservedBottomMm: FOOT_BAND_MM,
      });

  for (const u of packed.unplaceable) {
    const item = byId.get(u.id);
    if (!item) continue;
    skipped.push({
      item,
      reason: `Bildet (${Math.round(u.widthMm)} × ${Math.round(u.heightMm - CAPTION_MM)} mm) er større enn ${sheet}. Velg et større ark i formatet.`,
    });
  }

  let pageIndex = 0;
  const startPage = () => {
    if (pageIndex > 0) pdf.addPage(sheet.toLowerCase() as "a4" | "a3", orientation);
    pageIndex++;
  };

  for (const page of packed.pages) {
    startPage();
    for (const place of page.placements) {
      const item = byId.get(place.id);
      if (!item) continue;
      const geo = placementGeometry(place);
      const wMm = geo.widthMm;
      const hMm = geo.heightMm;
      const x = geo.xMm;
      const y = geo.yMm;

      if (item.url) {
        const src = item.url.startsWith("data:")
          ? item.url
          : await urlToDataUrl(item.url);
        const enc = await encodeArtwork(src);
        if (geo.rotated) {
          const r = rotatedImageDraw(x, y, wMm, hMm);
          pdf.addImage(
            enc.data,
            enc.format,
            r.xMm,
            r.yMm,
            r.widthMm,
            r.heightMm,
            undefined,
            "FAST",
            r.rotation,
          );
        } else {
          pdf.addImage(enc.data, enc.format, x, y, wMm, hMm, undefined, "FAST", 0);
        }
      }

      // Klippemerker rundt hvert bilde
      pdf.setLineWidth(0.2);
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as Array<[number, number]>) {
        const cx = x + wMm / 2 + (sx * wMm) / 2;
        const cy = y + hMm / 2 + (sy * hMm) / 2;
        pdf.line(cx + sx * 2, cy, cx + sx * 6, cy);
        pdf.line(cx, cy + sy * 2, cx, cy + sy * 6);
      }
      if (item.isRound) pdf.circle(x + wMm / 2, y + hMm / 2, wMm / 2);

      // Etikettstripe: QR til editoren, etikettnummer, kunde, produkt og kaketekst.
      // Roterte bilder får stripen i margen ved siden av — teksten roteres ikke med bildet.
      const capX = geo.captionXMm;
      const capY = geo.captionYMm;
      let textX = capX;
      if (item.image?.id) {
        const qr = await qrDataUrl(editorUrlFor(item.image.id));
        if (qr) {
          pdf.addImage(qr, "PNG", capX, capY, QR_MM, QR_MM);
          if (!geo.rotated) textX = capX + QR_MM + 2;
        }
      }
      if (item.labelNumber) {
        pdf.setFontSize(12);
        if (geo.rotated) pdf.text(`#${item.labelNumber}`, capX + 4, capY + QR_MM + 4);
        else pdf.text(`#${item.labelNumber}`, textX, capY + 4);
      }

      pdf.setFontSize(7);
      const line1 = [item.customerName, item.orderRef ? `Ordre ${item.orderRef}` : null]
        .filter(Boolean)
        .join(" · ");
      const line2 = [item.productName, item.cakeText ? `Tekst: ${item.cakeText}` : null]
        .filter(Boolean)
        .join(" · ");
      if (geo.rotated) {
        const txt = [line1, line2].filter(Boolean).join(" · ");
        if (txt) pdf.text(txt, capX + 4, capY + hMm - 2, { angle: 90 });
      } else {
        if (line1) pdf.text(line1, textX + (item.labelNumber ? 16 : 0), capY + 4);
        if (line2) pdf.text(line2, textX, capY + 8);
      }

    }
    drawFootBand(pdf, size, scale, scaleY, sheet, orientation, printerLabel);
  }

  // Bilder uten format: eget varselark, slik at feilen ikke går ubemerket.
  for (const item of missingFormat) {
    startPage();
    pdf.setFontSize(20);
    pdf.text("MANGLER FORMAT", size.widthMm / 2, size.heightMm / 2 - 8, {
      align: "center",
    });
    pdf.setFontSize(12);
    pdf.text("Sett format i editoren før utskrift.", size.widthMm / 2, size.heightMm / 2, {
      align: "center",
    });
    pdf.setFontSize(9);
    pdf.text(cakeItemLabel(item), size.widthMm / 2, size.heightMm / 2 + 8, {
      align: "center",
    });
    drawFootBand(pdf, size, scale, scaleY, sheet, orientation, printerLabel);
  }

  if (pageIndex === 0) {
    // jsPDF har alltid én side; gjør den tydelig tom.
    pdf.setFontSize(12);
    pdf.text("Ingen bilder kunne skrives ut.", size.widthMm / 2, 40, {
      align: "center",
    });
  }

  return { pdf, skipped, pageCount: Math.max(pageIndex, 1), sheet, orientation };
}

function drawFootBand(
  pdf: jsPDF,
  size: { widthMm: number; heightMm: number },
  scale: number,
  scaleY: number,
  sheet: string,
  orientation: SheetOrientation,
  printerLabel: string | null = null,
) {
  const rulerY = size.heightMm - 14;
  pdf.setLineWidth(0.3);
  pdf.line(PAGE_MARGIN_MM, rulerY, PAGE_MARGIN_MM + RULER_MM * scale, rulerY);
  for (let mm = 0; mm <= RULER_MM; mm += 10) {
    const x = PAGE_MARGIN_MM + mm * scale;
    pdf.line(x, rulerY, x, rulerY - (mm % 50 === 0 ? 4 : 2.5));
  }
  pdf.setFontSize(7);
  pdf.text(`${RULER_MM} mm — mål etter med linjal.`, PAGE_MARGIN_MM, rulerY - 5.5);
  pdf.text(PRINT_INSTRUCTION, PAGE_MARGIN_MM, size.heightMm - 8);
  pdf.text(
    `${sheet} ${orientation === "landscape" ? "liggende" : "stående"}` +
      (printerLabel ? ` · ${printerLabel}` : "") +
      (scale !== 1 || scaleY !== 1
        ? ` · korrigert ${Math.round(scale * 10000) / 100} % × ${Math.round(scaleY * 10000) / 100} %`
        : ""),
    size.widthMm - PAGE_MARGIN_MM,
    size.heightMm - 8,
    { align: "right" },
  );
}

/* ------------------------------------------------------------------ */
/* Utskrift og nedlasting                                              */
/* ------------------------------------------------------------------ */

async function prepareItems(
  items: CakePrintItem[],
  embed: boolean,
): Promise<CakePrintItem[]> {
  if (!embed) return items;
  const res = await embedCakeImages(items);
  if (res.failed.length > 0) {
    throw new Error(
      `Kunne ikke hente ${res.failed.length} bilde(r): ${res.failed
        .map(cakeItemLabel)
        .join(", ")}. Utskriften ble ikke startet.`,
    );
  }
  return res.items;
}

/**
 * Sender PDF-en til skriveren i samme fane, via en skjult iframe.
 * Ingen `window.open` — da kan heller ingen popup-sperre stoppe utskriften.
 */
export function printPdfInPlace(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "1px";
    frame.style.height = "1px";
    frame.style.opacity = "0";
    frame.src = url;
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch (e) {
        console.error("[cakePrint] kunne ikke åpne utskriftsdialogen", e);
      }
      resolve();
    };
    document.body.appendChild(frame);
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      frame.remove();
    }, 120_000);
  });
}

export type CakePrintJobResult = {
  skipped: CakeSkipped[];
  printedItems: CakePrintItem[];
  pageCount: number;
  sheet: string;
  orientation: SheetOrientation;
};

/**
 * Bygger arkene og åpner utskriftsdialogen. Status røres ikke — den settes
 * først når brukeren har bekreftet at arket kom riktig ut.
 */
export async function printCakeItems(
  items: CakePrintItem[],
  opts: CakePdfOptions & { embed?: boolean } = {},
): Promise<CakePrintJobResult> {
  const prepared = await prepareItems(items, opts.embed !== false);
  const res = await buildCakePdf(prepared, opts);
  const skippedIds = new Set(res.skipped.map((s) => s.item.image?.id));
  await printPdfInPlace(res.pdf.output("blob"));
  return {
    skipped: res.skipped,
    printedItems: prepared.filter((i) => !skippedIds.has(i.image?.id)),
    pageCount: res.pageCount,
    sheet: res.sheet,
    orientation: res.orientation,
  };
}

/** Laster ned arkene som PDF. */
export async function cakeSheetsToPdf(
  items: CakePrintItem[],
  opts: CakePdfOptions & { fileName?: string; embed?: boolean } = {},
): Promise<{ skipped: CakeSkipped[]; sheet: string; orientation: SheetOrientation }> {
  const prepared = await prepareItems(items, opts.embed !== false);
  const res = await buildCakePdf(prepared, opts);
  res.pdf.save(opts.fileName ?? "kakebilder.pdf");
  return { skipped: res.skipped, sheet: res.sheet, orientation: res.orientation };
}

/** Blob-URL til forhåndsvisning i iframe — samme PDF som papiret. */
export async function cakePdfPreviewUrl(
  items: CakePrintItem[],
  opts: CakePdfOptions & { embed?: boolean } = {},
): Promise<{ url: string; skipped: CakeSkipped[]; pageCount: number }> {
  const prepared = await prepareItems(items, opts.embed !== false);
  const res = await buildCakePdf(prepared, opts);
  return {
    url: URL.createObjectURL(res.pdf.output("blob")),
    skipped: res.skipped,
    pageCount: res.pageCount,
  };
}

/**
 * Testark for kalibrering: en rute med kjente mål. Måler man noe annet enn
 * 100 mm, har skriveren skalert — og da har vi en korreksjonsfaktor.
 */
export const CALIBRATION_MM = 100;

/**
 * Kalibreringsarket bygges med samme PDF-motor som ekte utskrift, i 100 %
 * uten korreksjon. Måler man arket etter en annen vei enn papiret faktisk
 * lages, måler man feil.
 */
export function buildCalibrationPdf(printerLabel?: string | null): jsPDF {
  const sheet = "A4";
  const orientation: SheetOrientation = "portrait";
  const size = sheetSize(sheet, orientation);
  const pdf = new jsPDF({ orientation, unit: "mm", format: "a4" });

  const x = (size.widthMm - CALIBRATION_MM) / 2;
  const y = 40;
  pdf.setLineWidth(0.3);
  pdf.rect(x, y, CALIBRATION_MM, CALIBRATION_MM);

  pdf.setFontSize(12);
  pdf.text(
    `Kalibrering: kvadratet skal måle ${CALIBRATION_MM} × ${CALIBRATION_MM} mm`,
    size.widthMm / 2,
    y - 8,
    { align: "center" },
  );
  pdf.setFontSize(9);
  pdf.text(
    printerLabel ? `Skriver: ${printerLabel}` : "Skriver: ikke valgt",
    size.widthMm / 2,
    y + CALIBRATION_MM + 8,
    { align: "center" },
  );
  pdf.text(
    "Mål bredde og høyde med linjal og skriv inn målene i kalibreringsdialogen.",
    size.widthMm / 2,
    y + CALIBRATION_MM + 14,
    { align: "center" },
  );

  drawFootBand(pdf, size, 1, 1, sheet, orientation, printerLabel ?? null);
  return pdf;
}

/** Skriver ut kalibreringsarket i samme fane som ekte utskrift. */
export async function printCalibrationSheet(
  printerLabel?: string | null,
): Promise<void> {
  await printPdfInPlace(buildCalibrationPdf(printerLabel).output("blob"));
}
