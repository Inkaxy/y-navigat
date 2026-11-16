import { useMemo, useState } from "react";
import { Ban, Link2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { nKr, nNum } from "@/varer/lib/calcFormat";
import {
  FACTOR_SOURCE_LABEL, applyMarkupDraft, cellStatus, changeKey, effectiveFactor, factorAsPct, indexMarkups, isBlocked,
  isNoMarkupList, marginPerUnit, parseFactor, purchasePerSoldUnit, suggestedPrice, toListPrice, usableCost,
  type MarkupChange, type ResaleMaterial,
} from "@/varer/lib/handelsvarer";
import { useHandelsvarer, useResaleMarkups, useSaveResaleMarkups } from "@/varer/hooks/useHandelsvarer";
import { HandelsvareLinkDialog, type LinkableProduct } from "./HandelsvareLinkDialog";
import type { PriceListLite } from "./MatrixView";

interface Props {
  legalEntityId: string | null;
  userId: string | null;
  priceLists: PriceListLite[];
  prices: Map<string, number>;
  pricesLoading: boolean;
  pendingEdits: Map<string, number>;
  onCellChange: (productId: string, priceListId: string, value: number | null) => void;
  canWrite: boolean;
  search: string;
  products: LinkableProduct[];
}

type Kind = "alle" | "videresalg" | "emballasje";

/**
 * Handelsvarer × prisliste: innpris fra Råvarer (kan ikke endres her), påslag og salgspris.
 * Salgspriser endres bare via prislistenes ulagrede-endringer-linje (set_prices). Ingen egen godkjenning.
 */
export function HandelsvarerView(p: Props) {
  const rowsQ = useHandelsvarer(p.legalEntityId);
  const markups = useResaleMarkups(p.legalEntityId);
  const saveMarkups = useSaveResaleMarkups(p.legalEntityId);
  const [listId, setListId] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("alle");
  const [draft, setDraft] = useState<Map<string, MarkupChange>>(new Map());
  const [linkFor, setLinkFor] = useState<ResaleMaterial | null>(null);

  const lists = p.priceLists;
  const selected = lists.find((l) => l.id === listId) ?? lists.find((l) => l.code === "engros_base") ?? lists[0] ?? null;
  const stored = markups.data?.rows ?? [];
  const idx = useMemo(
    () => indexMarkups(applyMarkupDraft(stored, [...draft.values()]), markups.data?.defaultFactor ?? null),
    [stored, draft, markups.data?.defaultFactor],
  );

  const rows = useMemo(() => {
    const t = p.search.trim().toLowerCase();
    return (rowsQ.data ?? []).filter((r) =>
      (kind === "alle" || r.material.itemType === kind) &&
      (!t || r.material.name.toLowerCase().includes(t) || (r.link?.productName.toLowerCase().includes(t) ?? false) ||
        (r.link?.productNumber != null && String(r.link.productNumber).startsWith(t))));
  }, [rowsQ.data, kind, p.search]);

  const putDraft = (c: MarkupChange) => setDraft((prev) => new Map(prev).set(changeKey(c), c));

  const computed = useMemo(() => {
    if (!selected) return [];
    return rows.map((r) => {
      const purchase = purchasePerSoldUnit(r.material, r.link);
      const ef = effectiveFactor(idx, r.material.id, selected.id);
      const blocked = isBlocked(idx, r.material.id, selected.id);
      const noMarkup = isNoMarkupList(selected.code);
      const key = r.link ? `${r.link.productId}::${selected.id}` : null;
      const current = key ? p.prices.get(key) ?? null : null;
      const pending = key ? p.pendingEdits.get(key) ?? null : null;
      const suggestedList = toListPrice(suggestedPrice(purchase, ef.factor), selected.prices_include_mva, r.link?.mvaRate ?? null);
      const status = cellStatus({ blocked, noMarkup, linked: !!r.link, suggested: suggestedList, current });
      const shown = pending ?? current;
      const exVat = shown == null ? null : selected.prices_include_mva ? shown / (1 + (r.link?.mvaRate ?? 15) / 100) : shown;
      return { r, purchase, ef, blocked, current, pending, status, margin: marginPerUnit(exVat, purchase) };
    });
  }, [rows, selected, idx, p.prices, p.pendingEdits]);

  const suggestions = computed.filter((c) => c.status.kind === "forslag" && c.r.link && c.pending == null);

  function applyAll() {
    if (!selected) return;
    for (const c of suggestions) {
      if (c.status.kind === "forslag" && c.r.link) p.onCellChange(c.r.link.productId, selected.id, c.status.suggested);
    }
    toast.info(`${suggestions.length} forslag lagt i ulagrede endringer. Ingenting er lagret før du trykker Lagre.`);
  }

  async function saveDraft() {
    try {
      const n = await saveMarkups.mutateAsync({ changes: [...draft.values()], existing: stored, userId: p.userId });
      setDraft(new Map());
      toast.success(`${n} påslag lagret`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Påslaget ble ikke lagret.");
    }
  }

  if (rowsQ.isLoading || p.pricesLoading) {
    return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  if (rowsQ.isError) return <p className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">Kunne ikke hente handelsvarene. Last inn siden på nytt.</p>;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="hv-std">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="hv-std" className="text-sm font-semibold">Standard påslag per prisgruppe</h2>
          <p className="text-xs text-muted-foreground">Faktor på innpris. 1,2 = 20 % påslag. Innpris kommer fra Råvarer og kan ikke endres her.</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          {lists.map((l) => {
            const none = isNoMarkupList(l.code);
            const f = idx.list.get(l.id);
            return (
              <label key={l.id} className="flex min-w-40 flex-col gap-1 rounded-md border border-border px-3 py-2 text-sm">
                <span className="font-medium">{l.display_name}</span>
                {none ? <span className="text-xs text-muted-foreground">Ingen påslag</span> : (
                  <Input
                    key={`${l.id}:${f ?? ""}`}
                    aria-label={`Standard påslag for ${l.display_name}`}
                    inputMode="decimal" className="h-9 w-24" disabled={!p.canWrite}
                    defaultValue={f != null ? nNum(f, 2) : ""}
                    placeholder={nNum(effectiveFactor(indexMarkups([], idx.defaultFactor), "-", l.id).factor, 2)}
                    onBlur={(e) => {
                      const v = e.currentTarget.value.trim();
                      const parsed = v === "" ? null : parseFactor(v);
                      if (v !== "" && parsed == null) { toast.error("Skriv en faktor mellom 0,5 og 10, f.eks. 1,2"); return; }
                      if (parsed !== (f ?? null)) putDraft({ kind: "list", priceListId: l.id, factor: parsed });
                    }}
                  />
                )}
              </label>
            );
          })}
        </div>
        {draft.size > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <span className="font-medium">{draft.size} ulagret{draft.size === 1 ? "" : "e"} påslag</span>
            {markups.cap === true ? (
              <span className="text-muted-foreground">Forslagene under bruker allerede de nye påslagene.</span>
            ) : (
              <span className="text-muted-foreground">Påslag kan lagres når databaseendringen «Handelsvarer» er kjørt. Til da gjelder de bare forslagene i dette vinduet.</span>
            )}
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDraft(new Map())} disabled={saveMarkups.isPending}>Forkast</Button>
              {markups.cap === true && (
                <Button size="sm" onClick={saveDraft} disabled={saveMarkups.isPending}>
                  {saveMarkups.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Lagre påslag
                </Button>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Prisgruppe:</span>
        {lists.map((l) => (
          <Button key={l.id} size="sm" variant={selected?.id === l.id ? "default" : "outline"} aria-pressed={selected?.id === l.id} onClick={() => setListId(l.id)}>
            {l.display_name}
          </Button>
        ))}
        <span className="ml-4 text-sm text-muted-foreground">Vis:</span>
        {(["alle", "videresalg", "emballasje"] as const).map((k) => (
          <Button key={k} size="sm" variant={kind === k ? "secondary" : "ghost"} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k === "alle" ? "Alle" : k === "videresalg" ? "Videresalg" : "Emballasje"}
          </Button>
        ))}
        {p.canWrite && suggestions.length > 0 && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={applyAll}>
            <Sparkles className="mr-1.5 h-4 w-4" />Bruk alle forslag ({suggestions.length})
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Vare</th>
              <th className="px-3 py-2 text-right font-medium">Innpris eks. mva</th>
              <th className="px-3 py-2 font-medium">Påslag</th>
              <th className="px-3 py-2 text-right font-medium">Salgspris {selected?.prices_include_mva ? "inkl." : "eks."} mva</th>
              <th className="px-3 py-2 text-right font-medium">Igjen per forpakning</th>
            </tr>
          </thead>
          <tbody>
            {computed.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">Ingen handelsvarer passer søket.</td></tr>
            )}
            {selected && computed.map(({ r, purchase, ef, blocked, current, pending, status, margin }) => {
              const unitCost = usableCost(r.material);
              const cellF = idx.cell.get(`${r.material.id}::${selected.id}`)?.factor ?? null;
              return (
                <tr key={r.material.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.material.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {[r.material.supplierName, r.material.itemType === "emballasje" ? "Emballasje" : "Videresalg"].filter(Boolean).join(" · ")}
                    </div>
                    {r.link ? (
                      <div className="text-xs text-muted-foreground">
                        Selges som #{r.link.productNumber ?? "–"} {r.link.productName}
                        {r.link.baseUnitsPerSoldUnit != null && ` · ${nNum(r.link.baseUnitsPerSoldUnit, 0)} ${r.material.baseUnit ?? ""} per vare`}
                        {r.linkCount > 1 && ` · +${r.linkCount - 1} til`}
                      </div>
                    ) : p.canWrite ? (
                      <Button size="sm" variant="link" className="h-auto px-0 text-xs" onClick={() => setLinkFor(r.material)}>
                        <Link2 className="mr-1 h-3.5 w-3.5" />Koble til vare
                      </Button>
                    ) : <div className="text-xs text-muted-foreground">Ikke koblet til en vare</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <div>{purchase != null ? nKr(purchase) : "–"}</div>
                    <div className="text-xs text-muted-foreground">
                      {unitCost != null ? `${nKr(unitCost)} per ${r.material.baseUnit ?? "enhet"}` : "Mangler verifisert kostpris"}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {isNoMarkupList(selected.code) ? <span className="text-xs text-muted-foreground">Ingen påslag</span> : (
                      <>
                        <Input
                          key={`${r.material.id}:${selected.id}:${cellF ?? ""}`}
                          aria-label={`Påslag for ${r.material.name} i ${selected.display_name}`}
                          inputMode="decimal" className="h-9 w-20" disabled={!p.canWrite}
                          defaultValue={cellF != null ? nNum(cellF, 2) : ""} placeholder={nNum(ef.factor, 2)}
                          onBlur={(e) => {
                            const v = e.currentTarget.value.trim();
                            const parsed = v === "" ? null : parseFactor(v);
                            if (v !== "" && parsed == null) { toast.error("Skriv en faktor mellom 0,5 og 10, f.eks. 1,2"); return; }
                            if (parsed !== cellF) putDraft({ kind: "cell", priceListId: selected.id, rawMaterialId: r.material.id, factor: parsed, blocked });
                          }}
                        />
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {cellF == null ? `${FACTOR_SOURCE_LABEL[ef.source]} · +${nNum(factorAsPct(ef.factor), 1)} %` : FACTOR_SOURCE_LABEL.vare_prisliste}
                        </div>
                        {markups.cap === true && p.canWrite && r.link && (
                          <Button size="sm" variant="link" className="h-auto px-0 text-xs"
                            onClick={() => putDraft({ kind: "cell", priceListId: selected.id, rawMaterialId: r.material.id, factor: cellF, blocked: !blocked })}>
                            <Ban className="mr-1 h-3.5 w-3.5" />{blocked ? "Opphev sperre" : "Sperr i denne prislisten"}
                          </Button>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <div className={cn(pending != null && "font-semibold")}>{pending != null ? `${nKr(pending)} (ulagret)` : current != null ? nKr(current) : "Ingen pris"}</div>
                    <CellHint status={status} canWrite={p.canWrite} hasPending={pending != null}
                      onApply={(v) => r.link && p.onCellChange(r.link.productId, selected.id, v)} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{margin != null ? nKr(margin) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Forslag endrer ingenting før du lagrer i linjen nederst. Solgt og igjen siste 30 dager vises ikke ennå.
      </p>

      <HandelsvareLinkDialog open={!!linkFor} onOpenChange={(o) => !o && setLinkFor(null)} material={linkFor}
        products={p.products} legalEntityId={p.legalEntityId} userId={p.userId} />
    </div>
  );
}

function CellHint({ status, canWrite, hasPending, onApply }: {
  status: ReturnType<typeof cellStatus>; canWrite: boolean; hasPending: boolean; onApply: (v: number) => void;
}) {
  const muted = "text-xs text-muted-foreground";
  switch (status.kind) {
    case "sperret": return <div className={muted}>Sperret – endres bare manuelt</div>;
    case "uten_pasla": return <div className={muted}>Ingen påslag i denne prislisten</div>;
    case "ikke_koblet": return <div className={muted}>Koble til en vare for å få forslag</div>;
    case "mangler_kost": return <div className={muted}>Ingen forslag: mangler verifisert kostpris</div>;
    case "lik": return <div className={muted}>Følger påslaget</div>;
    case "forslag":
      if (hasPending || !canWrite) return <div className={muted}>Forslag {nKr(status.suggested)}</div>;
      return (
        <Button size="sm" variant="link" className="h-auto px-0 text-xs" onClick={() => onApply(status.suggested)}>
          Bruk forslag {nKr(status.suggested)}
        </Button>
      );
  }
}
