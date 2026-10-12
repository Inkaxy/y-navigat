import { formatMachineNumbersNb } from "@/fakturaer/lib/sumDirection";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Issue, Value } from "@/fakturaer/lib/reread";

const PRICE_BASIS: Record<string, string> = { mengdeenhet: "per fakturert enhet", pakning: "per pakning", stk: "per stk", kg: "per kg", g: "per g", l: "per liter", ml: "per ml" };

/** Visning av én verdi: tall med norsk format og signert fortegn som på dokumentet. */
export function showValue(v: Value, field?: string): string {
  if (v == null || v === "") return "–";
  if (typeof v === "number") return v.toLocaleString("nb-NO", { maximumFractionDigits: 4 });
  if (field === "unit_price_basis") return PRICE_BASIS[v] ?? v;
  return v;
}

export function IssueList({ title, issues, className }: { title: string; issues: Issue[]; className?: string }) {
  if (issues.length === 0) return null;
  return (
    <div className={cn("rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm", className)}>
      <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" aria-hidden />{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">{issues.map((i, n) => <li key={`${i.code}-${n}`}>{formatMachineNumbersNb(i.message)}</li>)}</ul>
    </div>
  );
}

/** Rå AI-score er sekundær og vises aldri som «sikker». */
export function RawScore({ value }: { value: number | null }) {
  return <span className="text-caption text-ink-secondary">[leserens egen score: {value == null ? "ukjent" : `${Math.round(value * 100)} %`}]</span>;
}

/** ISO-dato (ÅÅÅÅ-MM-DD…) vist som norsk dato; verdien beholdes uendret internt. */
export function showDate(v: Value): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(`${v.slice(0, 10)}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });
  }
  return showValue(v);
}
