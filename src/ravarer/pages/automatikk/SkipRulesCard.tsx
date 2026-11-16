import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useCompany } from "@/hooks/useCompany";
import { AUTO_KEY, useSkipRules, type SkipRule } from "./useAutomatikk";

const SHOW = 50;
const TYPE: Record<string, string> = { exact_sku: "varenummer", exact_description: "varetekst", description_contains: "tekst inneholder" };

/**
 * «Hopp over alltid» = selskapets utelatelsesmønstre (samme som matchmotoren leser og «Ikke vare» skriver).
 * Fjerning er en eksplisitt, bekreftet sletting av bare regelen; allerede behandlede linjer endres ikke.
 */
export function SkipRulesCard({ canWrite }: { canWrite: boolean }) {
  const q = useSkipRules();
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const [all, setAll] = useState(false);
  const [target, setTarget] = useState<SkipRule | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const lock = useRef(false);
  const remove = async (r: SkipRule) => {
    if (lock.current || !company) return;
    lock.current = true; setMsg(null);
    try {
      const { data, error } = await supabase.from("invoice_line_exclusion_patterns").delete().eq("id", r.id).eq("legal_entity_id", company.id).select("id");
      if (error) setMsg("Regelen kunne ikke fjernes. Hent listen på nytt og kontroller.");
      else if ((data ?? []).length === 0) setMsg("Regelen var allerede borte eller du mangler tilgang.");
      void qc.invalidateQueries({ queryKey: [...AUTO_KEY, "hopp-over"] });
    } finally { lock.current = false; setTarget(null); }
  };
  const rows = q.data ?? [];
  return (
    <section aria-labelledby="hopp-tittel" className="space-y-2 rounded-2xl border border-line-subtle bg-card p-4">
      <h2 id="hopp-tittel" className="text-body font-semibold">Hoppes alltid over</h2>
      <p className="text-caption text-ink-secondary">Paller, miljøvederlag, frakt og lignende du har valgt å hoppe over alltid. «Én gang» gjelder bare den ene linjen og står ikke her.</p>
      {q.isError ? <p role="alert" className="text-sm text-destructive">Listen kunne ikke hentes.</p>
        : q.isLoading ? <p className="text-sm text-ink-secondary">Henter …</p>
        : rows.length === 0 ? <p className="text-sm text-ink-secondary">Ingen regler ennå.</p>
        : <>
          <p className="text-caption text-ink-secondary">{rows.length.toLocaleString("nb-NO")} regler{rows.length === 500 ? " (viser de 500 nyeste)" : ""}</p>
          <ul className="divide-y divide-line-subtle">
            {(all ? rows : rows.slice(0, SHOW)).map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.value}</p>
                  <p className="text-caption text-ink-secondary">{r.supplierName ?? "Alle leverandører"} · {TYPE[r.type] ?? r.type}{r.reason ? ` · ${r.reason}` : ""}</p>
                </div>
                {canWrite && <Button size="icon" variant="ghost" className="h-11 w-11" aria-label={`Fjern regelen for ${r.value}`} onClick={() => setTarget(r)}><Trash2 className="h-4 w-4" aria-hidden /></Button>}
              </li>
            ))}
          </ul>
          {rows.length > SHOW && <Button variant="ghost" className="min-h-[44px]" onClick={() => setAll(!all)}>{all ? "Vis færre" : `Vis alle ${rows.length}`}</Button>}
        </>}
      {msg && <p role="alert" className="text-caption text-destructive">{msg}</p>}
      <AlertDialog open={!!target} onOpenChange={(v) => { if (!v) setTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fjern regelen?</AlertDialogTitle>
            <AlertDialogDescription>«{target?.value}» hoppes ikke lenger over på nye fakturaer. Linjer som allerede er behandlet, endres ikke.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Avbryt</AlertDialogCancel>
            <AlertDialogAction className="min-h-[44px]" onClick={() => target && void remove(target)}>Fjern regelen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
