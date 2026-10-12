import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { QueryState } from "@/components/common/QueryState";
import { formatNok, formatNumber } from "@/ravarer/lib/constants";
import { useRecipesUsingRawMaterial } from "@/ravarer/hooks/useRecipesUsingRawMaterial";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";

interface Props {
  rm: RawMaterialRow;
}

/** Kost per oppskrift fra felles linjemotor; ukjent/uverifisert vises med forklaring, aldri som 0 kr. */
export function RecipesTab({ rm }: Props) {
  const { data = [], isLoading, isError, error, refetch } = useRecipesUsingRawMaterial(rm.id);

  const notes = noteList(data ?? []);
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
                <th className="pb-2 text-right">Andel av oppskriftens kost</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.recipeId} className="border-t border-line-subtle align-top">
                  <td className="py-2">
                    <Link to={`/varer/oppskrifter/${r.recipeId}`} className="font-medium text-app underline-offset-2 hover:underline">
                      {r.recipeName}
                    </Link>
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {r.quantities.length === 0 ? "—" : r.quantities.map((q) => `${formatNumber(q.amount, 3)} ${q.unit}`).join(" + ")}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {r.lineCost != null ? formatNok(r.lineCost) : <UnknownCell note={r.costNote} notes={notes} />}
                  </td>
                  <td className="py-2 text-right tabular-nums text-ink-secondary">
                    {r.costShare != null ? formatPctNb(r.costShare * 100) : <UnknownCell note={r.shareNote} notes={notes} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {notes.length > 0 && (
          <ol className="mt-3 space-y-1 text-caption text-ink-secondary" aria-label="Forklaring på ukjente verdier">
            {notes.map((n, i) => <li key={n}><sup>{i + 1}</sup> {n}</li>)}
          </ol>
        )}
      </QueryState>
    </Card>
  );
}

const pctNb = new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function formatPctNb(v: number): string { return `${pctNb.format(v)} %`; }

/** Én felles liste over forskjellige årsaker — hver celle viser bare kort «Ukjent» med henvisning. */
function noteList(rows: ReadonlyArray<{ costNote?: string | null; shareNote?: string | null }>): string[] {
  const out: string[] = [];
  for (const r of rows) for (const n of [r.costNote, r.shareNote]) if (n && !out.includes(n)) out.push(n);
  return out;
}

function UnknownCell({ note, notes }: { note?: string | null; notes: string[] }) {
  const idx = note ? notes.indexOf(note) : -1;
  return (
    <span className="text-caption text-ink-secondary" title={note ?? undefined} aria-label={note ? `Ukjent: ${note}` : "Ukjent"}>
      Ukjent{idx >= 0 && <sup aria-hidden>{idx + 1}</sup>}
    </span>
  );
}
