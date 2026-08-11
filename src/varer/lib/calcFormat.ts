/** Norsk tallformatering for kalkylen. All regning skjer i databasen. */

export function nNum(n: number | null | undefined, decimals = 2): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("nb-NO", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Kronebeløp, f.eks. «12,45 kr». */
export function nKr(n: number | null | undefined, decimals = 2): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${nNum(n, decimals)} kr`;
}

/** Prosent der verdien allerede er 0–100, f.eks. «65,0 %». */
export function nPct(n: number | null | undefined, decimals = 1): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${nNum(n, decimals)} %`;
}

/** Gram med tusenskille. */
export function nG(n: number | null | undefined, decimals = 0): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${nNum(n, decimals)} g`;
}

/** Parser norsk eller engelsk desimaltall fra et inputfelt. */
export function parseNum(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
