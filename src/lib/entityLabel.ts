export type EntityLike = {
  display_name?: string | null;
  legal_name?: string | null;
  short_code?: string | null;
};

/** Foretrukket visningsnavn: display_name → legal_name → short_code → "" */
export function entityLabel(e: EntityLike | null | undefined): string {
  if (!e) return "";
  const d = e.display_name?.trim();
  if (d) return d;
  const l = e.legal_name?.trim();
  if (l) return l;
  return e.short_code?.trim() ?? "";
}

/** Strips trailing " AS"/" ASA"/" AB" og uppercases — for brand-label i topbar. */
export function brandLabel(name: string): string {
  return name.replace(/\s+(AS|ASA|AB|SA|BV)\s*$/i, "").toUpperCase();
}
