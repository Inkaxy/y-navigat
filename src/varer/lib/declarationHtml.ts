/**
 * SANITERING AV MANUELL DEKLARASJONSTEKST
 * ---------------------------------------------------------------------------
 * `resolve_label_data` trykker teksten ordrett på etiketten. Derfor slipper vi
 * bare gjennom uthevingen som allergenregelverket krever (<strong>) — alt annet
 * markup, og all script/style, fjernes før lagring.
 */

const ALLOWED_TAG = /^<\/?strong>$/i;

/** Beholder bare <strong>-tagger; <b> normaliseres til <strong>. */
export function sanitizeDeclarationHtml(input: string | null | undefined): string {
  if (!input) return "";
  let text = String(input);
  // Fjern hele script-/style-blokker inkludert innhold.
  text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  text = text.replace(/<\/?(b|em|i)\s*>/gi, (m) => (m.startsWith("</") ? "</strong>" : "<strong>"));
  text = text.replace(/<br\s*\/?>/gi, " ");
  text = text.replace(/<\/?p[^>]*>/gi, " ");
  text = text.replace(/<[^>]*>/g, (tag) => (ALLOWED_TAG.test(tag) ? tag.toLowerCase() : ""));
  text = text.replace(/&nbsp;/gi, " ");
  // Rydd tomme og uparede uthevinger.
  text = text.replace(/<strong>\s*<\/strong>/gi, "");
  const open = (text.match(/<strong>/g) ?? []).length;
  const close = (text.match(/<\/strong>/g) ?? []).length;
  if (open > close) text += "</strong>".repeat(open - close);
  if (close > open) text = "<strong>".repeat(close - open) + text;
  return text.replace(/\s+/g, " ").trim();
}
