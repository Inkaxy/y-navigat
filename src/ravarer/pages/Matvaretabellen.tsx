import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, MoreHorizontal, RefreshCw, Search } from "lucide-react";

import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { NewRawMaterialDialog } from "@/ravarer/components/NewRawMaterialDialog";
import { LinkRawMaterialDialog } from "@/ravarer/components/matvaretabellen/LinkRawMaterialDialog";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import {
  useApplyMatvaretabellen,
  useMatvaretabellenFoods,
  useMatvaretabellenLinks,
  useSyncMatvaretabellen,
  type FoodRow,
} from "@/ravarer/hooks/useMatvaretabellen";
import { formatDate, formatNumber } from "@/ravarer/lib/constants";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";
import { rankBySearch } from "@/lib/textSimilarity";
import { useNutritionCoverage } from "@/ravarer/hooks/useNutritionCoverage";
import { Link } from "react-router-dom";

const PAGE_SIZE = 50;

const g = (v: number | null) => (v == null ? "—" : formatNumber(v, 1));
const kcal = (v: number | null) => (v == null ? "—" : formatNumber(v, 0));

export default function Matvaretabellen() {
  const { canWrite } = useRavarer();
  const { data: foods = [], isLoading } = useMatvaretabellenFoods();
  const { data: links, isLoading: linksLoading, isError: linksError, error: linksErrorObj } = useMatvaretabellenLinks();
  const sync = useSyncMatvaretabellen();
  const apply = useApplyMatvaretabellen();
  const coverage = useNutritionCoverage();

  const [q, setQ] = useState("");
  const debounced = useDebouncedValue(q, 250);
  const [group, setGroup] = useState("all");
  const [page, setPage] = useState(0);

  const [linkFood, setLinkFood] = useState<FoodRow | null>(null);
  const [createFood, setCreateFood] = useState<FoodRow | null>(null);

  const groups = useMemo(
    () =>
      Array.from(new Set(foods.map((f) => f.food_group_name).filter((v): v is string => !!v))).sort((a, b) =>
        a.localeCompare(b, "nb"),
      ),
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

  const resetPage = () => setPage(0);

  return (
    <div className="space-y-5">
      <RavarerHeaderBanner />

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                resetPage();
              }}
              placeholder="Søk matvare eller stikkord…"
              className="h-11 pl-9"
            />
          </div>
          <Select
            value={group}
            onValueChange={(v) => {
              setGroup(v);
              resetPage();
            }}
          >
            <SelectTrigger className="h-11 w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle matvaregrupper</SelectItem>
              {groups.map((gr) => (
                <SelectItem key={gr} value={gr}>
                  {gr}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-ink-secondary">
              Sist oppdatert: {lastSynced ? formatDate(lastSynced) : "—"}
            </span>
            {canWrite && (
              <Button variant="outline" className="h-11" disabled={sync.isPending} onClick={() => sync.mutate()}>
                {sync.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                )}
                Oppdater fra Matvaretabellen
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <div className="text-sm text-ink-secondary">Dekning næringsdata</div>
          <div className="text-xl font-semibold tabular-nums">
            {coverage.data && coverage.data.total > 0
              ? `${Math.round((coverage.data.complete / coverage.data.total) * 100)} %`
              : "—"}
          </div>
          <div className="text-xs text-ink-secondary">
            {coverage.data?.complete ?? 0} av {coverage.data?.total ?? 0} matråvarer har fullstendig næringsdata ·{" "}
            {coverage.data?.incomplete ?? 0} ufullstendige · {coverage.data?.missing ?? 0} mangler
          </div>
        </div>
        <Button asChild variant="outline">
          <Link to="/ravarer/koble-matvaretabellen">Koble råvarer</Link>
        </Button>
      </Card>

      {linksError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Kunne ikke hente koblinger: {(linksErrorObj as any)?.message ?? "ukjent feil"} — statuskolonnen kan vise feil.
        </div>
      )}

      <Card className="overflow-hidden">

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-subtle text-xs uppercase tracking-wider text-ink-secondary">
                <th className="px-3 py-2.5 text-left font-semibold">Matvare</th>
                <th className="px-3 py-2.5 text-right font-semibold">kcal</th>
                <th className="px-3 py-2.5 text-right font-semibold">Fett</th>
                <th className="px-3 py-2.5 text-right font-semibold">Mettet</th>
                <th className="px-3 py-2.5 text-right font-semibold">Karbo</th>
                <th className="px-3 py-2.5 text-right font-semibold">Sukkerarter</th>
                <th className="px-3 py-2.5 text-right font-semibold">Fiber</th>
                <th className="px-3 py-2.5 text-right font-semibold">Protein</th>
                <th className="px-3 py-2.5 text-right font-semibold">Salt</th>
                <th className="px-3 py-2.5 text-right font-semibold">Vann</th>
                <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                <th className="w-10 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-ink-secondary">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-ink-secondary">
                    Ingen matvarer matcher søket.
                  </td>
                </tr>
              ) : (
                rows.map((f, i) => {
                  const linked = links?.get(f.food_id) ?? [];
                  return (
                    <tr key={f.food_id} className={`border-b border-line-subtle/60 ${i % 2 === 1 ? "bg-muted/30" : ""}`}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{f.food_name}</div>
                        <div className="text-xs text-ink-secondary">{f.food_group_name ?? "—"}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{kcal(f.energy_kcal)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{g(f.fat_g)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{g(f.saturated_fat_g)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{g(f.carbs_g)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{g(f.sugars_g)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{g(f.fiber_g)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{g(f.protein_g)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{g(f.salt_g)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{g(f.water_g)}</td>
                      <td className="px-3 py-2">
                        {linksLoading ? (
                          <span className="text-xs text-ink-secondary">Laster…</span>
                        ) : linksError ? (
                          <span className="text-xs text-destructive">Ukjent</span>
                        ) : linked.length > 0 && (

                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="inline-block max-w-[220px] cursor-default">
                                  <Badge
                                    className="border-success/40 bg-success/10 text-success"
                                    variant="outline"
                                  >
                                    Koblet{linked.length > 1 ? ` · ${linked.length}` : ""}
                                  </Badge>
                                  <div className="truncate text-xs text-ink-secondary">
                                    {linked.map((l) => l.raw_material_name).join(", ")}
                                  </div>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                {linked.map((l) => (
                                  <div key={l.raw_material_id}>{l.raw_material_name}</div>
                                ))}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canWrite && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setLinkFood(f)}>
                                Koble til eksisterende råvare
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setCreateFood(f)}>Opprett som ny råvare</DropdownMenuItem>
                              {f.uri && (
                                <DropdownMenuItem asChild>
                                  <a href={f.uri} target="_blank" rel="noreferrer">
                                    Åpne i Matvaretabellen
                                  </a>
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-line-subtle px-3 py-2.5 text-sm">
          <span className="text-ink-secondary">
            {filtered.length} matvarer · side {safePage + 1} av {pageCount}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              Forrige
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Neste
            </Button>
          </div>
        </div>
      </Card>

      <p className="text-xs text-ink-secondary">Kilde: Matvaretabellen (matvaretabellen.no), Mattilsynet.</p>

      {linkFood && (
        <LinkRawMaterialDialog
          open={!!linkFood}
          onOpenChange={(v) => !v && setLinkFood(null)}
          foodId={linkFood.food_id}
          foodName={linkFood.food_name}
          initialQuery={linkFood.food_name}
        />
      )}

      {createFood && (
        <NewRawMaterialDialog
          open={!!createFood}
          onOpenChange={(v) => !v && setCreateFood(null)}
          initialName={createFood.food_name}
          onCreated={async (id) => {
            const foodId = createFood.food_id;
            setCreateFood(null);
            await apply.mutateAsync({ rawMaterialId: id, foodId });
          }}
        />
      )}
    </div>
  );
}
