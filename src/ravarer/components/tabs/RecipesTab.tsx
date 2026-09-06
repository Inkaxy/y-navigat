import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { QueryState } from "@/components/common/QueryState";
import { formatNok, formatNumber } from "@/ravarer/lib/constants";
import { useRecipesUsingRawMaterial } from "@/ravarer/hooks/useRecipesUsingRawMaterial";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";

interface Props {
  rm: RawMaterialRow;
}

export function RecipesTab({ rm }: Props) {
  const { data = [], isLoading, isError, error, refetch } = useRecipesUsingRawMaterial(
    rm.id,
    rm.current_cost_price,
  );

  return (
    <Card className="space-y-4 p-5">
      <h3 className="text-base font-semibold">Brukt i oppskrifter</h3>
      <QueryState
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={() => void refetch()}
        scope="oppskriftene"
        isEmpty={data.length === 0}
        emptyTitle="Ingen oppskrifter bruker denne råvaren"
        emptyDescription="Råvaren er ikke lagt inn på noen oppskriftslinje ennå."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-ink-secondary">
              <tr>
                <th className="pb-2">Oppskrift</th>
                <th className="pb-2 text-right">Mengde</th>
                <th className="pb-2 text-right">Kost</th>
                <th className="pb-2 text-right">Andel av råvarekost</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.recipeId} className="border-t border-line-subtle">
                  <td className="py-2">
                    <Link
                      to={`/varer/oppskrifter/${r.recipeId}`}
                      className="font-medium text-app underline-offset-2 hover:underline"
                    >
                      {r.recipeName}
                    </Link>
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatNumber(r.quantity, 3)} {r.unit || rm.base_unit}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {r.lineCost != null ? formatNok(r.lineCost) : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums text-ink-secondary">
                    {r.costShare != null ? `${(r.costShare * 100).toFixed(1)} %` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>
    </Card>
  );
}
