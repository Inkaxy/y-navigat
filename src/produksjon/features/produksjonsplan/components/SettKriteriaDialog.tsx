import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X } from "lucide-react";
import {
  useToursForEntity,
  useMainCategories,
  useSubCategories,
  useCustomerGroupsForEntity,
} from "../hooks/useReferenceData";
import { DEFAULT_CRITERIA, type ProduksjonsplanCriteria } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  legalEntityId: string | null;
  initial: ProduksjonsplanCriteria;
  onApply: (c: ProduksjonsplanCriteria) => void;
}

export function SettKriteriaDialog({ open, onOpenChange, legalEntityId, initial, onApply }: Props) {
  const [c, setC] = useState<ProduksjonsplanCriteria>(initial);
  useEffect(() => { if (open) setC(initial); }, [open, initial]);

  const tours = useToursForEntity(legalEntityId);
  const mains = useMainCategories(legalEntityId);
  const subs = useSubCategories(legalEntityId);
  const groups = useCustomerGroupsForEntity(legalEntityId);

  const [groupQuery, setGroupQuery] = useState("");

  const toggleArr = <T,>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const apply = () => { onApply(c); onOpenChange(false); };
  const reset = () => setC(DEFAULT_CRITERIA);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[95vh] h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Sett kriteria for produksjonsplan</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 pr-3 -mr-3">
          <div className="space-y-6 py-2">
            {/* Tur */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Tur</h3>
              <div className="flex flex-wrap gap-2">
                {(tours.data ?? []).map((t) => {
                  const active = c.tour_numbers.includes(t.tour_number);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setC({ ...c, tour_numbers: toggleArr(c.tour_numbers, t.tour_number) })}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background hover:bg-accent border-border"
                      }`}
                    >
                      Tur {t.tour_number}
                    </button>
                  );
                })}
                {tours.data?.length === 0 && (
                  <span className="text-sm text-muted-foreground">Ingen turer definert</span>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={c.sum_tours}
                  onCheckedChange={(v) => setC({ ...c, sum_tours: !!v })}
                />
                Summere turer
              </label>
            </section>

            {/* Hovedvaregrupper */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">
                Velg hovedvaregrupper {c.main_category_ids.length === 0 && <span className="text-muted-foreground font-normal">(Alle)</span>}
              </h3>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1 max-h-44 overflow-auto rounded-md border border-border p-2">
                {(mains.data ?? []).map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm py-0.5">
                    <Checkbox
                      checked={c.main_category_ids.includes(m.id)}
                      onCheckedChange={() => setC({ ...c, main_category_ids: toggleArr(c.main_category_ids, m.id) })}
                    />
                    <span className="font-mono text-xs">{m.code}</span>
                    <span className="truncate text-xs text-muted-foreground">{m.display_name}</span>
                  </label>
                ))}
              </div>
            </section>

            {/* Undervaregrupper */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">
                Velg undervaregrupper {c.sub_category_ids.length === 0 && <span className="text-muted-foreground font-normal">(Alle)</span>}
              </h3>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1 max-h-32 overflow-auto rounded-md border border-border p-2">
                {(subs.data ?? []).map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm py-0.5">
                    <Checkbox
                      checked={c.sub_category_ids.includes(s.id)}
                      onCheckedChange={() => setC({ ...c, sub_category_ids: toggleArr(c.sub_category_ids, s.id) })}
                    />
                    <span className="font-mono text-xs">{s.code}</span>
                  </label>
                ))}
                {subs.data?.length === 0 && (
                  <span className="text-xs text-muted-foreground">Ingen undervaregrupper</span>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={c.include_products_without_subcategory}
                  onCheckedChange={(v) => setC({ ...c, include_products_without_subcategory: !!v })}
                />
                Varer uten undervaregruppe skal være med
              </label>
            </section>

            {/* Aggregering */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Slå sammen til produksjonsvarer</h3>
              <RadioGroup value={c.aggregation} onValueChange={(v) => setC({ ...c, aggregation: v as ProduksjonsplanCriteria["aggregation"] })}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="per_product" id="agg-1" />
                  <Label htmlFor="agg-1" className="text-sm font-normal">Pr varenr</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="per_main_and_production_group" id="agg-2" />
                  <Label htmlFor="agg-2" className="text-sm font-normal">Pr hovedgrp. + produksjonsgrp</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="per_production_group" id="agg-3" />
                  <Label htmlFor="agg-3" className="text-sm font-normal">Pr produksjonsgruppe</Label>
                </div>
              </RadioGroup>
            </section>

            {/* Sortering */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Varesortering</h3>
              <RadioGroup value={c.sort_by} onValueChange={(v) => setC({ ...c, sort_by: v as ProduksjonsplanCriteria["sort_by"] })}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="default" id="sort-1" />
                  <Label htmlFor="sort-1" className="text-sm font-normal">Bruk standard varesortering</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="product_number" id="sort-2" />
                  <Label htmlFor="sort-2" className="text-sm font-normal">Sortere etter varenummer</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="product_name" id="sort-3" />
                  <Label htmlFor="sort-3" className="text-sm font-normal">Sortere etter varenavn</Label>
                </div>
              </RadioGroup>
            </section>

            {/* Kundegrupper */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">
                Kundegrupper {c.customer_group_ids.length === 0 && <span className="text-muted-foreground font-normal">(Alle)</span>}
              </h3>
              <div className="flex flex-wrap gap-1">
                {c.customer_group_ids.map((gid) => {
                  const g = groups.data?.find((x) => x.id === gid);
                  return (
                    <Badge key={gid} variant="secondary" className="gap-1">
                      {g?.display_name ?? gid}
                      <button
                        type="button"
                        onClick={() => setC({ ...c, customer_group_ids: c.customer_group_ids.filter((x) => x !== gid) })}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
              <Input
                placeholder="velg salgsgrupper..."
                value={groupQuery}
                onChange={(e) => setGroupQuery(e.target.value)}
              />
              {groupQuery && (
                <div className="max-h-32 overflow-auto rounded-md border border-border">
                  {(groups.data ?? [])
                    .filter((g) => !c.customer_group_ids.includes(g.id))
                    .filter((g) => {
                      const q = groupQuery.toLowerCase();
                      if (q === "*" || q === "?") return true;
                      return g.display_name.toLowerCase().includes(q) || g.code.toLowerCase().includes(q);
                    })
                    .slice(0, 20)
                    .map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => {
                          setC({ ...c, customer_group_ids: [...c.customer_group_ids, g.id] });
                          setGroupQuery("");
                        }}
                        className="block w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
                      >
                        <span className="font-mono text-xs mr-2">{g.code}</span>
                        {g.display_name}
                      </button>
                    ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Skriv * eller ? for å se alle.</p>
            </section>

            {/* Utskrift */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Utskrift</h3>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={!!c.print_correction_last}
                  onCheckedChange={(v) => setC({ ...c, print_correction_last: !!v })}
                />
                Skriv ut korreksjonsliste etter hovedlista (+/- mot forrige utskrift samme dag)
              </label>
            </section>
          </div>
        </ScrollArea>
        <DialogFooter className="border-t border-border pt-4 flex sm:justify-between">
          <Button variant="outline" onClick={reset}>Nullstill</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Avbryt</Button>
            <Button onClick={apply}>Bruk</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
