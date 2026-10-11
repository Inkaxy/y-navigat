import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Loader2, MoreHorizontal, RefreshCw, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { QueryState } from "@/components/common/QueryState";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { RawMaterialCreateSheet } from "@/ravarer/editors/RawMaterialCreateSheet";
import { LinkRawMaterialDialog } from "@/ravarer/components/matvaretabellen/LinkRawMaterialDialog";
import { useNutritionLinkFlow } from "@/ravarer/components/matvaretabellen/useNutritionLinkFlow";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import {
  useApplyMatvaretabellen, useMatvaretabellenFoods, useMatvaretabellenLinks, useSyncMatvaretabellen, type FoodLink, type FoodRow,
} from "@/ravarer/hooks/useMatvaretabellen";
import { formatDate, formatNumber } from "@/ravarer/lib/constants";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";
import { rankBySearch } from "@/lib/textSimilarity";
import { useNutritionCoverage } from "@/ravarer/hooks/useNutritionCoverage";
import { nutritionSourceLabel } from "@/ravarer/lib/nutritionSource";
import { paths } from "@/ravarer/lib/paths";
import { DataTable, type Column } from "@/ravarer/ui/DataTable";

const PAGE_SIZE = 50;
const g = (v: number | null) => (v == null ? "—" : formatNumber(v, 1));
const kcal = (v: number | null) => (v == null ? "—" : formatNumber(v, 0));

const NUTRIENTS: { id: keyof FoodRow; header: string; fmt: (v: number | null) => string }[] = [
  { id: "energy_kcal", header: "kcal", fmt: kcal },
  { id: "fat_g", header: "Fett", fmt: g },
  { id: "saturated_fat_g", header: "Mettet", fmt: g },
  { id: "carbs_g", header: "Karbo", fmt: g },
  { id: "sugars_g", header: "Sukkerarter", fmt: g },
  { id: "fiber_g", header: "Fiber", fmt: g },
  { id: "protein_g", header: "Protein", fmt: g },
  { id: "salt_g", header: "Salt", fmt: g },
  { id: "water_g", header: "Vann", fmt: g },
];
const numOf = (f: FoodRow, k: keyof FoodRow): number | null => { const v = f[k]; return typeof v === "number" ? v : null; };

/** Dekning: tall bare når data finnes — lasting/feil vises aldri som 0 %. */
function CoverageCard() {
  const coverage = useNutritionCoverage();
  const d = coverage.data;
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-3 md:p-4">
      <div className="min-w-0">
        <div className="text-sm text-ink-secondary">Dekning næringsdata</div>
        {coverage.isLoading ? (
          <div className="text-sm text-ink-secondary"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-hidden />Laster dekning…</div>
        ) : coverage.isError || !d ? (
          <div className="text-sm text-destructive">
            Kunne ikke hente dekningen.{" "}
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => void coverage.refetch()}>Prøv igjen</Button>
          </div>
        ) : (
          <>
            <div className="text-xl font-semibold tabular-nums">{d.total > 0 ? `${Math.round((d.complete / d.total) * 100)} %` : "—"}</div>
            <div className="text-xs text-ink-secondary">
              {d.complete} av {d.total} matråvarer har fullstendig næringsdata · {d.incomplete} ufullstendige · {d.missing} mangler
            </div>
          </>
        )}
      </div>
      <Button asChild variant="outline"><Link to={paths.naering()}>Koble råvarer</Link></Button>
    </Card>
  );
}

function LinkStatus({ linked, loading, error }: { linked: FoodLink[]; loading: boolean; error: boolean }) {
  if (loading) return <span className="text-xs text-ink-secondary">Laster…</span>;
  if (error) return <span className="text-xs text-destructive">Ukjent</span>;
  if (linked.length === 0) return <span className="text-xs text-ink-secondary">—</span>;
  const names = linked.map((l) => l.raw_material_name).join(", ");
  return (
    <div className="min-w-0 max-w-[14rem]" title={names}>
      <Badge variant="outline" className="border-success/40 bg-success/10 text-success">Koblet{linked.length > 1 ? ` · ${linked.length}` : ""}</Badge>
      <div className="truncate text-xs text-ink-secondary">{names}</div>
    </div>
  );
}

/** Verktøy: Matvaretabellen (R108–R115). Felles DataTable med mobilkort; skrivehandlinger krever skrivetilgang. */
export default function Matvaretabellen() {
  const { canWrite } = useRavarer();
  const foodsQ = useMatvaretabellenFoods();
  const foods = useMemo(() => foodsQ.data ?? [], [foodsQ.data]);
  const linksQ = useMatvaretabellenLinks();
  const sync = useSyncMatvaretabellen();
  const apply = useApplyMatvaretabellen();

  const [q, setQ] = useState("");
  const debounced = useDebouncedValue(q, 250);
  const [group, setGroup] = useState("all");
  const [page, setPage] = useState(0);
  const [linkFood, setLinkFood] = useState<FoodRow | null>(null);
  const [createFood, setCreateFood] = useState<FoodRow | null>(null);
  /** «Bruk eksisterende» fra opprettelsesarket: samme gjennomgåtte flyt (kildesjekk + bekreftelse). */
  const [existing, setExisting] = useState<{ food: FoodRow; rawMaterialId: string } | null>(null);
  const existingFlow = useNutritionLinkFlow(existing?.food.food_id ?? null, !!existing, () => setExisting(null));
  const { choose: chooseExisting } = existingFlow;
  // Kjøres etter at flyten har startet ny økt for denne matvaren (effektrekkefølge), så sjekken tilhører økten.
  useEffect(() => {
    if (existing) void chooseExisting(existing.rawMaterialId, "valgt råvare");
  }, [existing, chooseExisting]);
  /** Ny råvare er opprettet, men koblingen feilet: prøv koblingen igjen uten å opprette på nytt. */
  const [createdUnlinked, setCreatedUnlinked] = useState<{ rawMaterialId: string; food: FoodRow } | null>(null);

  const groups = useMemo(
    () => Array.from(new Set(foods.map((f) => f.food_group_name).filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b, "nb")),
    [foods],
  );
  const lastSynced = useMemo(() => {
    let max: string | null = null;
    for (const f of foods) if (f.synced_at && (!max || f.synced_at > max)) max = f.synced_at;
    return max;
  }, [foods]);
  const filtered = useMemo(() => {
    const inGroup = group === "all" ? foods : foods.filter((f) => f.food_group_name === group);
    const needle = debounced.trim();
    if (!needle) return inGroup;
    // Rangert søk uten diakritika: «creme» treffer «crème».
    return rankBySearch(inGroup, needle, (f) => [f.food_name, ...(f.search_keywords ?? [])]);
  }, [foods, debounced, group]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const rows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const linkedOf = (f: FoodRow) => linksQ.data?.get(f.food_id) ?? [];

  const tryLinkCreated = async (rawMaterialId: string, food: FoodRow) => {
    try {
      await apply.mutateAsync({ rawMaterialId, foodId: food.food_id });
      setCreatedUnlinked(null);
    } catch (e: unknown) {
      console.error("[matvaretabellen:koble-ny]", e);
      setCreatedUnlinked({ rawMaterialId, food });
    }
  };

  const actions = (f: FoodRow) => (
    <div className="flex items-center justify-end gap-1">
      {/* Kildelenken er lesing og vises også uten skrivetilgang. */}
      {f.uri && (
        <Button asChild variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9">
          <a href={f.uri} target="_blank" rel="noreferrer" aria-label={`Åpne ${f.food_name} i Matvaretabellen`}><ExternalLink className="h-4 w-4" aria-hidden /></a>
        </Button>
      )}
      {canWrite && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9" aria-label={`Handlinger for ${f.food_name}`}>
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setLinkFood(f)}>Koble til eksisterende råvare</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCreateFood(f)}>Opprett som ny råvare</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );

  const columns: Column<FoodRow>[] = [
    { id: "food", header: "Matvare", alwaysVisible: true, csv: (f) => f.food_name,
      cell: (f) => <div className="min-w-[12rem] max-w-[20rem]"><div className="truncate font-medium" title={f.food_name}>{f.food_name}</div><div className="truncate text-xs text-ink-secondary">{f.food_group_name ?? "—"}</div></div> },
    ...NUTRIENTS.map((n) => ({ id: String(n.id), header: n.header, align: "right" as const, csv: (f: FoodRow) => n.fmt(numOf(f, n.id)), cell: (f: FoodRow) => n.fmt(numOf(f, n.id)) })),
    { id: "status", header: "Status", cell: (f) => <LinkStatus linked={linkedOf(f)} loading={linksQ.isLoading} error={linksQ.isError} /> },
    { id: "actions", header: "", alwaysVisible: true, cell: actions },
  ];

  return (
    <div className="space-y-3">
      <RavarerHeaderBanner />

      <Card className="p-3 md:p-4">
        <div className="flex flex-wrap items-end gap-2 md:gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" aria-hidden />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Søk matvare eller stikkord…" className="h-11 pl-9" aria-label="Søk i Matvaretabellen" />
          </div>
          <Select value={group} onValueChange={(v) => { setGroup(v); setPage(0); }}>
            <SelectTrigger className="h-11 w-full sm:w-[240px]" aria-label="Matvaregruppe"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle matvaregrupper</SelectItem>
              {groups.map((gr) => <SelectItem key={gr} value={gr}>{gr}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex w-full flex-wrap items-center gap-3 sm:ml-auto sm:w-auto">
            <span className="text-xs text-ink-secondary">Sist oppdatert: {foodsQ.isLoading ? "…" : lastSynced ? formatDate(lastSynced) : "—"}</span>
            {canWrite && (
              <Button variant="outline" className="h-11" disabled={sync.isPending} onClick={() => sync.mutate()}>
                {sync.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />}
                Oppdater fra Matvaretabellen
              </Button>
            )}
          </div>
        </div>
      </Card>

      <CoverageCard />

      {linksQ.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Kunne ikke hente koblinger — statuskolonnen viser «Ukjent».
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => void linksQ.refetch()}>Prøv igjen</Button>
        </div>
      )}

      {createdUnlinked && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          Råvaren er opprettet, men koblingen til «{createdUnlinked.food.food_name}» feilet. Den blir ikke opprettet på nytt.
          <Button size="sm" variant="outline" disabled={apply.isPending || !canWrite} onClick={() => void tryLinkCreated(createdUnlinked.rawMaterialId, createdUnlinked.food)}>Prøv koblingen igjen</Button>
          <Button size="sm" variant="ghost" onClick={() => setCreatedUnlinked(null)}>Lukk</Button>
        </div>
      )}

      <QueryState
        isLoading={foodsQ.isLoading}
        isError={foodsQ.isError}
        error={foodsQ.error}
        onRetry={() => void foodsQ.refetch()}
        scope="ravarer:matvaretabellen"
        isEmpty={false}
      >
        <DataTable
          ariaLabel="Matvaretabellen"
          rows={rows}
          columns={columns}
          getId={(f) => f.food_id}
          emptyText={foods.length === 0 ? "Matvaretabellen er tom — oppdater fra Matvaretabellen." : "Ingen matvarer matcher søket."}
          dense
          minTableWidth="1000px"
          renderMobileCard={(f) => (
            <div className="flex items-start justify-between gap-2 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <p className="font-medium [overflow-wrap:anywhere]">{f.food_name}</p>
                <p className="text-xs text-ink-secondary">{f.food_group_name ?? "—"} · {kcal(f.energy_kcal)} kcal · protein {g(f.protein_g)} · fett {g(f.fat_g)}</p>
                <div className="mt-1"><LinkStatus linked={linkedOf(f)} loading={linksQ.isLoading} error={linksQ.isError} /></div>
              </div>
              {actions(f)}
            </div>
          )}
          footer={
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-ink-secondary">{filtered.length} matvarer · side {safePage + 1} av {pageCount}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-11 md:h-9" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Forrige</Button>
                <Button variant="outline" size="sm" className="h-11 md:h-9" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Neste</Button>
              </div>
            </div>
          }
        />
      </QueryState>

      <p className="text-xs text-ink-secondary">Kilde: Matvaretabellen (matvaretabellen.no), Mattilsynet.</p>

      {linkFood && (
        <LinkRawMaterialDialog open={!!linkFood} onOpenChange={(v) => !v && setLinkFood(null)} foodId={linkFood.food_id} foodName={linkFood.food_name} initialQuery={linkFood.food_name} />
      )}

      {createFood && (
        <RawMaterialCreateSheet
          open={!!createFood}
          onOpenChange={(v) => { if (!v) setCreateFood(null); }}
          context={{ kind: "standalone", prefill: { name: createFood.food_name, openAfterSave: false } }}
          onDone={(id) => {
            const food = createFood;
            setCreateFood(null);
            // Ny råvare har ingen næringskilde: vanlig kobling (force=false). Feil → «Prøv igjen», ikke ny råvare.
            if (id) void tryLinkCreated(id, food);
          }}
          onUseExisting={(id) => {
            const food = createFood;
            setCreateFood(null);
            setExisting({ food, rawMaterialId: id });
          }}
        />
      )}

      <AlertDialog open={!!existingFlow.pending} onOpenChange={(v) => { if (!v) { existingFlow.cancelOverwrite(); setExisting(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Overskrive næringsdata?</AlertDialogTitle>
            <AlertDialogDescription>
              Råvaren har allerede næringsdata (kilde: {nutritionSourceLabel(existingFlow.pending?.source ?? null)}). Med «Overskriv» erstattes også beskyttede felt med tall fra Matvaretabellen. Avbryt endrer ingenting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={() => void existingFlow.confirmOverwrite()}>Overskriv</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
