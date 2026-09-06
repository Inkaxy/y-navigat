// DENNE FILEN ER BYTE-IDENTISK MED supabase/functions/_shared/allergen-labels.ts.
// Endres den ene, må den andre endres likt — en vitest sammenligner filene.
// Norske allergennavn og utheving i ingredienslisten, jf. forordning (EU) 1169/2011 art. 21:
// allergenet skal framheves i ingredienslisten — og navngis når ingrediensnavnet ikke
// selv inneholder allergenet («fløte» → «fløte (melk)»).

export const ALLERGEN_LABEL: Record<string, string> = {
  gluten_wheat: "hvete", gluten_rye: "rug", gluten_barley: "bygg", gluten_oats: "havre", gluten_spelt: "spelt",
  crustaceans: "krepsdyr", fish: "fisk", molluscs: "bløtdyr",
  eggs: "egg", milk: "melk",
  peanuts: "peanøtter", nuts_almond: "mandler", nuts_hazelnut: "hasselnøtter", nuts_walnut: "valnøtter",
  nuts_cashew: "cashewnøtter", nuts_pecan: "pekannøtter", nuts_brazil: "paranøtter",
  nuts_pistachio: "pistasjenøtter", nuts_macadamia: "macadamianøtter",
  soybeans: "soya", celery: "selleri", mustard: "sennep", sesame: "sesamfrø",
  sulphites: "svoveldioksid og sulfitt", lupin: "lupin",
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Uthever ALLE allergener i et ingrediensnavn (HTML-escapet tekst inn, HTML ut).
 * Allergener som ikke står i navnet legges til i parentes til slutt.
 */
export function highlightAllergens(html: string, allergens: readonly string[]): string {
  const labels: string[] = [];
  for (const code of allergens) {
    const label = ALLERGEN_LABEL[code];
    if (label && !labels.includes(label)) labels.push(label);
  }
  if (labels.length === 0) return html;

  let out = html;
  const missing: string[] = [];
  for (const label of labels) {
    const re = new RegExp(`(${escapeRegExp(label)})`, "i");
    const parts = out.split(/(<[^>]*>)/);
    let hit = false;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith("<")) continue;
      if (i > 0 && parts[i - 1] === "<strong>") continue;
      if (!re.test(parts[i])) continue;

      parts[i] = parts[i].replace(re, "<strong>$1</strong>");
      hit = true;
      break;
    }
    if (hit) out = parts.join("");
    else missing.push(label);
  }

  if (missing.length > 0) {
    out += ` (${missing.map((m) => `<strong>${m}</strong>`).join(", ")})`;
  }
  return out;
}
