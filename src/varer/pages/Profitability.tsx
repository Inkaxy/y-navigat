import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAppContext } from "@/varer/context/AppContext";
import { AppHeaderBanner } from "@/varer/components/layout/AppHeaderBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Download,
  ExternalLink,
  RotateCcw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { osloTodayISO } from "@/lib/osloDate";
import { nKr, nNum, nPct, parseNum } from "@/varer/lib/calcFormat";
import { downloadCsv } from "@/varer/lib/pricing";

/* ---------------------------------------------------------------- typer */

interface SheetRow {
  product_id: string;
  display_number: number | null;
  code: string | null;
  navn: string | null;
  kategori: string | null;
  calc_type: string | null;
  kvalitet: string | null;
  merknader: string[] | null;
  raavarekost: number | null;
  arbeidskost: number | null;
  emballasjekost: number | null;
  kostpris: number | null;
  antall_per_bakst: number | null;
  pris: number | null;
  pris_med_emballasje: number | null;
  brutto_pct: number | null;
  db2: number | null;
  dg2_pct: number | null;
  maal_brutto_pct: number | null;
  maal_dg2_pct: number | null;
  maal_kilde: string | null;
  avvik_pp: number | null;
  nodvendig_pris: number | null;
  nodvendig_endring_pct: number | null;
  status: string | null;
}

const CALC_TYPES = [
  { key: "oppskrift", label: "Oppskrift", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  { key: "arvet", label: "Arvet", cls: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  { key: "handelsvare", label: "Handelsvare", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  { key: "bakeoff", label: "Bakeoff", cls: "bg-amber-500/20 text-amber-800 dark:text-amber-300" },
  { key: "halvfabrikat", label: "Halvfabrikat", cls: "bg-purple-700/20 text-purple-900 dark:text-purple-300" },
  { key: "sammensatt", label: "Sammensatt", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  { key: "manuell", label: "Manuell", cls: "bg-muted text-muted-foreground" },
] as const;

const CALC_MAP = Object.fromEntries(CALC_TYPES.map((c) => [c.key, c]));

const STATUSES = [
  { key: "gronn", label: "Grønn", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  { key: "gul", label: "Gul", cls: "bg-amber-500/20 text-amber-800 dark:text-amber-300" },
  { key: "rod", label: "Rød", cls: "bg-destructive/15 text-destructive" },
  { key: "ingen_pris", label: "Ingen pris", cls: "bg-muted text-muted-foreground" },
  { key: "forelopig", label: "Foreløpig", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  { key: "ikke_vurdert", label: "Ikke vurdert", cls: "bg-muted text-muted-foreground" },
  { key: "halvfabrikat", label: "Halvfabrikat", cls: "bg-purple-700/20 text-purple-900 dark:text-purple-300" },
  { key: "mangler_kalkyle", label: "Mangler kalkyle", cls: "bg-destructive/10 text-destructive" },
  { key: "uten_maal", label: "Uten mål", cls: "bg-muted text-muted-foreground" },
] as const;

const STATUS_MAP = Object.fromEntries(STATUSES.map((s) => [s.key, s]));

/** Statuskortene som vises som filterknapper. */
const STATUS_CARDS = [
  "gronn",
  "gul",
  "rod",
  "ingen_pris",
  "ikke_vurdert",
  "halvfabrikat",
  "mangler_kalkyle",
] as const;

const MAAL_KILDE_TEKST: Record<string, string> = {
  vare: "Mål satt direkte på varen",
  "kategori+type": "Mål fra kategori + kalkyletype",
  kategori: "Mål fra kategori",
  type: "Mål fra kalkyletype",
  standard: "Standardmål for selskapet",
};

const PAGE_SIZE = 100;
const DEFAULT_LIST_CODE = "nb_butikker";

type SortKey =
  | "display_number"
  | "navn"
  | "kategori"
  | "calc_type"
  | "kvalitet"
  | "raavarekost"
  | "arbeidskost"
  | "kostpris"
  | "pris"
  | "pris_med_emballasje"
  | "brutto_pct"
  | "db2"
  | "dg2_pct"
  | "maal_dg2_pct"
  | "avvik_pp"
  | "nodvendig_pris"
  | "status";

/* ---------------------------------------------------------------- side */

export default function Profitability() {
  const navigate = useNavigate();
  const { legalEntityId } = useAppContext();

  const [priceListId, setPriceListId] = useState<string>("");
  const [date, setDate] = useState<string>(osloTodayISO());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [kategoriFilter, setKategoriFilter] = useState("alle");
  const [calcFilter, setCalcFilter] = useState("alle");
  const [kvalitetFilter, setKvalitetFilter] = useState("alle");
  const [sortKey, setSortKey] = useState<SortKey>("avvik_pp");
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [simulated, setSimulated] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<SheetRow | null>(null);

  /* --- prislister --- */
  const listsQuery = useQuery({
    queryKey: ["profitability-price-lists", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_lists")
        .select("id, code, display_name, price_level, is_provisional")
        .eq("legal_entity_id", legalEntityId!)
        .not("price_level", "is", null)
        .order("display_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const lists = listsQuery.data ?? [];
  const activeListId =
    priceListId ||
    lists.find((l) => l.code === DEFAULT_LIST_CODE)?.id ||
    lists[0]?.id ||
    "";
  const activeList = lists.find((l) => l.id === activeListId) ?? null;

  /* --- lønnsomhetsdata --- */
  const sheetQuery = useQuery({
    queryKey: ["profitability-sheet", activeListId, date],
    enabled: !!activeListId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("profitability_sheet", {
        p_price_list_id: activeListId,
        p_date: date,
      });
      if (error) throw error;
      return (data ?? []) as unknown as SheetRow[];
    },
  });

  useEffect(() => {
    if (sheetQuery.error) toast.error("Kunne ikke hente lønnsomhetsdata");
  }, [sheetQuery.error]);

  const rows = useMemo(() => sheetQuery.data ?? [], [sheetQuery.data]);

  /* --- aggregater --- */
  const kalkyleTellinger = useMemo(() => {
    const counts: Record<string, number> = {};
    let mangler = 0;
    for (const r of rows) {
      if (r.status === "mangler_kalkyle") mangler++;
      else counts[r.calc_type ?? "manuell"] = (counts[r.calc_type ?? "manuell"] ?? 0) + 1;
    }
    return { counts, mangler, dekket: rows.length - mangler };
  }, [rows]);

  const statusTellinger = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status ?? "ukjent"] = (c[r.status ?? "ukjent"] ?? 0) + 1;
    return c;
  }, [rows]);

  const snitt = useMemo(() => {
    const b = rows.map((r) => r.brutto_pct).filter((v): v is number => v != null);
    const d = rows.map((r) => r.dg2_pct).filter((v): v is number => v != null);
    const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    return { brutto: avg(b), dg2: avg(d) };
  }, [rows]);

  const kategorier = useMemo(
    () => Array.from(new Set(rows.map((r) => r.kategori).filter(Boolean))).sort() as string[],
    [rows],
  );

  /* --- filtrering + sortering --- */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (statusFilter.size && !statusFilter.has(r.status ?? "")) return false;
      if (kategoriFilter !== "alle" && r.kategori !== kategoriFilter) return false;
      if (calcFilter !== "alle" && r.calc_type !== calcFilter) return false;
      if (kvalitetFilter !== "alle" && (r.kvalitet ?? "") !== kvalitetFilter) return false;
      if (q) {
        const hay = `${r.navn ?? ""} ${r.display_number ?? ""} ${r.code ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    out = [...out].sort((a, b) => {
      const av = a[sortKey] as string | number | null;
      const bv = b[sortKey] as string | number | null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nullverdier alltid sist
      if (bv == null) return -1;
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), "nb-NO");
      return sortAsc ? cmp : -cmp;
    });
    return out;
  }, [rows, search, statusFilter, kategoriFilter, calcFilter, kvalitetFilter, sortKey, sortAsc]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  /* --- handlinger --- */
  const toggleStatus = (key: string) => {
    setPage(0);
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
    setPage(0);
  };

  const exportCsv = () => {
    const header = [
      "Varenr", "Navn", "Kategori", "Kalkyletype", "Kvalitet",
      "Råvare", "Arbeid", "Kostpris", "Pris", "Med emballasje",
      "Brutto %", "DB2", "DG2 %", "Mål brutto %", "Mål DG2 %", "Avvik pp",
      "Nødvendig pris", "Status",
    ];
    const num = (v: number | null | undefined) =>
      v == null ? "" : String(v).replace(".", ",");
    const lines = [header.join(";")];
    for (const r of filtered) {
      lines.push(
        [
          r.display_number ?? "",
          (r.navn ?? "").replace(/;/g, " "),
          (r.kategori ?? "").replace(/;/g, " "),
          r.calc_type ?? "",
          r.kvalitet ?? "",
          num(r.raavarekost), num(r.arbeidskost), num(r.kostpris),
          num(r.pris), num(r.pris_med_emballasje),
          num(r.brutto_pct), num(r.db2), num(r.dg2_pct),
          num(r.maal_brutto_pct), num(r.maal_dg2_pct), num(r.avvik_pp),
          num(r.nodvendig_pris),
          STATUS_MAP[r.status ?? ""]?.label ?? r.status ?? "",
        ].join(";"),
      );
    }
    downloadCsv(`lonnsomhet_${activeList?.code ?? "liste"}_${date}.csv`, lines.join("\n"));
  };

  /* --- render --- */
  const loading = listsQuery.isLoading || sheetQuery.isLoading;

  const grouped = {
    internpris: lists.filter((l) => l.price_level === "internpris"),
    engros: lists.filter((l) => l.price_level === "engros"),
    utsalg: lists.filter((l) => l.price_level === "utsalg"),
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-5 pb-16">
        <AppHeaderBanner
          title="Lønnsomhet"
          subtitle="Brutto og DG2 for hele sortimentet"
          actions={
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={!filtered.length}>
              <Download className="mr-1.5 h-4 w-4" />
              Eksporter CSV
            </Button>
          }
        />

        {/* topplinje */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px]">
            <label className="mb-1 block text-xs text-muted-foreground">Prisliste</label>
            <Select
              value={activeListId}
              onValueChange={(v) => {
                setPriceListId(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Velg prisliste" />
              </SelectTrigger>
              <SelectContent>
                {([
                  ["Internpris", grouped.internpris],
                  ["Engros", grouped.engros],
                  ["Utsalg", grouped.utsalg],
                ] as const).map(([label, items]) =>
                  items.length ? (
                    <SelectGroup key={label}>
                      <SelectLabel>{label}</SelectLabel>
                      {items.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.display_name}
                          {l.is_provisional ? " (foreløpig)" : ""}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null,
                )}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Dato</label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 w-[160px]"
            />
          </div>
        </div>

        {activeList?.is_provisional && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Denne prislisten er merket som foreløpig. Marginene under er ikke pålitelige.
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-[420px] w-full" />
          </div>
        ) : (
          <>
            {/* kalkyledekning */}
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="text-sm font-semibold">
                  Kalkyledekning: {nNum(kalkyleTellinger.dekket, 0)} av {nNum(rows.length, 0)} varer (
                  {rows.length ? nPct((kalkyleTellinger.dekket / rows.length) * 100, 0) : "—"})
                </div>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  {CALC_TYPES.map((c) =>
                    kalkyleTellinger.counts[c.key] ? (
                      <div
                        key={c.key}
                        className={cn("h-full", c.cls.split(" ")[0].replace("/15", "/70").replace("/20", "/70"))}
                        style={{ width: `${(kalkyleTellinger.counts[c.key] / (rows.length || 1)) * 100}%` }}
                      />
                    ) : null,
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {CALC_TYPES.map((c) => (
                    <span key={c.key}>
                      {c.label} <strong className="text-foreground">{kalkyleTellinger.counts[c.key] ?? 0}</strong>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => toggleStatus("mangler_kalkyle")}
                    className="font-medium text-destructive underline-offset-2 hover:underline"
                  >
                    Mangler <strong>{kalkyleTellinger.mangler}</strong>
                  </button>
                </div>
              </CardContent>
            </Card>

            {/* statuskort */}
            <div className="flex flex-wrap items-center gap-2">
              {STATUS_CARDS.map((key) => {
                const s = STATUS_MAP[key];
                const active = statusFilter.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleStatus(key)}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-left transition-colors",
                      active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <div className="text-lg font-semibold leading-none">{statusTellinger[key] ?? 0}</div>
                    <div className={cn("mt-1 rounded px-1.5 py-0.5 text-[11px] font-medium", s.cls)}>
                      {s.label}
                    </div>
                  </button>
                );
              })}
              <div className="ml-auto text-right text-sm">
                <div className="font-medium">
                  Snitt brutto per vare: {nPct(snitt.brutto)} · Snitt DG2: {nPct(snitt.dg2)}
                </div>
                <div className="text-xs text-muted-foreground">ikke vektet etter salg</div>
              </div>
            </div>

            {/* filtre */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(0);
                  }}
                  placeholder="Søk navn eller varenr…"
                  className="h-9 w-[240px] pl-8"
                />
              </div>
              <Select value={kategoriFilter} onValueChange={(v) => { setKategoriFilter(v); setPage(0); }}>
                <SelectTrigger className="h-9 w-[190px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="alle">Alle kategorier</SelectItem>
                  {kategorier.map((k) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={calcFilter} onValueChange={(v) => { setCalcFilter(v); setPage(0); }}>
                <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="alle">Alle kalkyletyper</SelectItem>
                  {CALC_TYPES.map((c) => (
                    <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={kvalitetFilter} onValueChange={(v) => { setKvalitetFilter(v); setPage(0); }}>
                <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="alle">All kvalitet</SelectItem>
                  <SelectItem value="A">Kvalitet A</SelectItem>
                  <SelectItem value="B">Kvalitet B</SelectItem>
                  <SelectItem value="C">Kvalitet C</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">
                {nNum(filtered.length, 0)} varer
              </span>
            </div>

            {/* tabell */}
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[1450px] text-sm">
                <thead className="bg-muted/50 text-xs">
                  <tr className="border-b">
                    <Th label="Varenr" k="display_number" {...{ sortKey, sortAsc, toggleSort }} />
                    <Th label="Navn" k="navn" {...{ sortKey, sortAsc, toggleSort }} />
                    <Th label="Kategori" k="kategori" {...{ sortKey, sortAsc, toggleSort }} />
                    <Th label="Kalkyletype" k="calc_type" {...{ sortKey, sortAsc, toggleSort }} />
                    <Th label="Kvalitet" k="kvalitet" {...{ sortKey, sortAsc, toggleSort }} />
                    <Th label="Råvare" k="raavarekost" numeric {...{ sortKey, sortAsc, toggleSort }} />
                    <Th label="Arbeid" k="arbeidskost" numeric {...{ sortKey, sortAsc, toggleSort }} />
                    <Th label="Kostpris" k="kostpris" numeric {...{ sortKey, sortAsc, toggleSort }} />
                    <Th label="Pris" k="pris" numeric {...{ sortKey, sortAsc, toggleSort }} />
                    <Th label="Med emb." k="pris_med_emballasje" numeric {...{ sortKey, sortAsc, toggleSort }} />
                    <Th label="Brutto %" k="brutto_pct" numeric {...{ sortKey, sortAsc, toggleSort }} />
                    <Th label="DB2 kr" k="db2" numeric {...{ sortKey, sortAsc, toggleSort }} />
                    <Th label="DG2 %" k="dg2_pct" numeric {...{ sortKey, sortAsc, toggleSort }} />
                    <Th label="Mål" k="maal_dg2_pct" numeric {...{ sortKey, sortAsc, toggleSort }} />
                    <Th label="Avvik pp" k="avvik_pp" numeric {...{ sortKey, sortAsc, toggleSort }} />
                    <Th label="Nødv. pris" k="nodvendig_pris" numeric {...{ sortKey, sortAsc, toggleSort }} />
                    <th className="px-2 py-2 text-right font-medium">
                      <div className="flex items-center justify-end gap-1">
                        Ny pris
                        {Object.keys(simulated).length > 0 && (
                          <button
                            type="button"
                            onClick={() => setSimulated({})}
                            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                          >
                            <RotateCcw className="h-3 w-3" /> Nullstill
                          </button>
                        )}
                      </div>
                    </th>
                    <Th label="Status" k="status" {...{ sortKey, sortAsc, toggleSort }} />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <Row
                      key={r.product_id}
                      row={r}
                      simValue={simulated[r.product_id] ?? ""}
                      onSim={(v) =>
                        setSimulated((prev) => {
                          const next = { ...prev };
                          if (v === "") delete next[r.product_id];
                          else next[r.product_id] = v;
                          return next;
                        })
                      }
                      onOpen={() => setDetail(r)}
                    />
                  ))}
                  {!visible.length && (
                    <tr>
                      <td colSpan={18} className="px-3 py-10 text-center text-muted-foreground">
                        Ingen varer matcher filtrene.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-3 text-sm">
                <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                  Forrige
                </Button>
                <span className="text-muted-foreground">
                  Side {safePage + 1} av {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage(safePage + 1)}
                >
                  Neste
                </Button>
              </div>
            )}
          </>
        )}

        <DetailPanel row={detail} onClose={() => setDetail(null)} onOpenProduct={(id) => navigate(`/varer/vareliste/${id}?tab=kalkyle`)} />
      </div>
    </TooltipProvider>
  );
}

/* ---------------------------------------------------------------- deler */

function Th({
  label,
  k,
  numeric,
  sortKey,
  sortAsc,
  toggleSort,
}: {
  label: string;
  k: SortKey;
  numeric?: boolean;
  sortKey: SortKey;
  sortAsc: boolean;
  toggleSort: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th className={cn("px-2 py-2 font-medium", numeric ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {active && (sortAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );
}

const IKKE_SIMULERBARE_STATUSER = new Set(["mangler_kalkyle", "ikke_vurdert", "halvfabrikat"]);

function kanSimuleres(row: SheetRow) {
  if (row.raavarekost == null) return false;
  return !IKKE_SIMULERBARE_STATUSER.has(row.status ?? "");
}

const WARN_BELOW_PP = 3;

function simulate(row: SheetRow, price: number | null) {
  if (price == null || price <= 0) return null;
  if (!kanSimuleres(row)) return null;
  const raa = row.raavarekost ?? 0;
  const arb = row.arbeidskost ?? 0;
  const brutto = ((price - raa) / price) * 100;
  const db2 = price - raa - arb;
  const dg2 = (db2 / price) * 100;
  const maal = row.maal_dg2_pct;
  const avvik = maal == null ? null : dg2 - maal;
  const status =
    avvik == null ? "uten_maal" : avvik >= 0 ? "gronn" : avvik >= -WARN_BELOW_PP ? "gul" : "rod";
  return { brutto, db2, dg2, status };
}

function Row({
  row,
  simValue,
  onSim,
  onOpen,
}: {
  row: SheetRow;
  simValue: string;
  onSim: (v: string) => void;
  onOpen: () => void;
}) {
  const simulerbar = kanSimuleres(row);
  const sim = simulate(row, parseNum(simValue));
  const calc = CALC_MAP[row.calc_type ?? ""];
  const status = sim ? STATUS_MAP[sim.status] : STATUS_MAP[row.status ?? ""];
  const dg2UnderMaal =
    row.dg2_pct != null && row.maal_dg2_pct != null && row.dg2_pct < row.maal_dg2_pct;

  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40"
      style={{ contentVisibility: "auto", containIntrinsicSize: "40px" }}
    >
      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{row.display_number ?? "—"}</td>
      <td className="max-w-[260px] truncate px-2 py-1.5 font-medium">{row.navn ?? "—"}</td>
      <td className="max-w-[160px] truncate px-2 py-1.5 text-muted-foreground">{row.kategori ?? "—"}</td>
      <td className="px-2 py-1.5">
        {calc ? (
          <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", calc.cls)}>{calc.label}</span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-2 py-1.5">{row.kvalitet ?? "—"}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{row.raavarekost == null ? "—" : nNum(row.raavarekost)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{row.arbeidskost == null ? "—" : nNum(row.arbeidskost)}</td>
      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{row.kostpris == null ? "—" : nNum(row.kostpris)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{row.pris == null ? "—" : nNum(row.pris)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
        {row.pris_med_emballasje == null ? "—" : nNum(row.pris_med_emballasje)}
      </td>
      <td className={cn("px-2 py-1.5 text-right font-semibold tabular-nums", sim && "text-blue-600 dark:text-blue-400")}>
        {sim ? nNum(sim.brutto, 1) : row.brutto_pct == null ? "—" : nNum(row.brutto_pct, 1)}
      </td>
      <td className={cn("px-2 py-1.5 text-right tabular-nums", sim && "text-blue-600 dark:text-blue-400")}>
        {sim ? nNum(sim.db2) : row.db2 == null ? "—" : nNum(row.db2)}
      </td>
      <td
        className={cn(
          "px-2 py-1.5 text-right font-semibold tabular-nums",
          sim ? "text-blue-600 dark:text-blue-400" : dg2UnderMaal && "text-destructive",
        )}
      >
        {sim ? nNum(sim.dg2, 1) : row.dg2_pct == null ? "—" : nNum(row.dg2_pct, 1)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
        {row.maal_brutto_pct == null && row.maal_dg2_pct == null ? (
          "—"
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help border-b border-dotted">
                {row.maal_brutto_pct == null ? "—" : nNum(row.maal_brutto_pct, 0)}/
                {row.maal_dg2_pct == null ? "—" : nNum(row.maal_dg2_pct, 0)}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {MAAL_KILDE_TEKST[row.maal_kilde ?? ""] ?? "Ukjent målkilde"}
            </TooltipContent>
          </Tooltip>
        )}
      </td>
      <td
        className={cn(
          "px-2 py-1.5 text-right tabular-nums",
          row.avvik_pp == null
            ? "text-muted-foreground"
            : row.avvik_pp < 0
            ? "text-destructive"
            : "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {row.avvik_pp == null ? "—" : nNum(row.avvik_pp, 1)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {row.nodvendig_pris == null ? "—" : nNum(row.nodvendig_pris)}
      </td>
      <td className="px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
        {simulerbar ? (
          <Input
            value={simValue}
            onChange={(e) => onSim(e.target.value)}
            placeholder="—"
            inputMode="decimal"
            className="h-7 w-[86px] text-right text-xs"
          />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block cursor-not-allowed">
                <Input
                  value=""
                  disabled
                  placeholder="—"
                  className="pointer-events-none h-7 w-[86px] text-right text-xs"
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>Kan ikke simuleres uten kalkyle</TooltipContent>
          </Tooltip>
        )}
      </td>
      <td className="px-2 py-1.5">
        {status ? (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px] font-medium",
              status.cls,
              sim && "ring-1 ring-blue-400",
            )}
          >
            {status.label}
          </span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

function DetailPanel({
  row,
  onClose,
  onOpenProduct,
}: {
  row: SheetRow | null;
  onClose: () => void;
  onOpenProduct: (id: string) => void;
}) {
  const kost = (row?.kostpris ?? 0) || 1;
  const calc = row ? CALC_MAP[row.calc_type ?? ""] : null;
  const status = row ? STATUS_MAP[row.status ?? ""] : null;

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle className="pr-6 text-left">{row.navn ?? "Uten navn"}</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {calc && <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", calc.cls)}>{calc.label}</span>}
                {row.kvalitet && <Badge variant="outline">Kvalitet {row.kvalitet}</Badge>}
                {status && <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", status.cls)}>{status.label}</span>}
                <span className="text-xs text-muted-foreground">Varenr {row.display_number ?? "—"}</span>
              </div>

              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Kostnader</div>
                <table className="w-full">
                  <tbody>
                    {([
                      ["Råvarer", row.raavarekost],
                      ["Arbeid", row.arbeidskost],
                      ["Emballasje", row.emballasjekost],
                    ] as const).map(([label, val]) => (
                      <tr key={label} className="border-b last:border-0">
                        <td className="py-1">{label}</td>
                        <td className="py-1 text-right tabular-nums">{val == null ? "—" : nKr(val)}</td>
                        <td className="w-14 py-1 text-right text-xs text-muted-foreground">
                          {val == null ? "—" : nPct((val / kost) * 100, 0)}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-1 font-semibold">Kostpris</td>
                      <td className="py-1 text-right font-semibold tabular-nums">
                        {row.kostpris == null ? "—" : nKr(row.kostpris)}
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>

              {row.antall_per_bakst != null && (
                <div className="text-muted-foreground">
                  Antall per bakst: <strong className="text-foreground">{nNum(row.antall_per_bakst, 0)}</strong>
                </div>
              )}

              <div className="rounded-lg border p-3">
                <div className="mb-1 text-xs font-medium text-muted-foreground">Margin</div>
                <div>
                  Pris {row.pris == null ? "—" : nKr(row.pris)} → Brutto{" "}
                  <strong>{row.brutto_pct == null ? "—" : nPct(row.brutto_pct)}</strong>
                </div>
                <div>
                  DB2 {row.db2 == null ? "—" : nKr(row.db2)} · DG2{" "}
                  <strong>{row.dg2_pct == null ? "—" : nPct(row.dg2_pct)}</strong> mot mål{" "}
                  {row.maal_dg2_pct == null ? "—" : nPct(row.maal_dg2_pct, 0)}
                </div>
                <div
                  className={cn(
                    "mt-1 text-xs",
                    (row.avvik_pp ?? 0) < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
                  )}
                >
                  Avvik {row.avvik_pp == null ? "—" : `${nNum(row.avvik_pp, 1)} pp`}
                  {row.maal_kilde && (
                    <span className="text-muted-foreground"> · {MAAL_KILDE_TEKST[row.maal_kilde] ?? row.maal_kilde}</span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-muted-foreground">Nødvendig pris</div>
                <div>
                  {row.nodvendig_pris == null ? "—" : nKr(row.nodvendig_pris)}
                  {row.nodvendig_endring_pct != null && (
                    <span className="text-muted-foreground"> ({nPct(row.nodvendig_endring_pct)})</span>
                  )}
                </div>
              </div>

              {!!row.merknader?.length && (
                <ul className="space-y-1">
                  {row.merknader.map((m) => (
                    <li key={m} className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{m}</span>
                    </li>
                  ))}
                </ul>
              )}

              <Button variant="outline" className="w-full" onClick={() => onOpenProduct(row.product_id)}>
                <ExternalLink className="mr-1.5 h-4 w-4" />
                Åpne varekortet
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
