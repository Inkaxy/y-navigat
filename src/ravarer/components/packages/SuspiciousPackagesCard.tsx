import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { formatNumber } from "@/ravarer/lib/constants";
import { parseDecimal } from "@/fakturaer/lib/units";
import {
  useSuspiciousPackages,
  useConfirmSuspiciousPackage,
  type SuspiciousPackageRow,
} from "@/ravarer/hooks/useSuspiciousPackages";

function Row({ row }: { row: SuspiciousPackageRow }) {
  const [value, setValue] = useState(String(row.suggested_base_units).replace(".", ","));
  const confirm = useConfirmSuspiciousPackage();
  const parsed = parseDecimal(value);
  const valid = parsed != null && parsed > 0;
  const busy = confirm.isPending;

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
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <Input
            className="w-24"
            value={value}
            onChange={e => setValue(e.target.value)}
            aria-label={`Baseenheter per pakning for ${row.raw_material_name}`}
          />
          <span className="text-sm text-ink-secondary">{row.base_unit}</span>
        </div>
      </td>
      <td className="px-3 py-2 text-right">
        <Button
          size="sm"
          disabled={!valid || busy}
          onClick={() =>
            confirm.mutate({ linkId: row.link_id, baseUnits: parsed!, rawMaterialId: row.raw_material_id })
          }
        >
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
          Bekreft {valid ? `${formatNumber(parsed!, 3)} ${row.base_unit ?? ""}` : ""}
        </Button>
      </td>
    </tr>
  );
}

export function SuspiciousPackagesCard() {
  const { data: rows = [], isLoading } = useSuspiciousPackages();

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
        forslag er hentet fra varenavnet — bekreft, så er varen ferdig for godt.
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
                <th className="px-3 py-2 text-left">Per pakning</th>
                <th className="px-3 py-2 text-right">Handling</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => <Row key={r.link_id} row={r} />)}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
