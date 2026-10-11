/** Leverandørsaker: summer og hurtigfiltre. Rene funksjoner (testes). */

export const SAK_FILTRE = ["apne", "oppfolging", "lost", "avbrutt", "alle"] as const;
export type SakFilter = (typeof SAK_FILTRE)[number];

export const SAK_FILTER_LABEL: Record<SakFilter, string> = {
  apne: "Åpne",
  oppfolging: "Til oppfølging",
  lost: "Løst",
  avbrutt: "Avbrutt",
  alle: "Alle",
};

export function parseSakFilter(v: string | null): SakFilter {
  return v && (SAK_FILTRE as readonly string[]).includes(v) ? (v as SakFilter) : "apne";
}

export type CaseSums = { krav: number; kreditert: number; gjenstar: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Krav = sum merkostnad på sakslinjene; kreditert = sum fordelt kreditt; gjenstår = krav − kreditert. */
export function caseSums(
  lines: ReadonlyArray<{ case_id: string; amount_excl_vat: number | string }>,
  credits: ReadonlyArray<{ case_id: string; amount_excl_vat: number | string }>,
): Map<string, CaseSums> {
  const m = new Map<string, CaseSums>();
  const get = (id: string) => m.get(id) ?? { krav: 0, kreditert: 0, gjenstar: 0 };
  for (const l of lines) { const s = get(l.case_id); s.krav += Number(l.amount_excl_vat); m.set(l.case_id, s); }
  for (const c of credits) { const s = get(c.case_id); s.kreditert += Number(c.amount_excl_vat); m.set(c.case_id, s); }
  for (const [k, s] of m) m.set(k, { krav: r2(s.krav), kreditert: r2(s.kreditert), gjenstar: r2(s.krav - s.kreditert) });
  return m;
}

export function isFollowUpDue(c: { status: string; follow_up_on: string | null }, today: string): boolean {
  return c.status === "open" && !!c.follow_up_on && c.follow_up_on.slice(0, 10) < today;
}

export function matchesSakFilter(c: { status: string; follow_up_on: string | null }, f: SakFilter, today: string): boolean {
  if (f === "alle") return true;
  if (f === "apne") return c.status === "open";
  if (f === "oppfolging") return isFollowUpDue(c, today);
  if (f === "lost") return c.status === "resolved";
  return c.status === "cancelled";
}

export function countSaker(rows: ReadonlyArray<{ status: string; follow_up_on: string | null }>, today: string): Record<SakFilter, number> {
  const out: Record<SakFilter, number> = { apne: 0, oppfolging: 0, lost: 0, avbrutt: 0, alle: 0 };
  for (const r of rows) for (const f of SAK_FILTRE) if (matchesSakFilter(r, f, today)) out[f]++;
  return out;
}

export const SAKER_EMPTY_TEXT = "Saker opprettes fra varekortet («Krev kreditt»), fra en flagget faktura eller fra en prisavviklinje.";
