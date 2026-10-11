import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { paths } from "@/ravarer/lib/paths";
import { WORK_KIND_LABELS, labelFor, toneStyle } from "@/ravarer/lib/labels";
import type { WorkItemsResult, WorkItem } from "@/ravarer/lib/workRpcTypes";

const PRIMARY_LABEL: Record<string, string> = {
  ukoblet: "Koble", mangler_pakning: "Sett pakning", prisavvik: "Se pris",
  kontroll: "Kontroller",
  faktura_mangler_linjer: "Åpne", faktura_sumavvik: "Åpne",
  faktura_flagget: "Åpne", faktura_klar: "Åpne",
};

function itemHref(item: WorkItem): string {
  if (item.type === "faktura" && item.invoice_id) return paths.faktura(item.invoice_id);
  return paths.priskontroll({ fane: "gjore", valgt: item.key });
}

function kr(n: number | null | undefined): string {
  if (n == null) return "—";
  return `≈ ${Math.round(n).toLocaleString("nb-NO")} kr`;
}

export type ToDoListViewProps = {
  data: WorkItemsResult | null;
  loading?: boolean;
};

export function ToDoListView({ data, loading }: ToDoListViewProps) {
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-end justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="font-display text-xl">Til deg</h2>
          <p className="text-caption text-ink-secondary">De viktigste sakene akkurat nå.</p>
        </div>
      </div>

      {loading && (
        <div className="space-y-3 p-5">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-md bg-muted/50" />)}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="flex flex-col items-center gap-2 p-10 text-center">
          <CheckCircle2 className="h-6 w-6 text-success" />
          <p className="font-medium">Ingenting venter. Bra jobba.</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <ul className="divide-y divide-border">
          {items.map((it) => {
            const meta = labelFor(WORK_KIND_LABELS, it.kind, "Oppgave");
            const sub = it.type === "varekort"
              ? `${it.supplier_name ?? "Ukjent leverandør"} · ${it.open_lines} linjer på ${it.open_invoices} fakturaer`
              : (it.reasons[0] ?? "");
            return (
              <li key={it.key}>
                <Link to={itemHref(it)} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40">
                  <span
                    aria-hidden
                    className="shrink-0 rounded-full px-2 py-0.5 text-caption font-medium"
                    style={toneStyle(meta.tokenVar)}
                  >
                    {meta.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{it.title}</div>
                    {sub && <div className="truncate text-caption text-ink-secondary">{sub}</div>}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tabular-nums text-sm">{kr(it.impact_nok)}</div>
                    <div className="text-caption text-primary">{PRIMARY_LABEL[it.kind] ?? "Åpne"} →</div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {total > items.length && (
        <div className="border-t border-border px-5 py-3 text-right">
          <Button asChild variant="ghost" size="sm">
            <Link to={paths.priskontroll({ fane: "gjore" })}>Se alle {total} i priskontroll →</Link>
          </Button>
        </div>
      )}
    </Card>
  );
}
