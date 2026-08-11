import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppHeaderBanner } from "@/varer/components/layout/AppHeaderBanner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { osloTodayISO } from "@/lib/osloDate";
import { nKr, nNum, nPct } from "@/varer/lib/calcFormat";
import { useAppContext } from "@/varer/context/AppContext";
import {
  ROUND_STATUS_META,
  usePriceRounds,
  usePriceRoundSummaries,
} from "@/varer/hooks/usePriceRounds";

interface SheetRow {
  product_id: string;
  display_number: number | null;
  navn: string | null;
  kategori: string | null;
  calc_type: string | null;
  kostpris: number | null;
  pris: number | null;
  brutto_pct: number | null;
  dg2_pct: number | null;
  maal_dg2_pct: number | null;
  avvik_pp: number | null;
  nodvendig_pris: number | null;
  status: string | null;
}

const DEFAULT_LIST_CODE = "nb_butikker";

const STATUS_META: Record<string, { label: string; cls: string; bar: string }> = {
  gronn: {
    label: "Over mål",
    cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    bar: "bg-emerald-500",
  },
  gul: {
    label: "Nær mål",
    cls: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
    bar: "bg-amber-500",
  },
  rod: { label: "Under mål", cls: "bg-destructive/15 text-destructive", bar: "bg-destructive" },
  ingen_pris: { label: "Ingen pris", cls: "bg-muted text-muted-foreground", bar: "bg-muted-foreground/50" },
  ikke_vurdert: { label: "Ikke vurdert", cls: "bg-muted text-muted-foreground", bar: "bg-muted-foreground/40" },
  halvfabrikat: { label: "Halvfabrikat", cls: "bg-purple-700/20 text-purple-900 dark:text-purple-300", bar: "bg-purple-500" },
  mangler_kalkyle: { label: "Mangler kalkyle", cls: "bg-destructive/10 text-destructive", bar: "bg-destructive/60" },
};

const MED_KALKYLE = new Set(["oppskrift", "arvet", "handelsvare", "bakeoff", "sammensatt", "manuell"]);

function nDato(v: string | null | undefined) {
  return v ? new Date(v).toLocaleDateString("nb-NO") : "—";
}

export default function ProfitabilityDashboard() {
  const navigate = useNavigate();
  const { legalEntityId } = useAppContext();
  const [priceListId, setPriceListId] = useState("");
  const date = osloTodayISO();

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
    priceListId || lists.find((l) => l.code === DEFAULT_LIST_CODE)?.id || lists[0]?.id || "";

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

  const roundsQuery = usePriceRounds(legalEntityId, 5);
  const rounds = roundsQuery.data ?? [];
  const summaries = usePriceRoundSummaries(rounds.map((r) => r.id));

  useEffect(() => {
    if (sheetQuery.error) toast.error("Kunne ikke hente lønnsomhetsdata");
  }, [sheetQuery.error]);

  const rows = useMemo(() => sheetQuery.data ?? [], [sheetQuery.data]);

  const kpi = useMemo(() => {
    const total = rows.length;
    const medKalkyle = rows.filter(
      (r) => MED_KALKYLE.has(r.calc_type ?? "") && r.kostpris != null,
    ).length;
    const brutto = rows.filter((r) => r.brutto_pct != null).map((r) => r.brutto_pct!);
    const dg2 = rows.filter((r) => r.dg2_pct != null).map((r) => r.dg2_pct!);
    const underMaal = rows.filter((r) => r.avvik_pp != null && r.avvik_pp < 0);
    const tapt = underMaal.reduce((sum, r) => {
      if (r.nodvendig_pris == null || r.pris == null) return sum;
      return sum + Math.max(0, r.nodvendig_pris - r.pris);
    }, 0);
    const snitt = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    return {
      total,
      medKalkyle,
      dekning: total ? (medKalkyle / total) * 100 : 0,
      snittBrutto: snitt(brutto),
      snittDg2: snitt(dg2),
      underMaal: underMaal.length,
      tapt,
    };
  }, [rows]);

  const fordeling = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of rows) map[r.status ?? "ikke_vurdert"] = (map[r.status ?? "ikke_vurdert"] ?? 0) + 1;
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const verstinger = useMemo(
    () =>
      rows
        .filter((r) => r.avvik_pp != null)
        .sort((a, b) => a.avvik_pp! - b.avvik_pp!)
        .slice(0, 10),
    [rows],
  );

  const laster = listsQuery.isLoading || sheetQuery.isLoading;

  return (
    <div className="space-y-5 pb-16">
      <AppHeaderBanner
        title="Lønnsomhetsdashbord"
        subtitle="Kalkyledekning, marginer og prisrunder"
        actions={
          <div className="flex items-center gap-2">
            <Select value={activeListId} onValueChange={setPriceListId}>
              <SelectTrigger className="h-9 w-[210px]">
                <SelectValue placeholder="Prisliste" />
              </SelectTrigger>
              <SelectContent>
                {lists.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => navigate("/varer/lonnsomhet")}>
              Åpne lønnsomhetsarket
            </Button>
          </div>
        }
      />

      {laster ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-[360px] w-full" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Kalkyledekning"
              value={nPct(kpi.dekning)}
              hint={`${nNum(kpi.medKalkyle, 0)} av ${nNum(kpi.total, 0)} varer`}
              progress={kpi.dekning}
            />
            <Kpi
              label="Snitt bruttomargin"
              value={kpi.snittBrutto == null ? "—" : nPct(kpi.snittBrutto)}
              hint="Varer med pris og kalkyle"
            />
            <Kpi
              label="Snitt DG2"
              value={kpi.snittDg2 == null ? "—" : nPct(kpi.snittDg2)}
              hint="Dekningsgrad etter arbeid"
            />
            <Kpi
              label="Varer under mål"
              value={nNum(kpi.underMaal, 0)}
              hint={`Prisgap ${nKr(kpi.tapt)} per enhet totalt`}
              tone="danger"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold">Statusfordeling</h2>
              <div className="space-y-2">
                {fordeling.map(([status, antall]) => {
                  const meta = STATUS_META[status] ?? {
                    label: status,
                    cls: "bg-muted text-muted-foreground",
                    bar: "bg-muted-foreground/40",
                  };
                  const pct = kpi.total ? (antall / kpi.total) * 100 : 0;
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => navigate("/varer/lonnsomhet")}
                      className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-muted/50"
                    >
                      <span className={cn("w-[130px] shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", meta.cls)}>
                        {meta.label}
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className={cn("block h-full rounded-full", meta.bar)}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                      <span className="w-[92px] shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                        {nNum(antall, 0)} · {nNum(pct, 0)} %
                      </span>
                    </button>
                  );
                })}
                {!fordeling.length && (
                  <p className="py-6 text-center text-sm text-muted-foreground">Ingen data.</p>
                )}
              </div>
            </section>

            <section className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Siste prisrunder</h2>
                <Button size="sm" variant="ghost" onClick={() => navigate("/varer/prisrunder")}>
                  Se alle
                </Button>
              </div>
              <div className="space-y-1">
                {rounds.map((r) => {
                  const meta = ROUND_STATUS_META[r.status] ?? {
                    label: r.status,
                    cls: "bg-muted text-muted-foreground",
                  };
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => navigate(`/varer/prisrunder/${r.id}`)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{r.name}</div>
                        <div className="text-xs text-muted-foreground">
                          Ikrafttredelse {nDato(r.effective_date)} ·{" "}
                          {nNum(summaries.data?.[r.id]?.antall ?? 0, 0)} varer
                        </div>
                      </div>
                      <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", meta.cls)}>
                        {meta.label}
                      </span>
                    </button>
                  );
                })}
                {!rounds.length && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Ingen prisrunder ennå.
                  </p>
                )}
              </div>
            </section>
          </div>

          <section className="rounded-xl border bg-card">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">
              Topp 10 negative avvik
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/50 text-xs">
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left font-medium">Varenr</th>
                    <th className="px-3 py-2 text-left font-medium">Navn</th>
                    <th className="px-3 py-2 text-left font-medium">Kategori</th>
                    <th className="px-3 py-2 text-right font-medium">DG2 %</th>
                    <th className="px-3 py-2 text-right font-medium">Mål %</th>
                    <th className="px-3 py-2 text-right font-medium">Avvik pp</th>
                    <th className="px-3 py-2 text-right font-medium">Pris</th>
                    <th className="px-3 py-2 text-right font-medium">Nødvendig pris</th>
                  </tr>
                </thead>
                <tbody>
                  {verstinger.map((r) => (
                    <tr
                      key={r.product_id}
                      onClick={() => navigate(`/varer/vareliste/${r.product_id}?tab=kalkyle`)}
                      className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {r.display_number ?? "—"}
                      </td>
                      <td className="max-w-[260px] truncate px-3 py-2 font-medium">{r.navn ?? "—"}</td>
                      <td className="max-w-[160px] truncate px-3 py-2 text-muted-foreground">
                        {r.kategori ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.dg2_pct == null ? "—" : nNum(r.dg2_pct, 1)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {r.maal_dg2_pct == null ? "—" : nNum(r.maal_dg2_pct, 1)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-destructive">
                        {r.avvik_pp == null ? "—" : nNum(r.avvik_pp, 1)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.pris == null ? "—" : nNum(r.pris)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.nodvendig_pris == null ? "—" : nNum(r.nodvendig_pris)}
                      </td>
                    </tr>
                  ))}
                  {!verstinger.length && (
                    <tr>
                      <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                        Ingen varer med negativt avvik.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  progress,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  progress?: number;
  tone?: "danger";
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </div>
      {progress != null && (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
      {hint && <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
