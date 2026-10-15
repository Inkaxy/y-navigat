import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Maximize2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate, formatNumber } from "@/ravarer/lib/constants";
import { usePackageWorklist, type PackageWorklistRow } from "@/ravarer/hooks/usePackageSizes";
import { usePackageSuggestions } from "@/ravarer/hooks/usePackageSuggestions";
import { useSuspiciousPackages } from "@/ravarer/hooks/useSuspiciousPackages";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { PackageEditor } from "@/ravarer/editors/PackageEditor";
import { SuspiciousPackagesCard } from "@/ravarer/components/packages/SuspiciousPackagesCard";
import { PACKAGE_FILTERS, PACKAGE_FILTER_LABEL, matchesPackageFilter } from "@/ravarer/lib/packageFilter";
import type { PackageFillSuggestion } from "@/ravarer/lib/packageMath";
import { paths } from "@/ravarer/lib/paths";
import { sectionSearch } from "@/ravarer/lib/rawMaterialSections";
import { DataTable, type Column } from "@/ravarer/ui/DataTable";
import { PeekPanel, SplitView } from "@/ravarer/ui/SplitView";
import { useHotkeys } from "@/ravarer/ui/hotkeys";
import { orderPackageRows, readPackageQuery } from "./modeLogic";
import { useActiveRow } from "./useActive";

type Tone = "red" | "yellow" | "grey" | "green";
export const PACKAGE_STATUS_CARDS: { key: string; label: string; tone: Tone }[] = [
  { key: "mangler_pakning", label: "Mangler standardpakning", tone: "red" },
  { key: "avviker_fra_referanse", label: "Avviker fra referanse", tone: "red" },
  { key: "ustabil_pris", label: "Ustabil pris", tone: "yellow" },
  { key: "linjer_uten_pris", label: "Linjer uten pris", tone: "yellow" },
  { key: "mangler_kostpris", label: "Mangler kostpris", tone: "grey" },
  { key: "ikke_bekreftet", label: "Standardpakning ikke bekreftet", tone: "grey" },
  { key: "ok", label: "OK", tone: "green" },
  { key: "ingen_fakturaer", label: "Ingen fakturaer", tone: "grey" },
];
const STATUS_LABEL: Record<string, string> = Object.fromEntries(PACKAGE_STATUS_CARDS.map((c) => [c.key, c.label]));
const toneCard: Record<Tone, string> = { red: "border-destructive/50", yellow: "border-warning/50", grey: "", green: "border-success/50" };
const toneText: Record<Tone, string> = { red: "text-destructive", yellow: "text-warning", grey: "text-ink-secondary", green: "text-success" };

function StatusBadge({ status }: { status: string | null }) {
  const tone = PACKAGE_STATUS_CARDS.find((c) => c.key === status)?.tone ?? "grey";
  const cls = tone === "red" ? "border-destructive/40 bg-destructive/10 text-destructive" : tone === "yellow" ? "border-warning/40 bg-warning/10 text-warning" : tone === "green" ? "border-success/40 bg-success/10 text-success" : "";
  return <Badge variant="outline" className={cls}>{STATUS_LABEL[status ?? ""] ?? status ?? "—"}</Badge>;
}

const kr0 = (n: number | null) => (n == null ? "—" : new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(n) + " kr");

function ReferenceFactorBadge({ f }: { f: number | null }) {
  if (f == null) return null;
  const ok = f >= 0.33 && f <= 3.0;
  const text = f < 1 ? `${formatNumber(1 / f, 0)}× for lav` : f > 1 ? `${formatNumber(f, 0)}× for høy` : "lik";
  return <Badge variant="outline" className={ok ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive"}>{text}</Badge>;
}

function formatReferenceSource(kilde: string | null, dato: string | null) {
  if (!kilde) return null;
  const pretty = kilde.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const year = dato ? Number(dato.slice(0, 4)) : null;
  if (year && !Number.isNaN(year) && !pretty.includes(String(year))) return `${pretty} ${year}`;
  return pretty;
}

function SuggestionCell({ navn, referanse }: { navn: number | null; referanse: number | null }) {
  if (navn == null && referanse == null) return <span className="text-ink-secondary">—</span>;
  let badge: { text: string; cls: string } | null = null;
  if (navn != null && referanse != null && navn > 0) {
    const dev = Math.abs(referanse - navn) / navn;
    badge = dev < 0.15 ? { text: "bekreftet av referanse", cls: "border-success/40 bg-success/10 text-success" } : dev <= 0.4 ? { text: "sjekk", cls: "border-warning/40 bg-warning/10 text-warning" } : { text: "spriker", cls: "border-destructive/40 bg-destructive/10 text-destructive" };
  }
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="font-medium tabular-nums">{navn != null ? formatNumber(navn, 3) : formatNumber(referanse, 1)}</span>
        {badge && <Badge variant="outline" className={badge.cls}>{badge.text}</Badge>}
      </div>
      {navn != null && referanse != null && <div className="text-xs text-ink-secondary">≈ {formatNumber(referanse, 1)} fra referanse</div>}
    </div>
  );
}

const pkgText = (r: PackageWorklistRow) => (r.pakningsfaktor == null ? "mangler" : `${formatNumber(r.pakningsfaktor, 3)} ${r.base_unit ?? ""} per pakning`);
const nok3 = (n: number | null, unit: string | null) => (n == null ? "" : `${formatNumber(n, 3)} kr/${unit ?? ""}`);

/**
 * Pakning-modus (`liste=pakning`). Eksisterende motor beholdt: arbeidslisten, forslag fra navn/referanse
 * og siste faktura, mistenkelige pakninger, og bekreftelse ALLTID via `PackageEditor` (forhåndsvisning + RPC).
 * Filter, statuskort og sortering ligger i URL-en, så råvarekortets forrige/neste følger samme rekkefølge.
 */
export default function PackageMode() {
  const { canWrite } = useRavarer();
  const list = usePackageWorklist();
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const { data: suspicious = [] } = useSuspiciousPackages();
  const { sp, setSp, valgt, setActive, listSearch } = useActiveRow();
  const query = readPackageQuery(sp);
  const [editing, setEditing] = useState<{ row: PackageWorklistRow; suggestion: PackageFillSuggestion | null } | null>(null);

  const suspiciousIds = useMemo(() => new Set(suspicious.map((s) => s.raw_material_id)), [suspicious]);
  const suggestionIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const { data: suggestions } = usePackageSuggestions(suggestionIds);
  const ordered = useMemo(() => orderPackageRows(rows, query, suspiciousIds), [rows, query, suspiciousIds]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.status ?? ""] = (m[r.status ?? ""] ?? 0) + 1;
    return m;
  }, [rows]);
  const filterCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of PACKAGE_FILTERS) m[f] = rows.filter((r) => matchesPackageFilter(r, f, suspiciousIds)).length;
    return m;
  }, [rows, suspiciousIds]);

  const patch = (p: Record<string, string | null>) => setSp((prev) => {
    const n = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(p)) { if (v == null) n.delete(k); else n.set(k, v); }
    return n;
  }, { replace: true });

  /** Bekreftelse går ALLTID via pakningsdialogen (forhåndsvisning + RPC som også oppdaterer kostprisen). */
  const openEditor = (row: PackageWorklistRow) => {
    const sug = suggestions?.get(row.id);
    setEditing({ row, suggestion: sug ? { size: sug.package_size, contentUnit: sug.package_unit, count: sug.count_per_package ?? 1 } : null });
  };

  const active = ordered.find((r) => r.id === valgt) ?? rows.find((r) => r.id === valgt) ?? null;

  // «b» bekrefter aktiv rad (Enter åpner full side via tabellen).
  useHotkeys([{ keys: ["b"], description: "Bekreft pakning for valgt rad", handler: () => { if (active && canWrite) openEditor(active); } }]);

  // Sortering er styrt (URL); `sortKey` markerer bare at kolonnen kan sorteres.
  const sortable = () => null;
  const columns: Column<PackageWorklistRow>[] = [
    { id: "name", header: "Råvare", alwaysVisible: true, sortKey: sortable, csv: (r) => r.name ?? "",
      cell: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-ink-secondary">{r.category ?? "—"}</div></div> },
    { id: "base_unit", header: "Baseenhet", hideable: true, sortKey: sortable, csv: (r) => r.base_unit ?? "", cell: (r) => r.base_unit ?? "—" },
    { id: "current_cost_price", header: "Kostpris nå", align: "right", hideable: true, sortKey: sortable, csv: (r) => nok3(r.current_cost_price, r.base_unit),
      cell: (r) => <span className="whitespace-nowrap">{r.current_cost_price == null ? "—" : nok3(r.current_cost_price, r.base_unit)}</span> },
    { id: "referansepris", header: "Referanse", align: "right", hideable: true, sortKey: sortable, csv: (r) => nok3(r.referansepris, r.base_unit),
      cell: (r) => (
        <div>
          <div className="whitespace-nowrap">{r.referansepris == null ? "—" : nok3(r.referansepris, r.base_unit)}</div>
          {r.referansepris != null && formatReferenceSource(r.referansekilde, r.referansedato) && <div className="text-xs text-ink-secondary">{formatReferenceSource(r.referansekilde, r.referansedato)}</div>}
          <div className="mt-1"><ReferenceFactorBadge f={r.referanse_faktor} /></div>
        </div>
      ) },
    { id: "foreslatt_fra_navn", header: "Forslag", hideable: true, sortKey: sortable, csv: (r) => (r.foreslatt_fra_navn ?? r.foreslatt_fra_referanse ?? "").toString(),
      cell: (r) => <SuggestionCell navn={r.foreslatt_fra_navn} referanse={r.foreslatt_fra_referanse} /> },
    { id: "pakningsfaktor", header: "Pakning", hideable: true, sortKey: sortable, csv: pkgText,
      cell: (r) => (
        <>
          {r.pakningsfaktor == null ? <span className="font-medium text-destructive">mangler</span> : <span>{pkgText(r)}</span>}
          {r.faktor_kilde && <Badge variant="outline" className="ml-2">{r.faktor_kilde === "leverandor" ? "leverandør" : "råvare"}</Badge>}
        </>
      ) },
    { id: "enheter_i_bruk", header: "Enheter på faktura", hideable: true, sortKey: sortable, csv: (r) => r.enheter_i_bruk ?? "", cell: (r) => <span className="text-ink-secondary">{r.enheter_i_bruk || "—"}</span> },
    { id: "antall_fakturalinjer", header: "Linjer", align: "right", hideable: true, sortKey: sortable, csv: (r) => String(r.antall_fakturalinjer ?? 0),
      cell: (r) => <>{r.antall_fakturalinjer ?? 0}{(r.linjer_uten_pris ?? 0) > 0 && <span className="ml-1 text-destructive">({r.linjer_uten_pris} uten pris)</span>}</> },
    { id: "kjopt_kr_totalt", header: "Kjøpt 12 mnd", align: "right", hideable: true, sortKey: sortable, csv: (r) => kr0(r.kjopt_kr_totalt), cell: (r) => <span className="whitespace-nowrap">{kr0(r.kjopt_kr_totalt)}</span> },
    { id: "pris_spredning", header: "Spredning", align: "right", hideable: true, sortKey: sortable, csv: (r) => (r.pris_spredning == null ? "" : `${formatNumber(r.pris_spredning, 2)}×`),
      cell: (r) => <span className={(r.pris_spredning ?? 0) > 2 ? "text-destructive" : ""}>{r.pris_spredning == null ? "—" : `${formatNumber(r.pris_spredning, 2)}×`}</span> },
    { id: "status", header: "Status", hideable: true, sortKey: sortable, csv: (r) => STATUS_LABEL[r.status ?? ""] ?? r.status ?? "", cell: (r) => <StatusBadge status={r.status} /> },
    { id: "siste_forslag", header: "Forslag fra siste faktura", hideable: true, defaultHidden: true,
      csv: (r) => { const g = suggestions?.get(r.id); return g ? `${formatNumber(g.package_size, 3)} ${g.package_unit ?? ""}${g.count_per_package != null ? ` × ${g.count_per_package}` : ""}` : ""; },
      cell: (r) => { const g = suggestions?.get(r.id); return g ? <div><div className="font-medium">{formatNumber(g.package_size, 3)} {g.package_unit ?? ""}{g.count_per_package != null && ` × ${g.count_per_package}`}</div><div className="text-xs text-ink-secondary">{formatDate(g.invoice_date)}{g.description ? ` · ${g.description}` : ""}</div></div> : <span className="text-ink-secondary">Ingen fakturalinje med pakning</span>; } },
    { id: "handling", header: "Handling", align: "right",
      cell: (r) => <Button size="sm" variant="outline" disabled={!canWrite} onClick={() => openEditor(r)}><Check className="mr-1 h-3.5 w-3.5" aria-hidden />Bekreft</Button> },
  ];

  const g = active ? suggestions?.get(active.id) ?? null : null;

  return (
    <div className="space-y-4">
      <p className="text-caption text-ink-secondary">Hvor mange baseenheter det er i én pakning. Uten dette blir kostprisen feil.</p>
      <div className="flex flex-wrap gap-2">
        {PACKAGE_FILTERS.map((f) => (
          <Button key={f} size="sm" variant={query.filter === f ? "default" : "outline"} onClick={() => patch({ filter: f })}>
            {PACKAGE_FILTER_LABEL[f]}<span className="ml-1.5 tabular-nums opacity-70">{filterCounts[f] ?? 0}</span>
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {PACKAGE_STATUS_CARDS.map((c) => {
          const on = query.status === c.key;
          return (
            <Card key={c.key} role="button" tabIndex={0} aria-pressed={on}
              onClick={() => patch({ pstatus: on ? null : c.key })}
              onKeyDown={(e) => { if (e.key === "Enter") patch({ pstatus: on ? null : c.key }); }}
              className={`cursor-pointer p-3 transition hover:bg-muted/40 ${toneCard[c.tone]} ${on ? "ring-2 ring-app" : ""}`}>
              <p className="text-xs text-ink-secondary">{c.label}</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneText[c.tone]}`}>{counts[c.key] ?? 0}</p>
            </Card>
          );
        })}
      </div>
      <SuspiciousPackagesCard />
      <SplitView
        selected={!!valgt}
        list={
          <DataTable
            ariaLabel="Pakninger"
            rows={list.isLoading ? undefined : ordered}
            columns={columns}
            getId={(r) => r.id}
            isLoading={list.isLoading}
            error={list.isError ? list.error : undefined}
            onRetry={() => void list.refetch()}
            emptyText="Ingen råvarer å vise."
            activeId={valgt}
            onActiveChange={(id) => setActive(id)}
            onEnter={(r) => setActive(r.id)}
            hotkeys
            sort={{ id: query.sort.key, dir: query.sort.dir }}
            onSortChange={(n) => patch({ sort: n ? `${n.id}:${n.dir}` : null })}
            preferenceScope="ravarer:varer:pakning:columns"
            minTableWidth={valgt ? "760px" : "1100px"}
            renderMobileCard={(r) => (
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2"><span className="font-medium">{r.name}</span><StatusBadge status={r.status} /></div>
                <div className="text-xs text-ink-secondary">{pkgText(r)} · {kr0(r.kjopt_kr_totalt)}</div>
              </div>
            )}
          />
        }
        panel={
          <PeekPanel title={active?.name ?? undefined} fullHref={active ? `${paths.raavare(active.id)}${sectionSearch(new URLSearchParams(listSearch), "grunndata")}` : undefined} onClose={valgt ? () => setActive(null) : undefined} emptyText="Velg en råvare i listen"
            footer={active && canWrite ? <Button className="min-h-[44px] w-full" onClick={() => openEditor(active)}><Check className="mr-1.5 h-4 w-4" aria-hidden />Bekreft pakning</Button> : undefined}>
            {active ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-secondary">Status</dt><dd><StatusBadge status={active.status} /></dd>
                <dt className="text-ink-secondary">Pakning nå</dt><dd>{pkgText(active)}</dd>
                <dt className="text-ink-secondary">Kostpris nå</dt><dd className="tabular-nums">{nok3(active.current_cost_price, active.base_unit) || "—"}</dd>
                <dt className="text-ink-secondary">Referanse</dt><dd className="tabular-nums">{nok3(active.referansepris, active.base_unit) || "—"} {formatReferenceSource(active.referansekilde, active.referansedato) ?? ""}</dd>
                <dt className="text-ink-secondary">Forslag</dt><dd><SuggestionCell navn={active.foreslatt_fra_navn} referanse={active.foreslatt_fra_referanse} /></dd>
                <dt className="text-ink-secondary">Siste faktura</dt><dd>{g ? `${formatNumber(g.package_size, 3)} ${g.package_unit ?? ""}${g.count_per_package != null ? ` × ${g.count_per_package}` : ""} · ${formatDate(g.invoice_date)}` : "Ingen fakturalinje med pakning"}</dd>
                <dt className="text-ink-secondary">Enheter</dt><dd>{active.enheter_i_bruk || "—"}</dd>
                <dt className="text-ink-secondary">Linjer</dt><dd className="tabular-nums">{active.antall_fakturalinjer ?? 0}{(active.linjer_uten_pris ?? 0) > 0 ? ` (${active.linjer_uten_pris} uten pris)` : ""}</dd>
                <dt className="text-ink-secondary">Kjøpt 12 mnd</dt><dd className="tabular-nums">{kr0(active.kjopt_kr_totalt)}</dd>
                <dt className="col-span-2 pt-2"><Link className="inline-flex items-center gap-1.5 text-sm underline underline-offset-2" to={`${paths.raavare(active.id)}${listSearch ? `?${listSearch}` : ""}`}><Maximize2 className="h-3.5 w-3.5" aria-hidden />Åpne råvarekortet</Link></dt>
              </dl>
            ) : null}
          </PeekPanel>
        }
      />
      <PackageEditor
        key={editing?.row.id ?? "none"}
        row={editing?.row ?? null}
        open={!!editing}
        suggestion={editing?.suggestion ?? null}
        onOpenChange={(v) => { if (!v) setEditing(null); }}
      />
    </div>
  );
}
