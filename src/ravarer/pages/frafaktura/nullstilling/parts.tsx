// Små byggeklosser for «Nullstill køen»-sidene.
import type { ReactNode } from "react";

export const fmtInt = (n: number | null | undefined, d = 0) => (n == null || !Number.isFinite(n) ? "–" : n.toLocaleString("nb-NO", { maximumFractionDigits: d, minimumFractionDigits: 0 }));
export const fmtPct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "–" : `${n > 0 ? "+" : ""}${n.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} %`);

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-[10px] border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-title font-semibold">{title}</h2>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function StatTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body">
        <thead>
          <tr className="border-b border-border text-left text-caption text-muted-foreground">
            {head.map((h, i) => <th key={h} scope="col" className={i === 0 ? "py-1.5 pr-3 font-medium" : "py-1.5 pl-3 text-right font-medium tabular-nums"}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-border/60 last:border-0">
              {r.map((c, ci) => <td key={ci} className={ci === 0 ? "py-1.5 pr-3" : "py-1.5 pl-3 text-right tabular-nums"}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
