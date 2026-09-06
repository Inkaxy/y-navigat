import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useGuardedNavigate } from "@/providers/UnsavedGuardProvider";
import { QueryState } from "@/components/common/QueryState";
import { useRawMaterial, useRenameRawMaterial } from "@/ravarer/hooks/useRawMaterials";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Loader2, Pencil, Check, X } from "lucide-react";
import { OverviewTab } from "@/ravarer/components/tabs/OverviewTab";
import { NutritionTab } from "@/ravarer/components/tabs/NutritionTab";
import { SuppliersTab } from "@/ravarer/components/tabs/SuppliersTab";
import { ResaleSettingsCard } from "@/ravarer/components/stock/ResaleSettingsCard";
import { SellsAsSection } from "@/ravarer/components/stock/SellsAsSection";
import { UnitsAndPriceCard } from "@/ravarer/components/stock/UnitsAndPriceCard";
import { StockTrackingCard } from "@/ravarer/components/stock/StockTrackingCard";


export default function RawMaterialDetail() {
  const { id } = useParams();
  const navigate = useGuardedNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get("tab") ?? "overview";
  const { data: rm, isLoading, isError, error, refetch } = useRawMaterial(id);
  const rename = useRenameRawMaterial();
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  if (isLoading || isError || !rm) {
    return (
      <QueryState
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={() => void refetch()}
        scope="Råvaren"
        isEmpty={!rm}
        emptyTitle="Råvaren ble ikke funnet"
        emptyDescription="Den kan være slettet, eller lenken kan være feil."
        loadingFallback={<div className="flex justify-center p-12"><Loader2 className="h-5 w-5 animate-spin" /></div>}
      >
        {null}
      </QueryState>
    );
  }

  const startEdit = () => { setNameDraft(rm.name); setEditingName(true); };
  const saveName = async () => {
    const v = nameDraft.trim();
    if (!v || v === rm.name) { setEditingName(false); return; }
    await rename.mutateAsync({ id: rm.id, name: v });
    setEditingName(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate("/ravarer/vareliste")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Tilbake
        </Button>
      </div>

      <div>
        {editingName ? (
          <div className="flex items-center gap-2">
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }}
              autoFocus
              className="text-2xl h-11 font-semibold tracking-tight max-w-xl"
              style={{ letterSpacing: "-0.02em" }}
            />
            <Button size="icon" variant="ghost" onClick={saveName} disabled={rename.isPending}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setEditingName(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 group">
            <h1 className="text-2xl font-semibold tracking-tight" style={{ letterSpacing: "-0.02em" }}>{rm.name}</h1>
            <Button size="icon" variant="ghost" onClick={startEdit} className="opacity-0 group-hover:opacity-100 transition-opacity" title="Endre navn">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        <p className="text-sm text-ink-secondary">SKU {rm.sku} · {rm.category ?? "Uten kategori"}</p>
      </div>

      <Tabs value={tabFromUrl} onValueChange={(v) => setSearchParams(v === "overview" ? {} : { tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="overview">Oversikt</TabsTrigger>
          {!rm.is_packaging && <TabsTrigger value="nutrition">Næring & deklarasjon</TabsTrigger>}
          <TabsTrigger value="suppliers">Leverandører & priser</TabsTrigger>
          <TabsTrigger value="insight" disabled>Prisinnsikt</TabsTrigger>
          <TabsTrigger value="recipes" disabled>Brukt i oppskrifter</TabsTrigger>
          <TabsTrigger value="invoices" disabled>Fakturahistorikk</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-5 space-y-5">
          <OverviewTab rm={rm} />
          <UnitsAndPriceCard rm={rm} />
          <StockTrackingCard rm={rm} />
          <ResaleSettingsCard rm={rm} />
          {rm.is_resale_item && <SellsAsSection rm={rm} />}
        </TabsContent>

        {!rm.is_packaging && <TabsContent value="nutrition" className="mt-5"><NutritionTab rawMaterialId={rm.id} /></TabsContent>}
        <TabsContent value="suppliers" className="mt-5"><SuppliersTab rm={rm} /></TabsContent>
      </Tabs>
    </div>
  );
}
