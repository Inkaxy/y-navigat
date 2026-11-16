import { useEffect, useMemo, useState } from "react";
import { Loader2, Package, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { nKr, nNum, parseNum } from "@/varer/lib/calcFormat";
import { diffPackaging, isDirty, packagingCostPerUnit, toBatchQty, toPerUnit, type PackagingLine } from "@/varer/lib/packagingLines";
import { usePackagingLines, useSavePackagingLines } from "@/varer/hooks/usePackagingLines";
import { useHandelsvarer } from "@/varer/hooks/useHandelsvarer";
import { usableCost } from "@/varer/lib/handelsvarer";

interface Props {
  recipeId: string;
  legalEntityId: string | null;
  unitsPerBatch: number | null;
  canWrite: boolean;
}

/**
 * Emballasje og handelsvarer i kalkylen (kakeeske, brødpose …). Lagres i recipe_packaging_lines,
 * som product_cost allerede deler på antall per bakst. Påvirker ikke deigvekt eller deklarasjon.
 * Kladd med Lagre/Forkast; ingenting lagres automatisk.
 */
export function RecipePackagingSection({ recipeId, legalEntityId, unitsPerBatch, canWrite }: Props) {
  const q = usePackagingLines(recipeId);
  const save = useSavePackagingLines(recipeId);
  const choicesQ = useHandelsvarer(canWrite ? legalEntityId : null);
  const [draft, setDraft] = useState<PackagingLine[] | null>(null);
  const [pick, setPick] = useState("");
  const saved = q.data ?? [];
  const lines = draft ?? saved;
  const units = unitsPerBatch && unitsPerBatch > 0 ? unitsPerBatch : null;

  // Kladden overlever ny henting; byttes bare ved eksplisitt Forkast eller etter lagring.
  useEffect(() => { setDraft(null); }, [recipeId]);

  const costOf = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const s of saved) m.set(s.rawMaterialId, s.usableCost);
    for (const c of choicesQ.data ?? []) m.set(c.material.id, usableCost(c.material));
    return (id: string) => m.get(id) ?? null;
  }, [saved, choicesQ.data]);
  const perUnit = packagingCostPerUnit(lines, costOf, units);
  const diff = diffPackaging(saved, lines);
  const dirty = draft != null && isDirty(diff);

  const matches = useMemo(() => {
    const t = pick.trim().toLowerCase();
    if (!t) return [];
    return (choicesQ.data ?? []).filter((c) => c.material.name.toLowerCase().includes(t)).slice(0, 12);
  }, [pick, choicesQ.data]);

  function edit(fn: (ls: PackagingLine[]) => PackagingLine[]) { setDraft(fn([...(draft ?? saved)])); }

  async function onSave() {
    try {
      await save.mutateAsync(diff);
      setDraft(null);
      toast.success("Emballasjen i kalkylen er lagret");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Emballasjen ble ikke lagret.");
    }
  }

  return (
    <section aria-labelledby="emballasje-kalkyle-tittel" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle pb-1.5">
        <h2 id="emballasje-kalkyle-tittel" className="font-display text-title text-foreground">Emballasje og handelsvarer i kalkylen</h2>
        <span className="text-caption text-muted-foreground">Per vare: {perUnit != null ? nKr(perUnit) : lines.length ? "Ukjent" : nKr(0)}</span>
      </div>
      <p className="text-caption text-muted-foreground">
        Kakeeske, brødpose, bånd og lignende. Teller i kostprisen, ikke i deigvekt eller deklarasjon. Antall er per ferdig vare.
      </p>
      {q.isLoading ? <p className="text-caption text-muted-foreground">Henter …</p>
        : q.isError ? <p className="text-caption text-destructive" role="alert">Kunne ikke hente emballasjen. Kosten er ukjent.</p>
        : (
          <>
            {lines.length === 0 && <p className="text-caption text-muted-foreground">Ingen emballasje er lagt inn.</p>}
            {lines.length > 0 && (
              <table className="w-full text-body">
                <thead className="text-left text-caption text-muted-foreground">
                  <tr><th className="py-1 font-medium">Vare</th><th className="py-1 font-medium">Antall per vare</th><th className="py-1 text-right font-medium">Pris</th><th className="py-1 text-right font-medium">Per vare</th><th className="sr-only">Fjern</th></tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const price = l.unitPriceOverride ?? costOf(l.rawMaterialId);
                    return (
                      <tr key={l.id ?? `ny-${i}`} className="border-t border-border">
                        <td className="py-1.5">{l.name}</td>
                        <td className="py-1.5">
                          {units ? (
                            <Input
                              aria-label={`Antall ${l.name} per vare`} inputMode="decimal" className="h-9 w-24" disabled={!canWrite}
                              defaultValue={nNum(toPerUnit(l.quantity, units), 2)} key={`${l.id ?? i}:${l.quantity}`}
                              onBlur={(e) => {
                                const n = parseNum(e.currentTarget.value);
                                if (n == null || n <= 0) { toast.error("Skriv et antall større enn 0"); return; }
                                const qty = toBatchQty(n, units);
                                if (qty !== l.quantity) edit((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: qty } : x)));
                              }}
                            />
                          ) : <span className="text-caption text-muted-foreground">{nNum(l.quantity, 2)} per bakst</span>}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{price != null ? nKr(price) : <span className="text-warning">Mangler verifisert pris</span>}</td>
                        <td className="py-1.5 text-right tabular-nums">{price != null && units ? nKr((l.quantity * price) / units) : "–"}</td>
                        <td className="py-1.5 text-right">
                          {canWrite && (
                            <Button size="icon" variant="ghost" aria-label={`Fjern ${l.name}`} onClick={() => edit((ls) => ls.filter((_, j) => j !== i))}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {canWrite && (units ? (
              <div className="space-y-1">
                <label htmlFor="emballasje-sok" className="text-caption text-muted-foreground">Legg emballasje eller handelsvare i kalkylen</label>
                <Input id="emballasje-sok" value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Søk, f.eks. kakeeske" className="max-w-sm" />
                {matches.length > 0 && (
                  <ul className="max-w-sm rounded-md border border-border" aria-label="Treff">
                    {matches.map((c) => (
                      <li key={c.material.id}>
                        <button type="button" className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-body hover:bg-muted"
                          onClick={() => {
                            edit((ls) => [...ls, { id: null, updatedAt: null, rawMaterialId: c.material.id, name: c.material.name, quantity: toBatchQty(1, units), unitPriceOverride: null, sortOrder: ls.length }]);
                            setPick("");
                          }}>
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <span className="flex-1">{c.material.name}</span>
                          <span className="text-caption text-muted-foreground">{c.material.itemType === "emballasje" ? "Emballasje" : "Videresalg"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : <p className="text-caption text-warning">Sett antall per bakst før emballasje kan legges inn.</p>)}
            {dirty && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-body">
                <span>Ulagrede endringer i emballasjen.</span>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={save.isPending}>Forkast</Button>
                  <Button size="sm" onClick={onSave} disabled={save.isPending}>
                    {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Lagre emballasje
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
    </section>
  );
}
