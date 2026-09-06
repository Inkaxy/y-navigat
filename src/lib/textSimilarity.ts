// Rene tekst-funksjoner for søk og fuzzy-matching.
// Brukes av Matvaretabellen-søket og forslagsrangeringen i Råvarer.
// Ingen avhengigheter — enkel å teste.

/** Fjerner diakritiske tegn og norske spesialtegn: «crème» → «creme», «søtt» → «sott». */
export function stripDiacritics(input: string): string {
  return (input ?? "")
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "AE")
    .replace(/ø/g, "o")
    .replace(/Ø/g, "O")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Små bokstaver, uten diakritika, kun bokstaver/tall, enkle mellomrom. */
export function normalizeForSearch(input: string): string {
  return stripDiacritics((input ?? "").toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s{2,}/g, " ");
}

/** Ordene i en normalisert streng. */
export function searchWords(input: string): string[] {
  const n = normalizeForSearch(input);
  return n ? n.split(" ") : [];
}

/** Trigrammer med kantpolstring, som pg_trgm. */
export function trigrams(input: string): Set<string> {
  const n = normalizeForSearch(input);
  const out = new Set<string>();
  if (!n) return out;
  for (const word of n.split(" ")) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

/** Jaccard-likhet mellom trigramsettene. 0–1. */
export function trigramSimilarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  const union = A.size + B.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Rangering av et treff i en liste:
 * 4 = identisk, 3 = starter med søket, 2 = et helt ord starter med søket,
 * 1 = delstreng, 0 = ingen treff.
 */
export function substringRank(query: string, candidate: string): 0 | 1 | 2 | 3 | 4 {
  const q = normalizeForSearch(query);
  const c = normalizeForSearch(candidate);
  if (!q || !c) return 0;
  if (q === c) return 4;
  if (c.startsWith(q)) return 3;
  if (c.split(" ").some((w) => w.startsWith(q))) return 2;
  if (c.includes(q)) return 1;
  return 0;
}

/**
 * Sorterer og filtrerer en liste etter hvor godt den treffer søket.
 * `texts` gir tekstene som skal sammenlignes (navn først, deretter synonymer).
 */
export function rankBySearch<T>(items: readonly T[], query: string, texts: (item: T) => readonly string[]): T[] {
  const q = normalizeForSearch(query);
  if (!q) return [...items];
  const scored: { item: T; rank: number; sim: number; len: number }[] = [];
  for (const item of items) {
    const values = texts(item).filter(Boolean);
    let rank = 0;
    let sim = 0;
    for (let i = 0; i < values.length; i++) {
      // Synonymer teller litt mindre enn hovednavnet.
      const penalty = i === 0 ? 0 : 0.5;
      const r = substringRank(q, values[i]) - penalty;
      if (r > rank) rank = r;
      const s = trigramSimilarity(q, values[i]) - penalty * 0.1;
      if (s > sim) sim = s;
    }
    if (rank <= 0 && sim < 0.3) continue;
    scored.push({ item, rank, sim, len: normalizeForSearch(values[0] ?? "").length });
  }
  scored.sort((a, b) => b.rank - a.rank || b.sim - a.sim || a.len - b.len);
  return scored.map((s) => s.item);
}
