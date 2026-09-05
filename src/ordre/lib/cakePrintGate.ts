import type { CakeImage } from "@/ordre/lib/cakeImages";

/** Det som må være på plass før et kakebilde kan skrives ut eller markeres ferdig. */
export type PrintGateResult = { ok: true } | { ok: false; reason: string };

/** Minste sett med felter sperren trenger — gjør funksjonen lett å teste. */
export type PrintGateInput = Pick<
  CakeImage,
  | "format_id"
  | "width_mm"
  | "height_mm"
  | "quality_flag"
  | "quality_ack_at"
  | "rights_cleared"
  | "rights_note"
>;

/**
 * Samme regler som editoren håndhever ved «Marker ferdig»:
 * format satt, lav oppløsning bekreftet og rettigheter avklart.
 * Ren funksjon uten nettverk, slik at bulk og editor svarer likt.
 */
export function evaluatePrintGate(image: PrintGateInput): PrintGateResult {
  const hasFormat =
    !!image.format_id ||
    (!!image.width_mm && !!image.height_mm && image.width_mm > 0 && image.height_mm > 0);
  if (!hasFormat) {
    return {
      ok: false,
      reason: "Mangler format — sett format i editoren.",
    };
  }
  if (image.quality_flag === "lav" && !image.quality_ack_at) {
    return {
      ok: false,
      reason: "Lav oppløsning er ikke bekreftet i editoren.",
    };
  }
  const rightsAnswered =
    image.rights_cleared === true || !!(image.rights_note ?? "").trim();
  if (!rightsAnswered) {
    return {
      ok: false,
      reason: "Rettighetene er ikke avklart.",
    };
  }
  return { ok: true };
}
