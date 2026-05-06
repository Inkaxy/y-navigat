import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useRawMaterial } from "@/ravarer/hooks/useRawMaterials";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { OverviewTab } from "@/ravarer/components/tabs/OverviewTab";
import { NutritionTab } from "@/ravarer/components/tabs/NutritionTab";
import { SuppliersTab } from "@/ravarer/components/tabs/SuppliersTab";

export default function RawMaterialDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: rm, isLoading } = useRawMaterial(id);

  if (isLoading) return <div className="flex justify-center p-12"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!rm) return <Card className="p-8 text-center text-ink-secondary">Råvaren ble ikke funnet.</Card>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate("/ravarer/vareliste")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Tilbake
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ letterSpacing: "-0.02em" }}>{rm.name}</h1>
        <p className="text-sm text-ink-secondary">SKU {rm.sku} · {rm.category ?? "Uten kategori"}</p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Oversikt</TabsTrigger>
          {!rm.is_packaging && <TabsTrigger value="nutrition">Næring & deklarasjon</TabsTrigger>}
          <TabsTrigger value="suppliers">Leverandører & priser</TabsTrigger>
          <TabsTrigger value="insight" disabled>Prisinnsikt</TabsTrigger>
          <TabsTrigger value="recipes" disabled>Brukt i oppskrifter</TabsTrigger>
          <TabsTrigger value="invoices" disabled>Fakturahistorikk</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-5"><OverviewTab rm={rm} /></TabsContent>
        {!rm.is_packaging && <TabsContent value="nutrition" className="mt-5"><NutritionTab rawMaterialId={rm.id} /></TabsContent>}
        <TabsContent value="suppliers" className="mt-5"><SuppliersTab rm={rm} /></TabsContent>
      </Tabs>
    </div>
  );
}
