import { Link } from "react-router-dom";
import { ArrowRight, Boxes, FileText, Package, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { paths } from "@/ravarer/lib/paths";
import type { WorkSummary } from "@/ravarer/lib/workRpcTypes";

/** Ukjent er aldri 0: null/undefined vises som «–». */
function n(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("nb-NO") : "–";
}

export type StatusCell = { label: string; value: string; unit: string; href?: string; tone?: "warning" };

/** Statusstripen: hver teller har én kilde og sier hva den teller (fakturaer, linjer, varekort). */
export function statusCells(s: WorkSummary | null): StatusCell[] {
  if (!s) return [];
  const cells: StatusCell[] = [];
  if (s.invoice_access) {
    const inv = s.invoices;
    cells.push(
      { label: "Trenger deg", value: n(inv ? inv.open_total - inv.ready_to_reconcile : null), unit: "fakturaer", href: paths.fakturaer({ visning: "trenger" }), tone: "warning" },
      { label: "Klare", value: n(inv?.ready_to_reconcile), unit: "fakturaer", href: paths.fakturaer({ visning: "klar" }) },
      { label: "Linjer å kontrollere", value: n(s.lines_to_review), unit: "linjer", href: paths.priskontroll({ fane: "gjore" }) },
      { label: "Til godkjenning", value: n(s.approval?.ready_to_approve), unit: "fakturaer", href: paths.godkjenning() },
    );
  }
  cells.push({
    label: "Pakning mangler",
    value: n(s.data_quality ? s.data_quality.missing_package + s.data_quality.unconfirmed_package : null),
    unit: "råvarer",
    href: paths.pakninger(),
  });
  return cells;
}

export function WorkStartView({ summary, firstName }: { summary: WorkSummary | null; firstName: string | null }) {
  const cells = statusCells(summary);
  const access = summary?.invoice_access === true;
  const todo = summary?.todo_total;
  return (
    <section aria-labelledby="ravarer-start" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 id="ravarer-start" className="font-display text-2xl leading-tight">
            {firstName ? `Hei, ${firstName}` : "Råvarer"}
          </h1>
          <p className="text-body text-ink-secondary">
            {!summary ? "Henter status …" : !access ? "Du har ikke tilgang til fakturaer. Bruk snarveiene under."
              : todo == null ? "Antall oppgaver er ukjent akkurat nå." : todo === 0 ? "Ingen fakturaoppgaver venter." : `${n(todo)} oppgaver venter, eldste først.`}
          </p>
        </div>
        {access && (
          <Button asChild size="lg" className="min-h-[44px] gap-1.5">
            <Link to={paths.fakturaer({ visning: "trenger", sort: "oldest" })}>
              Start behandling<ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        )}
      </div>

      {cells.length > 0 && (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
          {cells.map((c) => (
            <div key={c.label} className="bg-card">
              <Link to={c.href ?? "#"} className="flex min-h-[44px] flex-col px-3 py-2 hover:bg-muted/50">
                <dt className="text-caption text-ink-secondary">{c.label}</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {c.value} <span className="text-caption font-normal text-ink-secondary">{c.unit}</span>
                </dd>
              </Link>
            </div>
          ))}
        </dl>
      )}

      <nav aria-label="Snarveier" className="flex flex-wrap gap-2">
        {[
          { to: paths.varer(), label: "Varer", Icon: Package },
          { to: paths.fakturaer({ visning: "alle" }), label: "Fakturaer", Icon: FileText, hide: !access },
          { to: paths.leverandorer(), label: "Leverandører", Icon: Truck },
          { to: paths.lager(), label: "Lager", Icon: Boxes },
        ].filter((x) => !x.hide).map(({ to, label, Icon }) => (
          <Button key={label} asChild variant="outline" className="min-h-[44px] gap-1.5">
            <Link to={to}><Icon className="h-4 w-4" aria-hidden />{label}</Link>
          </Button>
        ))}
      </nav>
    </section>
  );
}
