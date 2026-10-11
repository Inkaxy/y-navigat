import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/ordre/components/ui/status-pill";
import { useCompany } from "@/hooks/useCompany";
import { useDebouncedValue } from "@/kunder/hooks/useDebouncedValue";
import { formatDate, formatMoney, todayIso } from "@/fakturaer/lib/constants";
import { useUserNames } from "@/ravarer/hooks/useUserNames";
import { labelFor, SUPPLIER_CASE_STATUS_LABELS } from "@/ravarer/lib/labels";
import { paths } from "@/ravarer/lib/paths";
import { DataTable, type Column } from "@/ravarer/ui/DataTable";
import { FilterChips } from "@/ravarer/ui/FilterChips";
import { PeekPanel, SplitView } from "@/ravarer/ui/SplitView";
import { useIsWide } from "@/ravarer/pages/priskontroll/faktura/useIsWide";
import { cn } from "@/lib/utils";
import { countSaker, isFollowUpDue, matchesSakFilter, parseSakFilter, SAK_FILTER_LABEL, SAK_FILTRE, SAKER_EMPTY_TEXT, type SakFilter } from "./caseLogic";
import { SupplierCaseDetail } from "./SupplierCaseDetail";
import { useSupplierCaseList, type CaseListRow } from "./useSupplierCases";

const kr = (v: number) => formatMoney(v, "NOK");

/** Leverandørsaker: liste med hurtigfiltre og saksdetalj i panel (bred skjerm) eller egen side. */
export function SakerTab() {
  const [sp, setSp] = useSearchParams();
  const wide = useIsWide();
  const { data: company } = useCompany();
  const list = useSupplierCaseList(company?.id ?? null);
  const filter = parseSakFilter(sp.get("status"));
  const leverandor = sp.get("leverandor");
  const valgt = sp.get("sak");
  const [q, setQ] = useState(sp.get("q") ?? "");
  const debounced = useDebouncedValue(q, 300);
  const today = todayIso();

  const update = (next: Record<string, string | null>) => setSp((prev) => {
    const p = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(next)) { if (v) p.set(k, v); else p.delete(k); }
    return p;
  }, { replace: true });
  useEffect(() => {
    if (debounced !== (sp.get("q") ?? "")) update({ q: debounced || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const counts = useMemo(() => countSaker(rows, today), [rows, today]);
  const suppliers = useMemo(() => [...new Map(rows.map((r) => [r.supplier_id, r.supplier_name ?? "Ukjent"])).entries()].sort((a, b) => a[1].localeCompare(b[1], "nb")), [rows]);
  const s = (sp.get("q") ?? "").trim().toLowerCase();
  const visible = rows.filter((r) => matchesSakFilter(r, filter, today) && (!leverandor || r.supplier_id === leverandor)
    && (!s || r.title.toLowerCase().includes(s) || (r.supplier_name ?? "").toLowerCase().includes(s)));
  const names = useUserNames(visible.map((r) => r.responsible_user_id));

  const columns: Column<CaseListRow>[] = [
    { id: "tittel", header: "Tittel", cell: (r) => <span className="font-medium">{r.title}</span>, sortKey: (r) => r.title },
    { id: "lev", header: "Leverandør", cell: (r) => r.supplier_name ?? "Ukjent", sortKey: (r) => r.supplier_name ?? "" },
    { id: "status", header: "Status", cell: (r) => { const m = labelFor(SUPPLIER_CASE_STATUS_LABELS, r.status, "Ukjent"); return <StatusPill label={m.label} tokenVar={m.tokenVar} />; } },
    { id: "krav", header: "Krav", align: "right", cell: (r) => kr(r.sums.krav), sortKey: (r) => r.sums.krav },
    { id: "kreditert", header: "Kreditert", align: "right", cell: (r) => kr(r.sums.kreditert), sortKey: (r) => r.sums.kreditert },
    { id: "gjenstar", header: "Gjenstår", align: "right", cell: (r) => <span className={cn(r.sums.gjenstar > 0.005 && r.status === "open" && "text-warning")}>{kr(r.sums.gjenstar)}</span>, sortKey: (r) => r.sums.gjenstar },
    { id: "ansvarlig", header: "Ansvarlig", hideable: true, cell: (r) => (r.responsible_user_id ? names.data?.get(r.responsible_user_id) ?? "Ukjent bruker" : <span className="text-ink-secondary">—</span>) },
    { id: "oppfolging", header: "Oppfølging", cell: (r) => (r.follow_up_on ? <span className={cn(isFollowUpDue(r, today) && "font-medium text-destructive")}>{formatDate(r.follow_up_on)}</span> : "—"), sortKey: (r) => r.follow_up_on ?? "" },
    { id: "opprettet", header: "Opprettet", hideable: true, cell: (r) => formatDate(r.created_at), sortKey: (r) => r.created_at },
  ];

  const table = (
    <div className="space-y-3">
      <FilterChips chips={SAK_FILTRE.map((f) => ({ id: f, label: SAK_FILTER_LABEL[f], count: counts[f] }))} value={filter} onChange={(f: SakFilter) => update({ status: f === "apne" ? null : f })} />
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-secondary" aria-hidden />
          <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søk tittel eller leverandør" aria-label="Søk tittel eller leverandør" />
        </div>
        <Select value={leverandor ?? "all"} onValueChange={(v) => update({ leverandor: v === "all" ? null : v })}>
          <SelectTrigger className="w-[200px]" aria-label="Leverandør"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle leverandører</SelectItem>
            {suppliers.map(([id, n]) => <SelectItem key={id} value={id}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <DataTable
        ariaLabel="Leverandørsaker"
        rows={visible}
        columns={columns}
        getId={(r) => r.id}
        isLoading={list.isLoading || !company}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyText={rows.length === 0 ? SAKER_EMPTY_TEXT : "Ingen saker her"}
        preferenceScope="ravarer.saker.kolonner"
        activeId={wide ? valgt : null}
        onRowClick={wide ? (r) => update({ sak: r.id }) : undefined}
        rowHref={(r) => paths.sak(r.id)}
        renderMobileCard={(r) => {
          const m = labelFor(SUPPLIER_CASE_STATUS_LABELS, r.status, "Ukjent");
          return (
            <div className="space-y-1 rounded-lg border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2"><span className="font-medium">{r.title}</span><StatusPill label={m.label} tokenVar={m.tokenVar} /></div>
              <p className="text-caption text-ink-secondary">{r.supplier_name ?? "Ukjent"}{r.follow_up_on && <> · <span className={cn(isFollowUpDue(r, today) && "text-destructive")}>oppfølging {formatDate(r.follow_up_on)}</span></>}</p>
              <p className="text-sm tabular-nums">Krav {kr(r.sums.krav)} · gjenstår {kr(r.sums.gjenstar)}</p>
            </div>
          );
        }}
      />
      {total > rows.length && <p role="status" className="text-caption text-warning">Viser de {rows.length} nyeste av {total} saker. Tall og filtre gjelder de viste sakene.</p>}
      {rows.length > 0 && <p className="text-caption text-ink-secondary">{SAKER_EMPTY_TEXT}</p>}
    </div>
  );

  return (
    <div className="px-page py-4">
      {wide ? (
        <SplitView
          list={table}
          panel={<PeekPanel title={valgt ? "Leverandørsak" : undefined} fullHref={valgt ? paths.sak(valgt) : undefined} onClose={() => update({ sak: null })} emptyText="Velg en sak i listen">{valgt ? <SupplierCaseDetail key={valgt} id={valgt} /> : null}</PeekPanel>}
        />
      ) : table}
    </div>
  );
}
