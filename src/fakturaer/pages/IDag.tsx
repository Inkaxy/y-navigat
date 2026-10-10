import { useMemo } from "react";
import { Link } from "react-router-dom";
import { DecisionNav } from "@/fakturaer/components/decisions/DecisionNav";
import { ArrowUpRight, CheckCircle2, CircleAlert, GitBranch, Package } from "lucide-react";
import { QueryState } from "@/components/common/QueryState";
import { useReviewLines } from "@/fakturaer/hooks/useReviewLines";
import { useSupplierItems } from "@/fakturaer/hooks/useSupplierItems";
import { useCompany } from "@/hooks/useCompany";
import { buildDecisionGroups, DECISION_KIND_LABEL, encodeGroupKey, type DecisionGroup } from "@/fakturaer/lib/decisionGroups";
import { useQuery } from "@tanstack/react-query";
import { approvalBucket, fetchApprovalOverview } from "@/fakturaer/lib/approval";
import { formatMoney } from "@/fakturaer/lib/constants";
import { format } from "date-fns";
import { nb } from "date-fns/locale";

function headline(g: DecisionGroup): { title: string; body: string; foot: string } {
  const n = g.invoiceIds.length;
  const fakt = n === 1 ? "1 faktura" : `${n} fakturaer`;
  if (g.kind === "material")
    return {
      title: `Hvilken råvare er «${g.description}»?`,
      body: g.shared ? `${g.supplierName}, varenummer ${g.sku}. Samme vare og pakning.` : `${g.supplierName}. Mangler varenummer — avklares for denne linjen.`,
      foot: g.shared && n > 1 ? `Ett svar løser ${fakt}` : `Gjelder ${fakt}`,
    };
  if (g.kind === "package")
    return { title: `Bekreft pakningen for «${g.description}»`, body: `${g.supplierName}. Råvaren er kjent, pakningen er ny eller usikker.`, foot: `Gjelder ${fakt}` };
  if (g.kind === "price")
    return {
      title: n > 1 ? `Samme prisavvik. ${fakt}.` : `Prisavvik på «${g.description}»`,
      body: `${g.supplierName} har fakturert en annen pris enn referansen for ${g.description}.`,
      foot: g.differenceExclVat != null ? `${formatMoney(g.differenceExclVat, "NOK")} ekskl. mva. å avklare` : `Gjelder ${fakt}`,
    };
  if (g.kind === "first_cost")
    return { title: `Første kostpris for «${g.description}»`, body: `${g.supplierName}. Ingen avtale- eller startpris finnes; prisen er dokumentert på fakturaen.`, foot: `Gjelder ${fakt}` };
  return { title: `Kontroller «${g.description}»`, body: `${g.supplierName}. Linjen står til kontroll.`, foot: `Gjelder ${fakt}` };
}

const ICON = { material: GitBranch, package: Package, price: CircleAlert, first_cost: Package, other: CircleAlert } as const;

export default function IDag() {
  const { data: company } = useCompany();
  const q = useReviewLines({ legalEntityId: company?.id ?? null, limit: null });
  const groups = useMemo(() => buildDecisionGroups(q.data?.rows ?? []), [q.data]);
  const invoiceCount = useMemo(() => new Set((q.data?.rows ?? []).map((r) => r.invoice_id)).size, [q.data]);
  const merged = groups.reduce((s, g) => s + Math.max(0, g.lines.length - 1), 0);
  // Kort prioritert liste; hele køen ligger i Råvarer med søk og filter.
  const top = groups.slice(0, 5);
  const overview = useQuery({ queryKey: ["invoice-approval-overview", company?.id], enabled: !!company?.id, queryFn: () => fetchApprovalOverview(company!.id) });
  const readyCount = (overview.data ?? []).filter((r) => approvalBucket(r) === "ready").length;

  return (
    <div className="px-page py-6 space-y-6">
      <DecisionNav />
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} scope="fakturaer:i-dag" onRetry={() => q.refetch()} isEmpty={false}>
        <header className="space-y-2">
          <p className="text-caption uppercase tracking-wide text-ink-secondary">{format(new Date(), "EEEE d. MMMM", { locale: nb })} · din arbeidsøkt</p>
          <h1 className="font-display text-3xl font-semibold leading-tight sm:text-4xl">
            {groups.length ? "Start med de viktigste spørsmålene" : "Ingenting å avklare nå"}
          </h1>
          <p className="text-body text-ink-secondary">
            {groups.length} åpne beslutninger på {invoiceCount} {invoiceCount === 1 ? "faktura" : "fakturaer"}. Like spørsmål er samlet; ett svar gjelder alle berørte fakturaer.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <ol className="space-y-3" aria-label="Beslutninger">
            {top.length === 0 && (
              <li className="rounded-xl border border-line-subtle bg-card p-6 text-body text-ink-secondary">Ingenting å avklare nå.</li>
            )}
            {top.map((g) => {
              const h = headline(g);
              const Icon = ICON[g.kind];
              return (
                <li key={g.key}>
                  <Link
                    to={`/ravarer/fakturaer/i-dag/${encodeGroupKey(g.key)}`}
                    className="group block rounded-xl border border-line-subtle bg-card p-5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-1">
                        <p className="text-caption uppercase tracking-wide text-ink-secondary">{DECISION_KIND_LABEL[g.kind]}</p>
                        <h2 className="text-lg font-semibold">{h.title}</h2>
                        <p className="text-body text-ink-secondary">{h.body}</p>
                      </div>
                      <span className="rounded-lg bg-muted p-2" aria-hidden>
                        <Icon className="h-4 w-4 text-accent-foreground" />
                      </span>
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-line-subtle pt-3 text-sm text-primary">
                      <span>{h.foot}</span>
                      <ArrowUpRight className="h-4 w-4" aria-hidden />
                    </div>
                  </Link>
                </li>
              );
            })}
            {groups.length > top.length && (
              <li>
                <Link to="/ravarer/fakturaer/beslutninger" className="inline-flex items-center gap-1 rounded-lg border border-line-subtle px-3 py-2 text-sm text-primary hover:bg-muted/50">
                  Se alle {groups.length} beslutninger, også prisavvik <ArrowUpRight className="h-4 w-4" aria-hidden />
                </Link>
              </li>
            )}
          </ol>

          <aside className="space-y-4" aria-label="Oppsummering">
            <p className="text-caption uppercase tracking-wide text-ink-secondary">Dette er samlet for deg</p>
            <div className="flex gap-3 border-b border-line-subtle pb-4">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" aria-hidden />
              <div>
                <p className="font-medium">{merged} gjentatte linjer slått sammen</p>
                <p className="text-sm text-ink-secondary">Bare samme leverandør, varenummer og pakning samles.</p>
              </div>
            </div>
            <div className="flex gap-3 border-b border-line-subtle pb-4">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" aria-hidden />
              <div>
                <p className="font-medium">Bekreftede koblinger huskes</p>
                <p className="text-sm text-ink-secondary">Leverandørvare og bekreftet pakning brukes på nytt ved neste import.</p>
              </div>
            </div>
            <SupplierItemsCard />
            <Link to="/ravarer/fakturaer/oversikt" className="block rounded-xl border border-success/30 bg-success/10 p-4 hover:bg-success/15">
              <p className="font-semibold text-success">{overview.data ? `${readyCount} fakturaer klare til intern godkjenning` : "Fakturaoversikt"}</p>
              <p className="text-sm text-ink-secondary">Se og godkjenn. Godkjenning utløser ikke betaling.</p>
            </Link>
          </aside>
        </div>
      </QueryState>
    </div>
  );
}

function SupplierItemsCard() {
  const c = useSupplierItems({ supplierId: null, search: "", status: null, page: 1, pageSize: 1 }).data?.counts;
  if (!c || c.ukoblet + c.mangler_pakning === 0) return null;
  return (
    <Link to="/ravarer/fakturaer/varekoblinger?status=ukoblet" className="block rounded-xl border border-warning/30 bg-warning/10 p-4 hover:bg-warning/15">
      <p className="font-semibold">Varekort som trenger deg: {c.ukoblet} ukoblet · {c.mangler_pakning} mangler pakning</p>
      <p className="text-sm text-ink-secondary">Én beslutning per leverandørvare gjelder alle fakturaer.</p>
    </Link>
  );
}
