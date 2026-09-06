import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useGuardedNavigate } from "@/providers/UnsavedGuardProvider";
import { QueryState } from "@/components/common/QueryState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  X,
} from "lucide-react";
import { useRenameRawMaterial } from "@/ravarer/hooks/useRawMaterials";
import { useRawMaterialPage } from "@/ravarer/hooks/useRawMaterialPage";
import { useRawMaterialPurchaseStats } from "@/ravarer/hooks/usePurchaseStats";
import { useVarelisteItems } from "@/ravarer/hooks/useVarelisteItems";
import {
  filterAndSortItems,
  parseListQuery,
} from "@/ravarer/lib/rawMaterialViews";
import { RawMaterialKpiStrip } from "@/ravarer/components/RawMaterialKpiStrip";
import { OverviewTab } from "@/ravarer/components/tabs/OverviewTab";
import { NutritionTab } from "@/ravarer/components/tabs/NutritionTab";
import { SuppliersTab } from "@/ravarer/components/tabs/SuppliersTab";
import { RecipesTab } from "@/ravarer/components/tabs/RecipesTab";
import { StockTab } from "@/ravarer/components/tabs/StockTab";
import { HistoryTab } from "@/ravarer/components/tabs/HistoryTab";

const ITEM_TYPE_LABEL: Record<string, string> = {
  ravare: "Råvare",
  emballasje: "Emballasje",
  forbruksvare: "Forbruksvare",
  videresalg: "Videresalg",
};

export default function RawMaterialDetail() {
  const { id } = useParams();
  const navigate = useGuardedNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "overview";

  const page = useRawMaterialPage(id);
  const rm = page.rm;
  const rename = useRenameRawMaterial();
  const { data: stats } = useRawMaterialPurchaseStats(id);
  const { items } = useVarelisteItems();

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const saveRef = useRef<(() => void) | null>(null);

  /** Listerekkefølgen fra varelisten — filtrene ligger i URL-en. */
  const listSearch = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("tab");
    return next.toString();
  }, [searchParams]);

  const ordered = useMemo(
    () =>
      filterAndSortItems(
        items,
        parseListQuery(new URLSearchParams(listSearch)),
      ),
    [items, listSearch],
  );

  const index = ordered.findIndex((i) => i.id === id);
  const prev = index > 0 ? ordered[index - 1] : null;
  const next =
    index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;

  const goTo = useCallback(
    (targetId: string) =>
      navigate(
        `/ravarer/vareliste/${targetId}${listSearch ? `?${listSearch}` : ""}`,
      ),
    [navigate, listSearch],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current?.();
        return;
      }
      if (typing || e.altKey || e.metaKey || e.ctrlKey) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="listbox"]')) return;
      if (e.key === "[" && prev) goTo(prev.id);
      if (e.key === "]" && next) goTo(next.id);

    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, goTo]);

  if (page.isLoading || page.isError || !rm) {
    return (
      <QueryState
        isLoading={page.isLoading}
        isError={page.isError}
        error={page.error}
        onRetry={() => page.refetch()}
        scope="Råvaren"
        isEmpty={!rm}
        emptyTitle="Råvaren ble ikke funnet"
        emptyDescription="Den kan være slettet, eller lenken kan være feil."
        loadingFallback={
          <div className="flex justify-center p-12">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        }
      >
        {null}
      </QueryState>
    );
  }

  const startEdit = () => {
    setNameDraft(rm.name);
    setEditingName(true);
  };
  const saveName = async () => {
    const v = nameDraft.trim();
    if (!v || v === rm.name) {
      setEditingName(false);
      return;
    }
    await rename.mutateAsync({ id: rm.id, name: v });
    setEditingName(false);
  };

  const chips: Array<{ label: string; tone: "ok" | "warn" | "muted" }> = [
    {
      label: rm.is_active ? "Aktiv" : "Inaktiv",
      tone: rm.is_active ? "ok" : "warn",
    },
    { label: ITEM_TYPE_LABEL[rm.item_type] ?? rm.item_type, tone: "muted" },
    ...(rm.categories ?? []).map((c) => ({ label: c, tone: "muted" as const })),
    {
      label: rm.declaration_name
        ? "Deklarasjonsnavn"
        : "Mangler deklarasjonsnavn",
      tone: rm.declaration_name ? "ok" : "warn",
    },
    {
      label: page.hasDatasheet ? "Datablad" : "Mangler datablad",
      tone: page.hasDatasheet ? "ok" : "warn",
    },
    {
      label:
        page.allergenCount > 0
          ? `${page.allergenCount} allergener`
          : "Ingen allergener",
      tone: page.allergenCount > 0 ? "ok" : "muted",
    },
    {
      label: page.hasNutrition ? "Næring" : "Mangler næring",
      tone: page.hasNutrition ? "ok" : "warn",
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Råvarer"
        title={rm.name}
        subtitle={`SKU ${rm.sku} · ${rm.base_unit}`}
        crumbs={[
          { label: "Råvarer", to: "/ravarer/vareliste" },
          {
            label: "Vareliste",
            to: `/ravarer/vareliste${listSearch ? `?${listSearch}` : ""}`,
          },
          { label: rm.name },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                navigate(
                  `/ravarer/vareliste${listSearch ? `?${listSearch}` : ""}`,
                )
              }
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Tilbake
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Forrige råvare"
              title="Forrige råvare ( [ )"
              disabled={!prev}
              onClick={() => prev && goTo(prev.id)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Neste råvare"
              title="Neste råvare ( ] )"
              disabled={!next}
              onClick={() => next && goTo(next.id)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {!editingName && (
              <Button variant="outline" size="sm" onClick={startEdit}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Endre navn
              </Button>
            )}
          </div>
        }
      />

      {editingName && (
        <div className="flex items-center gap-2">
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveName();
              if (e.key === "Escape") setEditingName(false);
            }}
            autoFocus
            className="h-11 max-w-xl text-2xl font-semibold tracking-tight"
            style={{ letterSpacing: "-0.02em" }}
            aria-label="Nytt navn"
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label="Lagre navn"
            onClick={() => void saveName()}
            disabled={rename.isPending}
          >
            <Check className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Avbryt"
            onClick={() => setEditingName(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <Badge
            key={c.label}
            variant="outline"
            className={
              c.tone === "warn"
                ? "border-warning/50 text-warning"
                : c.tone === "ok"
                  ? "border-success/50 text-success"
                  : undefined
            }
          >
            {c.label}
          </Badge>
        ))}
      </div>

      <RawMaterialKpiStrip
        rm={rm}
        links={page.links}
        recipeCount={page.recipeCount}
        spend12m={stats?.cost_12m ?? null}
      />

      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next2 = new URLSearchParams(searchParams);
          if (v === "overview") next2.delete("tab");
          else next2.set("tab", v);
          setSearchParams(next2, { replace: true });
        }}
      >
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Oversikt</TabsTrigger>
          <TabsTrigger value="suppliers">Priser & leverandører</TabsTrigger>
          {!rm.is_packaging && (
            <TabsTrigger value="nutrition">Næring & deklarasjon</TabsTrigger>
          )}
          <TabsTrigger value="recipes">Brukt i oppskrifter</TabsTrigger>
          <TabsTrigger value="stock">Lager</TabsTrigger>
          <TabsTrigger value="history">Historikk</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-5">
          <OverviewTab
            rm={rm}
            registerSave={(fn) =>
              (saveRef.current = tab === "overview" ? fn : saveRef.current)
            }
          />
        </TabsContent>
        <TabsContent value="suppliers" className="mt-5">
          <SuppliersTab rm={rm} />
        </TabsContent>
        {!rm.is_packaging && (
          <TabsContent value="nutrition" className="mt-5">
            <NutritionTab rawMaterialId={rm.id} />
          </TabsContent>
        )}
        <TabsContent value="recipes" className="mt-5">
          <RecipesTab rm={rm} />
        </TabsContent>
        <TabsContent value="stock" className="mt-5">
          <StockTab rm={rm} />
        </TabsContent>
        <TabsContent value="history" className="mt-5">
          <HistoryTab rm={rm} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
