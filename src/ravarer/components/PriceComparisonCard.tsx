import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { OBSERVATION_PAGE, usePriceComparison } from "@/ravarer/hooks/usePriceComparison";
import { PriceComparisonView } from "@/ravarer/components/PriceComparisonView";

/**
 * Prissammenligning per leverandør: avtalepris, forrige kontrollerte kjøp og
 * mengdevektet 90-dagerssnitt (beløp ÷ mengde — aldri snitt av priser), med
 * observasjonene tallene bygger på.
 *
 * All presentasjon ligger i `PriceComparisonView`, som kan vises med faste
 * data i utviklingsforhåndsvisningen.
 */
export function PriceComparisonCard({
  rawMaterialId,
  baseUnit,
}: {
  rawMaterialId: string;
  baseUnit: string;
}) {
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [limit, setLimit] = useState(OBSERVATION_PAGE);
  const { summary, observations, onDate } = usePriceComparison(rawMaterialId, supplierId, limit);

  const suppliers = useQuery({
    queryKey: ["rm-comparison-suppliers", rawMaterialId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_suppliers")
        .select("supplier_id, supplier:suppliers(name)")
        .eq("raw_material_id", rawMaterialId);
      if (error) throw error;
      return (data ?? []) as unknown as { supplier_id: string; supplier: { name: string } | null }[];
    },
  });

  const supplierNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of suppliers.data ?? []) m.set(s.supplier_id, s.supplier?.name ?? "Ukjent leverandør");
    return m;
  }, [suppliers.data]);

  const rows = observations.data ?? [];

  return (
    <PriceComparisonView
      baseUnit={baseUnit}
      onDate={onDate}
      summary={summary.data ?? null}
      observations={rows}
      supplierNames={supplierNames}
      supplierId={supplierId}
      onSupplierChange={(id) => {
        setSupplierId(id);
        setLimit(OBSERVATION_PAGE);
      }}
      suppliersError={suppliers.isError ? suppliers.error : undefined}
      onRetrySuppliers={() => void suppliers.refetch()}
      isLoading={summary.isLoading || observations.isLoading}
      isError={summary.isError || observations.isError}
      error={summary.error ?? observations.error}
      onRetry={() => {
        void summary.refetch();
        void observations.refetch();
      }}
      loadedLimit={limit}
      hasMore={rows.length >= limit}
      onLoadMore={() => setLimit((n) => n + OBSERVATION_PAGE)}
      isLoadingMore={observations.isFetching}
    />
  );
}
