import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueryErrorState, QueryLoadingState } from "@/components/common/QueryState";
import { cn } from "@/lib/utils";
import { dateNo } from "@/ravarer/lib/decisions";
import { formatNok } from "@/ravarer/lib/constants";
import { paths } from "@/ravarer/lib/paths";
import { useCostLines, useCostPostWrites } from "@/ravarer/hooks/useCostPosts";
import type { CostPost } from "@/ravarer/lib/kostnadsposter/parse";
import { amountText, linesText } from "./costPostText";

/** Én post: hvilke leverandører og fakturalinjer beløpet kommer fra. Leverandørfilter i adressen (`lev`). */
export function CostPostDetail({ post, year, supplierId, onSupplier, canWrite, retur, complete }: {
  post: CostPost; year: number; supplierId: string | null; onSupplier: (id: string | null) => void;
  canWrite: boolean; retur: string; complete: boolean;
}) {
  const lines = useCostLines(post.id, year, supplierId);
  const writes = useCostPostWrites();
  const [rename, setRename] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, f: () => Promise<void>) => {
    if (busy) return;
    setBusy(key); setError(null);
    try { await f(); } catch (e) { setError(e instanceof Error ? e.message : "Kunne ikke lagre."); } finally { setBusy(null); }
  };

  return (
    <section aria-labelledby={`post-${post.id}`} className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`post-${post.id}`} className="text-title font-semibold">{post.name}{post.archived && <span className="ml-2 text-caption text-ink-secondary">(arkivert)</span>}</h2>
          <p className="text-sm text-ink-secondary">
            {year}: <span className="font-semibold text-foreground tabular-nums">{amountText(post.amount, post.missingAmount)}</span> eks. mva · {linesText(post.lines)} på {post.invoices} {post.invoices === 1 ? "faktura" : "fakturaer"}
            {!complete && " · foreløpig"}
          </p>
        </div>
        {canWrite && !post.archived && rename == null && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-[44px]" onClick={() => setRename(post.name)}>Gi nytt navn</Button>
            <Button variant="outline" className="min-h-[44px]" disabled={!!busy}
              onClick={() => void run("arkiv", () => writes.savePost({ id: post.id, name: post.name, archived: true }).then(() => undefined))}>Arkiver</Button>
          </div>
        )}
        {canWrite && post.archived && (
          <Button variant="outline" className="min-h-[44px]" disabled={!!busy}
            onClick={() => void run("hent", () => writes.savePost({ id: post.id, name: post.name, archived: false }).then(() => undefined))}>Ta i bruk igjen</Button>
        )}
      </header>
      {rename != null && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run("navn", async () => { await writes.savePost({ id: post.id, name: rename }); setRename(null); }); }}>
          <label className="space-y-1 text-caption font-semibold">Nytt navn
            <Input value={rename} maxLength={60} onChange={(e) => setRename(e.target.value)} className="h-11 w-64" autoFocus />
          </label>
          <Button type="submit" className="min-h-[44px]" disabled={!!busy || !rename.trim()}>Lagre</Button>
          <Button type="button" variant="ghost" className="min-h-[44px]" onClick={() => setRename(null)}>Avbryt</Button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <div>
        <h3 className="mb-1.5 text-sm font-semibold">Leverandører</h3>
        {post.suppliers.length === 0 ? <p className="text-sm text-ink-secondary">Ingen linjer i {year}.</p> : (
          <ul className="divide-y divide-line-subtle rounded-lg border border-line-subtle">
            {post.suppliers.map((s) => (
              <li key={s.supplierId}>
                <button type="button" aria-pressed={supplierId === s.supplierId} onClick={() => onSupplier(supplierId === s.supplierId ? null : s.supplierId)}
                  className={cn("flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted", supplierId === s.supplierId && "bg-muted font-semibold")}>
                  <span className="min-w-0 truncate">{s.name ?? "Ukjent leverandør"} <span className="text-ink-secondary">· {linesText(s.lines)}</span></span>
                  <span className="tabular-nums">{amountText(s.amount, s.missingAmount)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-1.5 text-sm font-semibold">Fakturalinjer som hører til posten</h3>
        <ul className="space-y-1.5">
          {post.items.map((it) => (
            <li key={`${it.supplierId}:${it.itemKey}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-subtle px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{it.text ?? it.itemKey}</span>
                <span className="block text-caption text-ink-secondary">{it.supplierName ?? "Ukjent leverandør"} · {it.lines ? `${linesText(it.lines)} i ${year}` : `ingen linjer i ${year}`}</span>
              </span>
              <span className="tabular-nums">{amountText(it.amount, it.missingAmount)}</span>
              {canWrite && (
                <Button variant="ghost" className="min-h-[44px]" disabled={!!busy}
                  onClick={() => void run(it.itemKey, () => writes.setRule({ supplierId: it.supplierId, itemKey: it.itemKey, postId: null }))}>Ta ut av posten</Button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-1.5 text-sm font-semibold">Fakturaer{supplierId ? ` fra ${post.suppliers.find((s) => s.supplierId === supplierId)?.name ?? "valgt leverandør"}` : ""}</h3>
        {lines.isLoading ? <QueryLoadingState rows={4} /> : lines.isError ? (
          <QueryErrorState scope="ravarer:kostnadsposter:linjer" error={lines.error} onRetry={() => void lines.refetch()} compact />
        ) : lines.data && lines.data.lines.length === 0 ? <p className="text-sm text-ink-secondary">Ingen fakturalinjer i {year}.</p> : lines.data && (
          <div className="overflow-x-auto rounded-lg border border-line-subtle">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-caption text-ink-secondary">
                <tr><th className="px-3 py-2 font-semibold">Dato</th><th className="px-3 py-2 font-semibold">Faktura</th><th className="px-3 py-2 font-semibold">Leverandør</th><th className="px-3 py-2 font-semibold">Linje</th><th className="px-3 py-2 text-right font-semibold">Beløp</th></tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {lines.data.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{dateNo(l.invoiceDate)}</td>
                    <td className="px-3 py-2"><Link className="font-semibold underline underline-offset-2" to={paths.faktura(l.invoiceId, { linje: l.id, retur })}>{l.invoiceNumber ?? "Uten nummer"}</Link>{l.isCreditNote && <span className="ml-1 text-caption text-ink-secondary">kreditnota</span>}</td>
                    <td className="px-3 py-2">{l.supplierName ?? "Ukjent"}</td>
                    <td className="px-3 py-2">{l.text ?? "–"}{l.quantity != null && <span className="text-ink-secondary"> · {l.quantity.toLocaleString("nb-NO")} {l.unit ?? ""}</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{l.amount == null ? "Ukjent" : formatNok(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lines.data.total > lines.data.lines.length && <p className="px-3 py-2 text-caption text-ink-secondary">Viser de {lines.data.lines.length} nyeste av {lines.data.total} linjer. Summen over gjelder alle.</p>}
          </div>
        )}
      </div>
    </section>
  );
}
