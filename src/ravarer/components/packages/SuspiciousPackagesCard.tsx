import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, PackageCheck } from "lucide-react";
import { formatNumber } from "@/ravarer/lib/constants";
import { useSuspiciousPackages, type SuspiciousPackageRow } from "@/ravarer/hooks/useSuspiciousPackages";
import { SetPackageDialog } from "@/ravarer/components/packages/SetPackageDialog";
import type { PackageWorklistRow } from "@/ravarer/hooks/usePackageSizes";

/** Pakningsdialogen forventer en arbeidslisterad; her har vi bare den mistenkelige koblingen. */
function suspiciousRowAsWorklistRow(row: SuspiciousPackageRow): PackageWorklistRow {
  return {
    id: row.raw_material_id,
    legal_entity_id: null,
    name: row.raw_material_name,
    base_unit: row.base_unit,
    category: null,
    current_cost_price: row.current_cost_price,
    pakningsfaktor: null,
    faktor_kilde: null,
    bekreftet_dato: null,
    antall_fakturalinjer: null,
    antall_leverandorer: null,
    enheter_i_bruk: null,
    linjer_uten_pris: null,
    kjopt_kr_totalt: null,
    siste_faktura: null,
    pris_spredning: null,
    implisert_mengde: null,
    referansepris: null,
    referansekilde: null,
    referansedato: null,
    referanse_faktor: null,
    foreslatt_fra_navn: null,
    foreslatt_fra_referanse: null,
    status: "mangler_pakning",
  };
}

/**
 * Leverandørkoblingen som dialogen skal forhåndsfylle med.
 *
 * Verdien er FORSLAGET, ikke dagens feilverdi — bekrefter man raden med den
 * gamle verdien, blir pakningen stående som mistenkelig.
 */
export function suspiciousSupplierPrefill(
  row: SuspiciousPackageRow,
): { supplierId: string; supplierUnits: number } | null {
  if (!row.supplier_id) return null;
  return { supplierId: row.supplier_id, supplierUnits: row.suggested_base_units };
}

function Row({ row, onOpen }: { row: SuspiciousPackageRow; onOpen: (row: SuspiciousPackageRow) => void }) {
  return (
    <tr className="border-t border-line-subtle align-top">
      <td className="px-3 py-2">
        <div className="font-medium">{row.raw_material_name}</div>
        <div className="text-xs text-ink-secondary">
          {row.supplier_name ?? "—"}
          {row.supplier_product_name ? ` · ${row.supplier_product_name}` : ""}
        </div>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {row.package_size == null ? "—" : `${formatNumber(row.package_size, 3)} ${row.package_unit ?? ""}`}
        <div className="mt-1">
          <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
            {row.kind === "size_one" ? "pakningsstørrelse 1" : "uenig med varenavnet"}
          </Badge>
        </div>
      </td>
      <td className="px-3 py-2 text-sm text-ink-secondary">{row.explanation}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        {formatNumber(row.suggested_base_units, 3)} {row.base_unit}
      </td>
      <td className="px-3 py-2 text-right">
        <Button size="sm" onClick={() => onOpen(row)}>
          <PackageCheck className="mr-1 h-4 w-4" />
          Sett pakning
        </Button>
      </td>
    </tr>
  );
}

export function SuspiciousPackagesCard() {
  const { data: rows = [], isLoading } = useSuspiciousPackages();
  const [activeRow, setActiveRow] = useState<SuspiciousPackageRow | null>(null);

  // Stabile objekter: ellers ville dialogens reset-effekt kjørt på hver render
  // og skrevet over tallet brukeren nettopp skrev inn.
  const worklistRow = useMemo(() => (activeRow ? suspiciousRowAsWorklistRow(activeRow) : null), [activeRow]);
  const suggestion = useMemo(
    () => (activeRow ? { size: activeRow.suggested_base_units, contentUnit: activeRow.base_unit } : null),
    [activeRow],
  );
  // Forhåndsfyll med FORSLAGET, ikke dagens feilverdi — ellers skrives den gale
  // pakningen tilbake og raden blir stående som mistenkelig.
  const initialSupplier = useMemo(
    () => (activeRow ? suspiciousSupplierPrefill(activeRow) : null),
    [activeRow],
  );

  if (!isLoading && rows.length === 0) return null;

  return (
    <Card className="border-warning/50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-warning" />
        <h2 className="font-semibold">Mistenkelige pakninger</h2>
        {!isLoading && <span className="text-sm text-ink-secondary">{rows.length} koblinger</span>}
      </div>
      <p className="mb-3 text-sm text-ink-secondary">
        Pakningsstørrelse 1 med en pakke-enhet, eller en ubekreftet pakning som er uenig med varenavnet. Motorens
        forslag er hentet fra varenavnet — bekreft i pakningsdialogen, som også regner om kostpris.
      </p>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-ink-secondary">
              <tr>
                <th className="px-3 py-2 text-left">Vare</th>
                <th className="px-3 py-2 text-left">Registrert pakning</th>
                <th className="px-3 py-2 text-left">Hvorfor</th>
                <th className="px-3 py-2 text-left">Forslag</th>
                <th className="px-3 py-2 text-right">Handling</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => <Row key={r.link_id} row={r} onOpen={setActiveRow} />)}
            </tbody>
          </table>
        </div>
      )}

      <SetPackageDialog
        row={worklistRow}
        open={!!activeRow}
        onOpenChange={v => !v && setActiveRow(null)}
        suggestion={suggestion}
        initialSupplier={initialSupplier}
        forceSupplierSection
      />
    </Card>
  );
}
