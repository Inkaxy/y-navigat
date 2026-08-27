import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ArrowUp, ArrowDown } from "lucide-react";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { formatNumber } from "@/ravarer/lib/constants";
import { usePackageWorklist, type PackageWorklistRow } from "@/ravarer/hooks/usePackageSizes";
import { SetPackageDialog } from "@/ravarer/components/packages/SetPackageDialog";
import { SuspiciousPackagesCard } from "@/ravarer/components/packages/SuspiciousPackagesCard";


type Tone = "red" | "yellow" | "grey" | "green";

const STATUS_CARDS: { key: string; label: string; tone: Tone }[] = [
  { key: "mangler_pakning", label: "Mangler pakning", tone: "red" },
  { key: "avviker_fra_referanse", label: "Avviker fra referanse", tone: "red" },
  { key: "ustabil_pris", label: "Ustabil pris", tone: "yellow" },
  { key: "linjer_uten_pris", label: "Linjer uten pris", tone: "yellow" },
  { key: "mangler_kostpris", label: "Mangler kostpris", tone: "grey" },
  { key: "ikke_bekreftet", label: "Ikke bekreftet", tone: "grey" },
  { key: "ok", label: "OK", tone: "green" },
  { key: "ingen_fakturaer", label: "Ingen fakturaer", tone: "grey" },
];

const STATUS_LABEL: Record<string, string> = {
  ...Object.fromEntries(STATUS_CARDS.map(c => [c.key, c.label])),
  mangler_kostpris: "Mangler kostpris",
};

const toneCard: Record<Tone, string> = {
  red: "border-destructive/50",
  yellow: "border-warning/50",
  grey: "",
  green: "border-success/50",
};
const toneText: Record<Tone, string> = {
  red: "text-destructive",
  yellow: "text-warning",
  grey: "text-ink-secondary",
  green: "text-success",
};

function statusBadge(status: string | null) {
  const tone = STATUS_CARDS.find(c => c.key === status)?.tone ?? "grey";
  const cls =
    tone === "red"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : tone === "yellow"
      ? "border-warning/40 bg-warning/10 text-warning"
      : tone === "green"
      ? "border-success/40 bg-success/10 text-success"
      : "";
  return <Badge variant="outline" className={cls}>{STATUS_LABEL[status ?? ""] ?? status ?? "—"}</Badge>;
}

type SortKey =
  | "name" | "base_unit" | "current_cost_price" | "referansepris" | "foreslatt_fra_navn" | "pakningsfaktor"
  | "enheter_i_bruk" | "antall_fakturalinjer" | "kjopt_kr_totalt" | "pris_spredning" | "status";

const kr0 = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(n) + " kr";

function ReferenceFactorBadge({ f }: { f: number | null }) {
  if (f == null) return null;
  const ok = f >= 0.33 && f <= 3.0;
  const text = f < 1 ? `${formatNumber(1 / f, 0)}× for lav` : f > 1 ? `${formatNumber(f, 0)}× for høy` : "lik";
  return (
    <Badge
      variant="outline"
      className={ok ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive"}
    >
      {text}
    </Badge>
  );
}

function formatReferenceSource(kilde: string | null, dato: string | null) {
  if (!kilde) return null;
  const pretty = kilde.replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
  const year = dato ? new Date(dato).getFullYear() : null;
  if (year && !Number.isNaN(year) && !pretty.includes(String(year))) return `${pretty} ${year}`;
  return pretty;
}

function SuggestionCell({ navn, referanse }: { navn: number | null; referanse: number | null }) {
  const refVal = referanse;
  if (navn == null && refVal == null) return <span className="text-ink-secondary">—</span>;
  let badge: { text: string; cls: string } | null = null;
  if (navn != null && refVal != null && navn > 0) {
    const dev = Math.abs(refVal - navn) / navn;
    badge =
      dev < 0.15
        ? { text: "bekreftet av referanse", cls: "border-success/40 bg-success/10 text-success" }
        : dev <= 0.4
        ? { text: "sjekk", cls: "border-warning/40 bg-warning/10 text-warning" }
        : { text: "spriker", cls: "border-destructive/40 bg-destructive/10 text-destructive" };
  }
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="font-medium tabular-nums">
          {navn != null ? formatNumber(navn, 3) : formatNumber(refVal, 1)}
        </span>
        {badge && <Badge variant="outline" className={badge.cls}>{badge.text}</Badge>}
      </div>
      {navn != null && refVal != null && (
        <div className="text-xs text-ink-secondary">≈ {formatNumber(refVal, 1)} fra referanse</div>
      )}
    </div>
  );
}


export default function PackageSizesPage() {
  const { data: rows = [], isLoading } = usePackageWorklist();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "kjopt_kr_totalt", dir: "desc" });
  const [selected, setSelected] = useState<PackageWorklistRow | null>(null);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.status ?? ""] = (m[r.status ?? ""] ?? 0) + 1;
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const arr = rows.filter(
      r => (!statusFilter || r.status === statusFilter) && (!needle || (r.name ?? "").toLowerCase().includes(needle)),
    );
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...arr].sort((a, b) => {
      const av = a[sort.key] as string | number | null;
      const bv = b[sort.key] as string | number | null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "nb") * dir;
    });
  }, [rows, q, statusFilter, sort]);

  const toggleSort = (key: SortKey) =>
    setSort(s => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={`px-3 py-2 ${right ? "text-right" : "text-left"}`}>
      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => toggleSort(k)}>
        {children}
        {sort.key === k && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );

  return (
    <div className="space-y-5">
      <RavarerHeaderBanner />

      <div>
        <h1 className="text-2xl font-semibold">Pakningsstørrelser</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Hvor mange baseenheter det er i én pakning. Uten dette blir kostprisen feil.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {STATUS_CARDS.map(c => {
          const active = statusFilter === c.key;
          return (
            <Card
              key={c.key}
              role="button"
              tabIndex={0}
              onClick={() => setStatusFilter(active ? null : c.key)}
              onKeyDown={e => e.key === "Enter" && setStatusFilter(active ? null : c.key)}
              className={`cursor-pointer p-3 transition hover:bg-muted/40 ${toneCard[c.tone]} ${active ? "ring-2 ring-app" : ""}`}
            >
              <p className="text-xs text-ink-secondary">{c.label}</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneText[c.tone]}`}>{counts[c.key] ?? 0}</p>
            </Card>
          );
        })}
      </div>

      <SuspiciousPackagesCard />

      <Card className="p-4">

        <div className="mb-3 flex items-center gap-2">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
            <Input className="pl-8" placeholder="Søk på navn…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <span className="text-sm text-ink-secondary">{filtered.length} råvarer</span>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-secondary">Ingen råvarer å vise.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-ink-secondary">
                <tr>
                  <Th k="name">Råvare</Th>
                  <Th k="base_unit">Baseenhet</Th>
                  <Th k="current_cost_price" right>Kostpris nå</Th>
                  <Th k="referansepris" right>Referanse</Th>
                  <Th k="foreslatt_fra_navn">Forslag</Th>
                  <Th k="pakningsfaktor">Pakning</Th>
                  <Th k="enheter_i_bruk">Enheter på faktura</Th>
                  <Th k="antall_fakturalinjer" right>Linjer</Th>
                  <Th k="kjopt_kr_totalt" right>Kjøpt 12 mnd</Th>
                  <Th k="pris_spredning" right>Spredning</Th>
                  <Th k="status">Status</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-t border-line-subtle hover:bg-muted/40"
                    onClick={() => setSelected(r)}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-ink-secondary">{r.category ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2">{r.base_unit ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {r.current_cost_price == null ? "—" : `${formatNumber(r.current_cost_price, 3)} kr/${r.base_unit ?? ""}`}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="tabular-nums whitespace-nowrap">
                        {r.referansepris == null ? "—" : `${formatNumber(r.referansepris, 3)} kr/${r.base_unit ?? ""}`}
                      </div>
                      {r.referansepris != null && formatReferenceSource(r.referansekilde, r.referansedato) && (
                        <div className="text-xs text-ink-secondary">
                          {formatReferenceSource(r.referansekilde, r.referansedato)}
                        </div>
                      )}
                      <div className="mt-1"><ReferenceFactorBadge f={r.referanse_faktor} /></div>
                    </td>
                    <td className="px-3 py-2">
                      <SuggestionCell navn={r.foreslatt_fra_navn} referanse={r.foreslatt_fra_referanse} />
                    </td>
                    <td className="px-3 py-2">
                      {r.pakningsfaktor == null ? (
                        <span className="font-medium text-destructive">mangler</span>
                      ) : (
                        <span className="tabular-nums">
                          {formatNumber(r.pakningsfaktor, 3)} {r.base_unit ?? ""} per pakning
                        </span>
                      )}
                      {r.faktor_kilde && (
                        <Badge variant="outline" className="ml-2">
                          {r.faktor_kilde === "leverandor" ? "leverandør" : "råvare"}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{r.enheter_i_bruk || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.antall_fakturalinjer ?? 0}
                      {(r.linjer_uten_pris ?? 0) > 0 && (
                        <span className="ml-1 text-destructive">({r.linjer_uten_pris} uten pris)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{kr0(r.kjopt_kr_totalt)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${(r.pris_spredning ?? 0) > 2 ? "text-destructive" : ""}`}>
                      {r.pris_spredning == null ? "—" : `${formatNumber(r.pris_spredning, 2)}×`}
                    </td>
                    <td className="px-3 py-2">{statusBadge(r.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <SetPackageDialog row={selected} open={!!selected} onOpenChange={v => !v && setSelected(null)} />
    </div>
  );
}
