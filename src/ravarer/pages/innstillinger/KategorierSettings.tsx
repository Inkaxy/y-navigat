import { Link } from "react-router-dom";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { Card } from "@/components/ui/card";
import { QueryState } from "@/components/common/QueryState";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { useCategoryUsage } from "@/ravarer/lib/categoryUsage";
import { paths } from "@/ravarer/lib/paths";

/**
 * Lesende kategorioversikt (avledet fra varene). Teller hver vare én gang per kategori, både fra `category` og
 * `categories`, for hele selskapet. Endring av kategorier gjøres i varelisten (filter + massehandling).
 */
export default function KategorierSettingsPage() {
  const { legalEntityId } = useRavarer();
  const q = useCategoryUsage(legalEntityId);
  const d = q.data;
  return (
    <div className="space-y-5">
      <RavarerHeaderBanner title="Kategorier" subtitle="Kategorier brukt på varene i selskapet" />
      <Card className="space-y-3 p-4">
        <QueryState scope="Kategorier" isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()}
          isEmpty={!!d && d.totalMaterials === 0} emptyTitle="Ingen varer registrert ennå.">
          {d && (
            <>
              <p className="text-caption text-ink-secondary">
                {d.totalMaterials} varer totalt. En vare med flere kategorier telles i hver av dem. Trykk på en kategori for å åpne varelisten filtrert på den — der kan du endre kategori for én eller flere varer.
              </p>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-ink-secondary">
                  <tr><th className="py-2">Kategori</th><th className="py-2 text-right">Aktive</th><th className="py-2 text-right">Inaktive</th></tr>
                </thead>
                <tbody>
                  {d.categories.map((c) => (
                    <tr key={c.category} className="border-t border-line-subtle">
                      <td className="py-1">
                        <Link to={paths.varer({ kat: c.category })} className="inline-flex min-h-[44px] items-center text-primary hover:underline [overflow-wrap:anywhere] md:min-h-0 md:py-1">{c.category}</Link>
                      </td>
                      <td className="py-1 text-right tabular-nums">{c.active}</td>
                      <td className="py-1 text-right tabular-nums text-ink-secondary">{c.inactive}</td>
                    </tr>
                  ))}
                  {d.uncategorized.active + d.uncategorized.inactive > 0 && (
                    <tr className="border-t border-line-subtle">
                      <td className="py-2 italic text-ink-secondary">Uten kategori</td>
                      <td className="py-2 text-right tabular-nums">{d.uncategorized.active}</td>
                      <td className="py-2 text-right tabular-nums text-ink-secondary">{d.uncategorized.inactive}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {d.categories.length === 0 && <p className="text-sm text-ink-secondary">Ingen varer har kategori ennå. Sett kategori i varelisten.</p>}
            </>
          )}
        </QueryState>
      </Card>
    </div>
  );
}
