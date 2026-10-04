import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueryState } from "@/components/common/QueryState";
import { DecisionNav } from "@/fakturaer/components/decisions/DecisionNav";
import { useReviewLines } from "@/fakturaer/hooks/useReviewLines";
import { useCompany } from "@/hooks/useCompany";
import { buildDecisionGroups, DECISION_KIND_LABEL, encodeGroupKey, RAVARE_KINDS } from "@/fakturaer/lib/decisionGroups";
import { filterRavarerGroups, filtersFor, paginate, parseRavarerFilter, RAVARER_PAGE_SIZE, type QueueScope } from "@/fakturaer/lib/ravarerQueueFilter";
import { cn } from "@/lib/utils";

export default function RavarerQueue({ scope = "ravarer" }: { scope?: QueueScope }) {
  const { data: company } = useCompany();
  // limit: null henter hele køen side for side — ingen skjult grense.
  const q = useReviewLines({ legalEntityId: company?.id ?? null, limit: null });
  const [sp, setSp] = useSearchParams();
  const f = parseRavarerFilter(sp, scope);
  const all = useMemo(() => buildDecisionGroups(q.data?.rows ?? []).filter((g) => scope === "alle" || RAVARE_KINDS.has(g.kind)), [q.data, scope]);
  const suppliers = useMemo(() => [...new Map(all.map((g) => [g.supplierId, g.supplierName])).entries()].sort((a, b) => a[1].localeCompare(b[1], "nb")), [all]);
  const filtered = useMemo(() => filterRavarerGroups(all, f, scope), [scope, all, f.kind, f.search, f.supplierId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pg = paginate(filtered, f.page, RAVARER_PAGE_SIZE);

  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    if (k !== "side") n.delete("side");
    setSp(n, { replace: true });
  };
  const detailHref = (key: string) => `/ravarer/fakturaer/i-dag/${encodeGroupKey(key)}?fra=${scope}${sp.toString() ? `&${sp.toString()}` : ""}`;

  return (
    <div className="px-page py-6 space-y-5">
      <DecisionNav />
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-semibold">{scope === "alle" ? "Alle beslutninger" : "Råvarer og kostpris"}</h1>
        <p className="text-ink-secondary">{scope === "alle" ? "Alle åpne spørsmål, også prisavvik. Like linjer er samlet til ett spørsmål." : "Like linjer med samme leverandør, varenummer og pakning er samlet til ett spørsmål."} Valgene godkjenner ikke fakturaer.</p>
      </header>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-ink-secondary" aria-hidden />
            <Input aria-label="Søk på varenavn, varenummer eller leverandør" className="pl-8" placeholder="Søk på vare, varenummer eller leverandør" value={f.search} onChange={(e) => set("q", e.target.value)} />
          </div>
          <select aria-label="Leverandør" className="h-10 rounded-md border border-input bg-background px-2 text-sm" value={f.supplierId} onChange={(e) => set("leverandor", e.target.value)}>
            <option value="">Alle leverandører</option>
            {suppliers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <div role="tablist" aria-label="Type spørsmål" className="flex gap-1 overflow-x-auto">
          {filtersFor(scope).map((t) => (
            <button key={t.key} role="tab" type="button" aria-selected={f.kind === t.key} onClick={() => set("type", t.key === "alle" ? "" : t.key)}
              className={cn("rounded-md px-3 py-1.5 text-sm whitespace-nowrap", f.kind === t.key ? "bg-primary/10 font-medium text-primary" : "text-ink-secondary hover:bg-muted")}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} scope="fakturaer:ravarer" onRetry={() => q.refetch()}
        isEmpty={filtered.length === 0} emptyTitle={all.length ? "Ingen spørsmål passer filteret" : (scope === "alle" ? "Ingen beslutninger nå" : "Ingen råvarespørsmål nå")}>
        <p className="text-sm text-ink-secondary" aria-live="polite">
          {filtered.length} {filtered.length === 1 ? "spørsmål" : "spørsmål"}{filtered.length !== all.length && ` av ${all.length}`} · viser {(pg.page - 1) * RAVARER_PAGE_SIZE + 1}–{(pg.page - 1) * RAVARER_PAGE_SIZE + pg.items.length}
        </p>
        <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle bg-card">
          {pg.items.map((g) => (
            <li key={g.key}>
              <Link to={detailHref(g.key)} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{g.description}</p>
                  <p className="truncate text-sm text-ink-secondary">{g.supplierName}{g.sku ? ` · nr. ${g.sku}` : " · uten varenummer"}</p>
                </div>
                <div className="shrink-0 text-right text-sm">
                  <p className="text-primary">{DECISION_KIND_LABEL[g.kind]}</p>
                  <p className="text-ink-secondary">{g.invoiceIds.length === 1 ? "1 faktura" : `${g.invoiceIds.length} fakturaer`}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {pg.pages > 1 && (
          <nav aria-label="Sider" className="flex items-center justify-between text-sm">
            <Button variant="outline" size="sm" disabled={pg.page <= 1} onClick={() => set("side", String(pg.page - 1))}><ChevronLeft className="mr-1 h-4 w-4" aria-hidden />Forrige</Button>
            <span className="tabular-nums text-ink-secondary">Side {pg.page} av {pg.pages}</span>
            <Button variant="outline" size="sm" disabled={pg.page >= pg.pages} onClick={() => set("side", String(pg.page + 1))}>Neste<ChevronRight className="ml-1 h-4 w-4" aria-hidden /></Button>
          </nav>
        )}
      </QueryState>
    </div>
  );
}
