// Kjente faktureringsgrupper og visningsrekkefølge for Fakturakjøring-siden.

export interface GroupDef {
  key: string;
  code: string;
  label: string;
}

export const KNOWN_GROUPS: GroupDef[] = [
  { key: "cash", code: "0", label: "Kontant" },
  { key: "weekly", code: "1", label: "Ukentlig" },
  { key: "biweekly", code: "2", label: "14-daglig" },
  { key: "monthly", code: "3", label: "Månedlig" },
  { key: "internal_outlets", code: "4", label: "Egne utsalg" },
  { key: "test", code: "5", label: "Test" },
];

export function groupDefFor(key: string | null | undefined): GroupDef {
  if (!key) return { key: "__none", code: "?", label: "Uten gruppe" };
  const match = KNOWN_GROUPS.find((g) => g.key === key);
  if (match) return match;
  // Ukjent gruppe — vis nøkkelen selv med tydelig prefix
  return { key, code: "?", label: `Ukjent: ${key}` };
}

export function isKnownGroup(key: string | null | undefined): boolean {
  return !!key && KNOWN_GROUPS.some((g) => g.key === key);
}

export function formatKr(n: number): string {
  return new Intl.NumberFormat("nb-NO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n) + " kr";
}
