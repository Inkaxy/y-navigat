import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSelection } from "@/providers/SelectionProvider";
import { useProductionDepartments } from "@/produksjon/features/produksjonsavdelinger/hooks/useProductionDepartments";
import { useLagerItems, useStockRealtime } from "@/produksjon/features/lager/hooks/useLager";
import { ProductionRegisterCard } from "@/produksjon/features/lager/components/ProductionRegisterCard";
import { LagerBalanceTable } from "@/produksjon/features/lager/components/LagerBalanceTable";
import { WasteDialog } from "@/produksjon/features/lager/components/WasteDialog";
import { QuickCorrectionDialog } from "@/produksjon/features/lager/components/QuickCorrectionDialog";

const STORAGE_KEY = "produksjon.lager.dept";
const ALL = "all";

export default function LagerPage() {
  const { legalEntityId } = useSelection();
  const entityId = legalEntityId ?? undefined;
  const { data: departments = [], isLoading: depsLoading } = useProductionDepartments(entityId, false);
  const { data: items = [], isLoading } = useLagerItems(entityId);
  useStockRealtime();

  const [deptId, setDeptId] = useState<string>(() => localStorage.getItem(STORAGE_KEY) ?? ALL);
  const [wasteOpen, setWasteOpen] = useState(false);
  const [wasteItem, setWasteItem] = useState<string | null>(null);
  const [wasteBatch, setWasteBatch] = useState<string | null>(null);
  const [corrOpen, setCorrOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, deptId);
  }, [deptId]);

  useEffect(() => {
    if (deptId !== ALL && departments.length > 0 && !departments.some((d) => d.id === deptId)) {
      setDeptId(ALL);
    }
  }, [departments, deptId]);

  const visibleItems = useMemo(
    () => (deptId === ALL ? items : items.filter((i) => i.department_id === deptId)),
    [items, deptId],
  );

  const openWaste = (itemId: string, batchId?: string) => {
    setWasteItem(itemId);
    setWasteBatch(batchId ?? null);
    setWasteOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Lager</h1>
        <p className="text-muted-foreground">Meld inn produksjon og hold beholdningen oppdatert.</p>
      </div>

      {depsLoading ? (
        <Skeleton className="h-12 w-full max-w-xl" />
      ) : (
        <Tabs value={deptId} onValueChange={setDeptId}>
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value={ALL} className="h-12 px-5 text-base">
              Alle avdelinger
            </TabsTrigger>
            {departments.map((d) => (
              <TabsTrigger key={d.id} value={d.id} className="h-12 px-5 text-base">
                {d.display_name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : visibleItems.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-base">
              Ingen lagervarer i denne avdelingen ennå. Lagervarer opprettes fra varekortet under Varer → Lager.
            </p>
            <Button asChild variant="outline" className="h-12">
              <Link to="/varer/varer">Gå til varer</Link>
            </Button>
          </CardContent>
        </Card>
      ) : countMode ? (
        <StockCountMode items={visibleItems} onClose={() => setCountMode(false)} />
      ) : (
        <>
          <ProductionRegisterCard items={visibleItems} departmentId={deptId === ALL ? null : deptId} />
          <LagerBalanceTable items={visibleItems} onWaste={openWaste} />
          <div className="flex flex-wrap gap-3">
            <Button
              className="h-16 flex-1 text-lg"
              variant="destructive"
              onClick={() => {
                setWasteItem(null);
                setWasteBatch(null);
                setWasteOpen(true);
              }}
            >
              Registrer svinn
            </Button>
            <Button className="h-16 flex-1 text-lg" variant="outline" onClick={() => setCorrOpen(true)}>
              Hurtigkorrigering
            </Button>
            <Button className="h-16 flex-1 text-lg" variant="outline" onClick={() => setCountMode(true)}>
              Telling
            </Button>
          </div>
        </>
      )}


      <WasteDialog
        open={wasteOpen}
        onOpenChange={setWasteOpen}
        items={visibleItems}
        initialItemId={wasteItem}
        initialBatchId={wasteBatch}
      />
      <QuickCorrectionDialog open={corrOpen} onOpenChange={setCorrOpen} items={visibleItems} />
    </div>
  );
}
