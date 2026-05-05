/**
 * Hjelpe-funksjoner for priser og avrunding.
 */

export type RoundTo = 0 | 0.5 | 1 | 5 | 10;

export const ROUND_OPTIONS: { value: RoundTo; label: string }[] = [
  { value: 0, label: "Ingen" },
  { value: 0.5, label: "0,50" },
  { value: 1, label: "1" },
  { value: 5, label: "5" },
  { value: 10, label: "10" },
];

export function roundPrice(value: number, step: RoundTo): number {
  if (!step) return Math.round(value * 100) / 100;
  return Math.round(value / step) * step;
}

export type AdjustOp = "increase_pct" | "decrease_pct" | "set";

export function applyAdjustment(
  current: number | null,
  op: AdjustOp,
  amount: number,
  round: RoundTo,
): number | null {
  let next: number;
  if (op === "set") {
    next = amount;
  } else {
    if (current == null) return null;
    const factor = op === "increase_pct" ? 1 + amount / 100 : 1 - amount / 100;
    next = current * factor;
  }
  return roundPrice(next, round);
}

export function formatKr(v: number | null | undefined): string {
  if (v == null || isNaN(Number(v))) return "—";
  return Number(v).toFixed(2).replace(".", ",");
}

export function toCsv(rows: (string | number | null)[][]): string {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          if (cell == null) return "";
          const s = String(cell);
          if (s.includes(",") || s.includes('"') || s.includes("\n")) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(","),
    )
    .join("\n");
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
