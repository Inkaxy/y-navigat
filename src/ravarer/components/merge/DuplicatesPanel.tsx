import { Link } from "react-router-dom";
import { Combine, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CAPABILITY_FILE } from "@/lib/pendingRpc";
import { paths } from "@/ravarer/lib/paths";
import { reasonText, type DupGroup } from "@/ravarer/lib/merge/duplicates";

/** Forslag til duplikater over varelisten. Bare forslag; sammenslåing skjer i dialogen etter forhåndsvisning. */
export function DuplicatesPanel({ groups, isLoading, isError, onRetry, nameOf, listSearch, merge, onClose }: {
  groups: DupGroup[] | null; isLoading: boolean; isError: boolean; onRetry: () => void; nameOf: (id: string) => string; listSearch: string;
  merge: { allowed: boolean; ready: boolean; onMerge: (ids: string[]) => void }; onClose: () => void;
}) {
  return (
    <section aria-labelledby="dupl-title" className="rounded-2xl border border-line-subtle bg-card p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 id="dupl-title" className="font-serif text-title">Mulige duplikater</h2>
          <p className="text-caption text-ink-secondary">Samme varenummer hos samme leverandør, eller svært like navn hos samme leverandør. Kontroller før du slår sammen.</p>
        </div>
        <Button variant="ghost" size="sm" className="min-h-[44px] gap-1.5" onClick={onClose}><X className="h-4 w-4" aria-hidden />Lukk</Button>
      </div>
      {isLoading ? <p className="mt-3 flex items-center gap-2 text-body"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Leter etter duplikater …</p>
        : isError ? (
          <p role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-body text-destructive">Kunne ikke hente leverandørkoblingene.
            <Button variant="outline" size="sm" className="min-h-[44px]" onClick={onRetry}>Prøv igjen</Button></p>
        ) : !groups || groups.length === 0 ? <p className="mt-3 text-body text-ink-secondary">Fant ingen mulige duplikater blant aktive varer.</p>
        : (
          <ul className="mt-3 divide-y divide-line-subtle" aria-label="Mulige duplikater">
            {groups.map((g) => (
              <li key={g.key} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-body">
                    {g.ids.map((id, i) => (
                      <span key={id}>{i > 0 && <span className="text-ink-secondary"> · </span>}
                        <Link className="font-semibold text-primary hover:underline" to={`${paths.raavare(id)}${listSearch ? `?${listSearch}` : ""}`}>{nameOf(id)}</Link>
                      </span>
                    ))}
                  </p>
                  <p className="text-caption text-ink-secondary">{g.reasons.map(reasonText).join(" · ")}</p>
                </div>
                {merge.allowed && (
                  <Button variant="outline" className="min-h-[44px] gap-1.5" disabled={!merge.ready}
                    title={merge.ready ? undefined : `Venter på databaseendring («${CAPABILITY_FILE.rm_cap_slaa_sammen_v1}»)`} onClick={() => merge.onMerge(g.ids)}>
                    <Combine className="h-4 w-4" aria-hidden />Slå sammen …
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
