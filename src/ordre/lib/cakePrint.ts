/**
 * Én felles utskriftsvei for kakebilder.
 *
 * Alt som skal på papir går herfra — utskriftsruta, editorens «Skriv ut»,
 * PDF-nedlasting og kalibrerings-testarket. Bildet plasseres i en boks med
 * eksakte millimeterverdier, sentrert på A4, uten skalering av noe slag.
 * Ingen max-width, ingen object-fit: contain.
 */
import jsPDF from "jspdf";
import type { CakeImage } from "@/ordre/lib/cakeImages";
import type { CakeImageFormat } from "@/ordre/lib/cakeFormats";
import { formatDims } from "@/ordre/lib/cakeFormats";

export const A4 = { widthMm: 210, heightMm: 297 };
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
): CakePrintItem {
  const size = physicalSize(image, format);
  return {
    image,
    url,
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    isRound: size.isRound,
    labelNumber: image.label_number ?? null,
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

export const CAKE_PRINT_CSS = `
  @page { size: A4 portrait; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .cake-sheet {
    position: relative;
    width: 210mm;
    height: 297mm;
    margin: 0 auto;
    background: #fff;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
    box-sizing: border-box;
    font-family: Inter, Arial, sans-serif;
    color: #000;
  }
  .cake-sheet:last-child { page-break-after: auto; break-after: auto; }
  .cake-artwork {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: block;
  }
  .cake-artwork { overflow: hidden; }
  .cake-artwork img { display: block; width: 100%; height: 100%; }
  .cake-missing {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    font-size: 8mm;
    font-weight: 800;
    color: #000;
    text-align: center;
    border: 1mm solid #000;
    padding: 6mm 8mm;
    max-width: 170mm;
  }
  .cake-round-guide {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    border: 0.2mm solid #999;
    border-radius: 50%;
    pointer-events: none;
  }
  .cake-crop { position: absolute; }
  .cake-crop span { position: absolute; background: #000; }
  .cake-label {
    position: absolute;
    top: 6mm;
    left: 8mm;
    font-size: 16mm;
    line-height: 1;
    font-weight: 800;
    font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
    letter-spacing: -0.02em;
  }
  .cake-label small { display: block; font-size: 3mm; font-weight: 600; letter-spacing: 0.12em; }
  .cake-foot {
    position: absolute;
    left: 8mm;
    right: 8mm;
    bottom: 5mm;
    font-size: 3mm;
    line-height: 1.4;
    display: flex;
    justify-content: space-between;
    gap: 4mm;
  }
  .cake-ruler { position: absolute; left: 8mm; bottom: 12mm; height: 6mm; }
  .cake-ruler .bar { position: absolute; left: 0; bottom: 0; height: 0.4mm; background: #000; }
  .cake-ruler .tick { position: absolute; bottom: 0; width: 0.3mm; background: #000; }
  .cake-ruler .cap { position: absolute; bottom: 6.5mm; font-size: 2.6mm; }
  .cake-warn { position: absolute; top: 6mm; right: 8mm; font-size: 3mm; color: #b45309; max-width: 80mm; text-align: right; }
`;

function el(doc: Document, tag: string, cls?: string, text?: string) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Klippemerker i hjørnene av bildeflaten. */
function addCropMarks(
  doc: Document,
  sheet: HTMLElement,
  wMm: number,
  hMm: number,
) {
  const len = 5; // mm
  const gap = 2; // mm
  const corners: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  for (const [sx, sy] of corners) {
    const x = A4.widthMm / 2 + (sx * wMm) / 2;
    const y = A4.heightMm / 2 + (sy * hMm) / 2;
    const holder = el(doc, "div", "cake-crop");
    holder.style.left = `${x}mm`;
    holder.style.top = `${y}mm`;
    // vannrett merke
    const h = el(doc, "span");
    h.style.height = "0.3mm";
    h.style.width = `${len}mm`;
    h.style.top = "0";
    h.style.left = sx < 0 ? `${-(gap + len)}mm` : `${gap}mm`;
    // loddrett merke
    const v = el(doc, "span");
    v.style.width = "0.3mm";
    v.style.height = `${len}mm`;
    v.style.left = "0";
    v.style.top = sy < 0 ? `${-(gap + len)}mm` : `${gap}mm`;
    holder.appendChild(h);
    holder.appendChild(v);
    sheet.appendChild(holder);
  }
}

function addRuler(doc: Document, sheet: HTMLElement, scale: number) {
  const ruler = el(doc, "div", "cake-ruler");
  ruler.style.width = `${RULER_MM * scale}mm`;
  const bar = el(doc, "div", "bar");
  bar.style.width = `${RULER_MM * scale}mm`;
  ruler.appendChild(bar);
  for (let mm = 0; mm <= RULER_MM; mm += 10) {
    const t = el(doc, "div", "tick");
    t.style.left = `${mm * scale}mm`;
    t.style.height = mm % 50 === 0 ? "4mm" : "2.5mm";
    ruler.appendChild(t);
  }
  const cap = el(
    doc,
    "div",
    "cap",
    `${RULER_MM} mm — mål etter med linjal. Stemmer den ikke, har skriveren skalert.`,
  );
  ruler.appendChild(cap);
  sheet.appendChild(ruler);
}

/**
 * Bygger ett A4-ark for ett kakebilde. DOM-API, aldri string-interpolering av
 * brukerdata.
 */
export function buildCakeSheet(
  doc: Document,
  item: CakePrintItem,
  scale = 1,
  scaleY = scale,
): HTMLElement {
  const sheet = el(doc, "div", "cake-sheet");

  const wMm = applyScale(item.widthMm, scale);
  const hMm = applyScale(item.heightMm, scaleY);
  const known = !!wMm && !!hMm;

  const art = el(doc, "div", "cake-artwork");
  if (known) {
    art.style.width = `${wMm}mm`;
    art.style.height = `${hMm}mm`;
  } else {
    // Ukjent fysisk størrelse — vi sier fra i stedet for å strekke i stillhet.
    art.style.width = "150mm";
    art.style.height = "150mm";
  }
  if (item.isRound) art.style.borderRadius = "50%";
  if (item.url) {
    const img = doc.createElement("img");
    img.src = item.url;
    img.alt = item.title ?? "Kakebilde";
    art.appendChild(img);
  }
  sheet.appendChild(art);

  if (known) {
    addCropMarks(doc, sheet, wMm!, hMm!);
    if (item.isRound) {
      const guide = el(doc, "div", "cake-round-guide");
      guide.style.width = `${wMm}mm`;
      guide.style.height = `${hMm}mm`;
      sheet.appendChild(guide);
    }
  } else {
    const warn = el(
      doc,
      "div",
      "cake-warn",
      "Bildet mangler fysisk størrelse — velg format i editoren før utskrift.",
    );
    sheet.appendChild(warn);
  }

  if (item.labelNumber) {
    const label = el(doc, "div", "cake-label");
    label.appendChild(el(doc, "small", undefined, "ETIKETT"));
    label.appendChild(doc.createTextNode(`#${item.labelNumber}`));
    sheet.appendChild(label);
  }

  addRuler(doc, sheet, scale);

  const foot = el(doc, "div", "cake-foot");
  const left = el(doc, "div");
  left.appendChild(
    el(
      doc,
      "div",
      undefined,
      [item.orderRef ? `Ordre ${item.orderRef}` : "Uten ordre", item.customerName ?? ""]
        .filter(Boolean)
        .join(" · "),
    ),
  );
  left.appendChild(
    el(doc, "div", undefined, item.deliveryDate ? `Hentedato ${item.deliveryDate}` : ""),
  );
  const right = el(
    doc,
    "div",
    undefined,
    known
      ? `${Math.round(item.widthMm!)} × ${Math.round(item.heightMm!)} mm${
          scale !== 1 || scaleY !== 1
            ? ` · korrigert ${Math.round(scale * 10000) / 100} % × ${Math.round(scaleY * 10000) / 100} %`
            : ""
        }`
      : "Ukjent størrelse",
  );
  foot.appendChild(left);
  foot.appendChild(right);
  sheet.appendChild(foot);

  return sheet;
}

/** Åpner et utskriftsvindu med arkene og kaller `onPrinted` etter faktisk utskrift. */
export async function openCakePrintWindow(
  items: CakePrintItem[],
  opts: { scale?: number; scaleY?: number; onPrinted?: () => void; title?: string } = {},
): Promise<void> {
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) {
    throw new Error("Nettleseren blokkerte utskriftsvinduet");
  }
  const doc = w.document;
  doc.title = opts.title ?? "Kakebilder";
  const style = doc.createElement("style");
  style.textContent = CAKE_PRINT_CSS;
  doc.head.appendChild(style);
  for (const item of items) {
    doc.body.appendChild(
      buildCakeSheet(doc, item, opts.scale ?? 1, opts.scaleY ?? opts.scale ?? 1),
    );
  }

  // Vent til alle bildene er lastet — ellers printes tomme sider.
  const imgs = Array.from(doc.images);
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) return resolve();
          img.onload = () => resolve();
          img.onerror = () => resolve();
        }),
    ),
  );

  // Avbrutt dialog skal ikke registreres — derfor onafterprint, ikke et løfte.
  if (opts.onPrinted) {
    w.onafterprint = () => opts.onPrinted?.();
  }
  w.focus();
  w.print();
}

async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.readAsDataURL(blob);
  });
}

/** Samme ark som på papir, men som PDF. Millimeter, ikke punkter. */
export async function cakeSheetsToPdf(
  items: CakePrintItem[],
  opts: { scale?: number; scaleY?: number; fileName?: string } = {},
): Promise<void> {
  const scale = opts.scale ?? 1;
  const scaleY = opts.scaleY ?? scale;
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  for (let i = 0; i < items.length; i++) {
    if (i > 0) pdf.addPage();
    const item = items[i];
    const wMm = applyScale(item.widthMm, scale) ?? 150;
    const hMm = applyScale(item.heightMm, scaleY) ?? 150;
    if (item.url) {
      const dataUrl = item.url.startsWith("data:")
        ? item.url
        : await urlToDataUrl(item.url);
      pdf.addImage(
        dataUrl,
        "PNG",
        (A4.widthMm - wMm) / 2,
        (A4.heightMm - hMm) / 2,
        wMm,
        hMm,
      );
    }

    // Klippemerker
    pdf.setLineWidth(0.2);
    const cx = A4.widthMm / 2;
    const cy = A4.heightMm / 2;
    const corners: Array<[number, number]> = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    for (const [sx, sy] of corners) {
      const x = cx + (sx * wMm) / 2;
      const y = cy + (sy * hMm) / 2;
      pdf.line(x + sx * 2, y, x + sx * 7, y);
      pdf.line(x, y + sy * 2, x, y + sy * 7);
    }
    if (item.isRound) {
      pdf.circle(cx, cy, wMm / 2);
    }

    // Etikettnummer i margen
    if (item.labelNumber) {
      pdf.setFontSize(8);
      pdf.text("ETIKETT", 8, 10);
      pdf.setFontSize(38);
      pdf.text(`#${item.labelNumber}`, 8, 24);
    }

    // Millimeterskala
    const rulerY = A4.heightMm - 16;
    pdf.setLineWidth(0.3);
    pdf.line(8, rulerY, 8 + RULER_MM * scale, rulerY);
    for (let mm = 0; mm <= RULER_MM; mm += 10) {
      const x = 8 + mm * scale;
      pdf.line(x, rulerY, x, rulerY - (mm % 50 === 0 ? 4 : 2.5));
    }
    pdf.setFontSize(7);
    pdf.text(
      `${RULER_MM} mm — mål etter med linjal. Stemmer den ikke, har skriveren skalert.`,
      8,
      rulerY - 5.5,
    );

    // Bunntekst
    pdf.setFontSize(8);
    pdf.text(
      [item.orderRef ? `Ordre ${item.orderRef}` : "Uten ordre", item.customerName ?? ""]
        .filter(Boolean)
        .join(" · "),
      8,
      A4.heightMm - 8,
    );
    pdf.text(
      `${Math.round(item.widthMm ?? 0)} × ${Math.round(item.heightMm ?? 0)} mm${
        item.deliveryDate ? ` · ${item.deliveryDate}` : ""
      }`,
      A4.widthMm - 8,
      A4.heightMm - 8,
      { align: "right" },
    );
  }
  pdf.save(opts.fileName ?? "kakebilder.pdf");
}

/**
 * Testark for kalibrering: en rute med kjente mål. Måler man noe annet enn
 * 100 mm, har skriveren skalert — og da har vi en korreksjonsfaktor.
 */
export const CALIBRATION_MM = 100;

export function calibrationSheetHtml(doc: Document): HTMLElement {
  const sheet = el(doc, "div", "cake-sheet");
  const box = el(doc, "div", "cake-artwork");
  box.style.width = `${CALIBRATION_MM}mm`;
  box.style.height = `${CALIBRATION_MM}mm`;
  box.style.border = "0.3mm solid #000";
  sheet.appendChild(box);

  const t = el(
    doc,
    "div",
    "cake-label",
    "",
  );
  t.style.fontSize = "6mm";
  t.textContent = `Kalibrering: kvadratet skal måle ${CALIBRATION_MM} × ${CALIBRATION_MM} mm`;
  sheet.appendChild(t);
  addRuler(doc, sheet, 1);
  return sheet;
}
