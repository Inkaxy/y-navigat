import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { invalidateInvoice, invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { CANONICAL_BASE_UNITS, CANONICAL_PACKAGE_UNITS, deriveLinePackage, parseDecimal, resolveLineCost } from "@/fakturaer/lib/units";

export interface BulkLine {
  id: string;
  description: string | null;
  supplier_sku: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total_amount: number | null;
  package_size?: number | null;
  package_unit?: string | null;
  count_per_package?: number | null;
}

interface Suggestion {
  line_id: string;
  sku: string | null;
  category: string | null;
  base_unit: string | null;
  confidence: number | null;
}

interface RowState {
  selected: boolean;
  name: string;
  sku: string;
  category: string;
  base_unit: string;
  package_size: string;
  package_unit: string;
  price_per_base_unit: string;
  /** Hvor pakningsinformasjonen kom fra, for å forklare verdien i grensesnittet. */
  package_source: "line" | "description" | null;
  set_primary: boolean;
  ai_sku: boolean;
  ai_category: boolean;
  ai_base_unit: boolean;
}

import { CategorySelectItems } from "@/ravarer/components/CategorySelectItems";

const FALLBACK_CATEGORY = "Importert – ikke kategorisert";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoiceId: string;
  legalEntityId: string;
  lines: BulkLine[];
  onComplete?: () => void;
}

const num = parseDecimal;

/**
 * Total pakningsstørrelse for en linje — felles utledning med match-skuffen.
 * `package_size` er per sub-enhet og ganges med `count_per_package`.
 */
function derivePackage(l: BulkLine): { size: number; unit: string; source: "line" | "description" } | null {
  return deriveLinePackage({
    package_size: l.package_size ?? null,
    package_unit: l.package_unit ?? null,
    count_per_package: l.count_per_package ?? null,
    description: l.description ?? null,
  });
}

/** Kostpris per baseenhet via kostprismotoren — beløp ÷ mengde i baseenhet. */
function deriveCost(l: BulkLine, baseUnit: string, pkgSize: number | null, pkgUnit: string | null) {
  if (!baseUnit) return null;
  return resolveLineCost({
    quantity: l.quantity,
    unit: l.unit,
    unitPrice: l.unit_price,
    totalAmount: l.total_amount,
    packageSize: l.package_size ?? null,
    packageUnit: l.package_unit ?? null,
    countPerPackage: l.count_per_package ?? null,
    description: l.description ?? null,
    baseUnit,
    supplierPackage: pkgSize && pkgSize > 0 ? { packageSize: pkgSize, packageUnit: pkgUnit ?? baseUnit } : null,
  });
}

function derivePricePerBaseUnit(l: BulkLine, baseUnit: string, pkgSize: number | null, pkgUnit: string | null): number | null {
  const c = deriveCost(l, baseUnit, pkgSize, pkgUnit);
  if (!c || c.needsInput) return null;
  return Number(c.pricePerBaseUnit.toFixed(4));
}

export function BulkImportRawMaterialsDrawer({ open, onOpenChange, invoiceId, legalEntityId, lines, onComplete }: Props) {
  const qc = useQueryClient();
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [skipped, setSkipped] = useState<Array<{ line_id: string; reason: string }>>([]);

  useEffect(() => {
    if (!open) return;
    const init: Record<string, RowState> = {};
    for (const l of lines) {
      const pkg = derivePackage(l);
      init[l.id] = {
        selected: true,
        name: l.description ?? "",
        sku: l.supplier_sku ?? "",
        category: "",
        base_unit: "",
        package_size: pkg ? String(pkg.size) : "",
        package_unit: pkg?.unit ?? "",
        // Pris per baseenhet kan først regnes ut når baseenhet er valgt (AI-forslag eller manuelt).
        price_per_base_unit: "",
        package_source: pkg?.source ?? null,
        set_primary: true,
        ai_sku: false,
        ai_category: false,
        ai_base_unit: false,
      };
    }
    setRows(init);
    setSkipped([]);
    void fetchSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceId]);

  async function fetchSuggestions() {
    if (lines.length === 0) return;
    setLoadingSuggestions(true);
    try {
      const { data, error } = await supabase.functions.invoke("suggest-raw-material-fields", {
        body: {
          legal_entity_id: legalEntityId,
          lines: lines.map((l) => ({
            line_id: l.id,
            description: l.description,
            sku: l.supplier_sku,
            quantity: l.quantity,
            unit: l.unit,
            unit_price: l.unit_price,
          })),
        },
      });
      if (error) throw error;
      const sugs = (data?.suggestions ?? []) as Suggestion[];
      setRows((prev) => {
        const next = { ...prev };
        for (const s of sugs) {
          const r = next[s.line_id];
          if (!r) continue;
          const lowConf = (s.confidence ?? 0) < 0.5;
          const cat = lowConf ? FALLBACK_CATEGORY : (s.category ?? FALLBACK_CATEGORY);
          if (!r.sku && s.sku) { r.sku = s.sku; r.ai_sku = true; }
          if (!r.category) { r.category = cat; r.ai_category = !lowConf && !!s.category; }
          if (!r.base_unit && s.base_unit) { r.base_unit = s.base_unit; r.ai_base_unit = true; }

          // Regn ut pris per baseenhet — aldri gjett. Klarer vi det ikke, lar vi feltet stå tomt.
          const line = lines.find((l) => l.id === s.line_id);
          if (line && r.base_unit && !r.price_per_base_unit) {
            const ppbu = derivePricePerBaseUnit(line, r.base_unit, num(r.package_size), r.package_unit || null);
            r.price_per_base_unit = ppbu != null ? String(ppbu) : "";
          }
        }
        return next;
      });
    } catch (e: any) {
      toast.error(`AI-forslag feilet: ${e.message ?? e}`);
    } finally {
      setLoadingSuggestions(false);
    }
  }

  function patch(lineId: string, p: Partial<RowState>) {
    setRows((prev) => {
      const cur = prev[lineId];
      const merged = { ...cur, ...p };
      // Regn prisen på nytt når enhet eller pakning endres, men aldri over en verdi
      // brukeren selv har skrevet inn.
      const priceTouched = Object.prototype.hasOwnProperty.call(p, "price_per_base_unit");
      const recalcTrigger = ["base_unit", "package_size", "package_unit"].some((k) =>
        Object.prototype.hasOwnProperty.call(p, k),
      );
      if (!priceTouched && recalcTrigger) {
        const line = lines.find((l) => l.id === lineId);
        if (line && merged.base_unit) {
          const ppbu = derivePricePerBaseUnit(line, merged.base_unit, num(merged.package_size), merged.package_unit || null);
          merged.price_per_base_unit = ppbu != null ? String(ppbu) : "";
        }
      }
      return { ...prev, [lineId]: merged };
    });
  }

  function applyToAll(field: "category" | "base_unit", value: string) {
    setRows((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        next[id] = { ...next[id], [field]: value, ...(field === "category" ? { ai_category: false } : { ai_base_unit: false }) };
        if (field === "base_unit") {
          const line = lines.find((l) => l.id === id);
          if (line) {
            const r = next[id];
            const ppbu = derivePricePerBaseUnit(line, value, num(r.package_size), r.package_unit || null);
            next[id] = { ...r, price_per_base_unit: ppbu != null ? String(ppbu) : "" };
          }
        }
      }
      return next;
    });
  }

  const selectedCount = useMemo(() => Object.values(rows).filter((r) => r.selected).length, [rows]);
  const missingPriceCount = useMemo(
    () => Object.values(rows).filter((r) => r.selected && !r.price_per_base_unit.trim()).length,
    [rows],
  );

  const importMutation = useMutation({
    mutationFn: async (onlySelected: boolean) => {
      const items = lines
        .filter((l) => (onlySelected ? rows[l.id]?.selected : true))
        .map((l) => {
          const r = rows[l.id];
          const pkgSize = num(r.package_size);
          const ppbu = num(r.price_per_base_unit);
          // Avtalepris på leverandørkoblingen = pris per PAKKE, ikke linjens totalbeløp.
          const pricePerPackage = ppbu != null && pkgSize != null ? Number((ppbu * pkgSize).toFixed(4)) : l.unit_price ?? null;
          return {
            line_id: l.id,
            name: r.name.trim(),
            sku: r.sku.trim(),
            category: r.category || FALLBACK_CATEGORY,
            base_unit: r.base_unit,
            package_size: pkgSize,
            package_unit: r.package_unit || null,
            agreed_price: pricePerPackage,
            /** Pris per baseenhet fra denne fakturaen — IKKE en framforhandlet avtalepris. */
            price_per_base_unit: ppbu,
            set_primary: r.set_primary,
            supplier_sku: l.supplier_sku,
            supplier_product_name: l.description,
          };
        });
      const { data, error } = await supabase.functions.invoke("bulk-import-raw-materials-from-invoice", {
        body: { invoice_id: invoiceId, items },
      });
      if (error) throw error;
      return data as { created: any[]; skipped: Array<{ line_id: string; reason: string }> };
    },
    onSuccess: (res) => {
      const created = res.created?.length ?? 0;
      const skippedRows = res.skipped ?? [];
      if (created > 0) {
        toast.success(`${created} nye råvarer opprettet og koblet til fakturaen. Husk å fylle inn næringsinnhold senere.`, {
          action: { label: "Vis", onClick: () => window.location.assign("/ravarer/vareliste") },
        });
      }
      // Samme invalidering som enkeltopprettelse (CreateRawMaterialDialog/MatchDrawer),
      // slik at vareliste, behandlingskø og fakturaen viser fersk tilstand.
      invalidateRawMaterial(qc);
      invalidateInvoice(qc, invoiceId);

      setSkipped(skippedRows);
      if (skippedRows.length > 0) {
        toast.warning(`${skippedRows.length} linjer ble hoppet over — se årsakene i skuffen.`);
      }
      onComplete?.();
      if (skippedRows.length === 0) onOpenChange(false);
    },
    onError: (e: any) => toast.error(`Import feilet: ${e.message ?? e}`),
  });

  const skippedByLine = useMemo(() => {
    const m: Record<string, string> = {};
    skipped.forEach((s) => { m[s.line_id] = s.reason; });
    return m;
  }, [skipped]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-4xl sm:max-w-4xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Importer som nye råvarer</SheetTitle>
          <SheetDescription>
            {loadingSuggestions
              ? "AI analyserer linjene og foreslår kategorier, enheter og SKU-er…"
              : `${lines.length} linjer klare for import. AI-forslag er markert med ✨.`}
          </SheetDescription>
        </SheetHeader>

        {loadingSuggestions && (
          <div className="my-6 flex items-center justify-center text-ink-secondary">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Henter AI-forslag…
          </div>
        )}

        {!loadingSuggestions && (
          <>
            {skipped.length > 0 && (
              <div className="my-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-warning">
                  <AlertTriangle className="h-4 w-4" /> {skipped.length} linjer ble hoppet over
                </div>
                <ul className="space-y-1 text-xs text-ink-secondary">
                  {skipped.map((s) => {
                    const line = lines.find((l) => l.id === s.line_id);
                    return (
                      <li key={s.line_id}>
                        <span className="font-medium">{line?.description ?? s.line_id}</span> — {s.reason}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {missingPriceCount > 0 && (
              <div className="my-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                {missingPriceCount} av de valgte linjene mangler pris per baseenhet. De importeres uten pris og blir
                liggende til gjennomgang.
              </div>
            )}

            <div className="my-4 flex flex-wrap items-center gap-3 border-b border-line-subtle pb-4">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-ink-secondary">Kategori for alle:</Label>
                <Select onValueChange={(v) => applyToAll("category", v)}>
                  <SelectTrigger className="h-8 w-[180px]"><SelectValue placeholder="Velg…" /></SelectTrigger>
                  <SelectContent>
                    <CategorySelectItems existing={[FALLBACK_CATEGORY]} />
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-ink-secondary">Enhet for alle:</Label>
                <Select onValueChange={(v) => applyToAll("base_unit", v)}>
                  <SelectTrigger className="h-8 w-[120px]"><SelectValue placeholder="Velg…" /></SelectTrigger>
                  <SelectContent>
                    {CANONICAL_BASE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3">
              {lines.map((l) => {
                const r = rows[l.id];
                if (!r) return null;
                const noPrice = !r.price_per_base_unit.trim();
                const rowCost = r.base_unit
                  ? deriveCost(l, r.base_unit, num(r.package_size), r.package_unit || null)
                  : null;
                return (
                  <div
                    key={l.id}
                    className={`rounded-lg border p-3 ${noPrice ? "border-warning/50 bg-warning/5" : "border-line-subtle"}`}
                  >
                    <div className="mb-2 flex items-start gap-2">
                      <Checkbox checked={r.selected} onCheckedChange={(c) => patch(l.id, { selected: !!c })} className="mt-1" />
                      <div className="flex-1 text-xs text-ink-secondary">
                        <div className="font-mono">{l.supplier_sku ?? "—"}</div>
                        <div>{l.description}</div>
                        <div>Antall: {l.quantity} {l.unit} · Pris: {l.unit_price}</div>
                        {skippedByLine[l.id] && (
                          <div className="mt-1 font-medium text-warning">Hoppet over: {skippedByLine[l.id]}</div>
                        )}
                      </div>
                    </div>
                    {rowCost && !rowCost.needsInput && (
                      <div className="mb-2 rounded border border-line-subtle bg-muted/30 px-2 py-1 text-xs text-ink-secondary">
                        {rowCost.explanation}
                      </div>
                    )}
                    {noPrice && (
                      <div className="mb-2 flex items-center gap-1.5 rounded border border-warning/40 bg-warning/10 px-2 py-1 text-xs font-medium text-warning">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {rowCost?.reason ?? "Pris per baseenhet kunne ikke beregnes — fyll inn manuelt"}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="col-span-2">
                        <Label className="text-xs">Navn</Label>
                        <Input className="h-8" value={r.name} onChange={(e) => patch(l.id, { name: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs flex items-center gap-1">
                          SKU {r.ai_sku && <Sparkles className="h-3 w-3 text-primary" aria-label="AI-forslag" />}
                        </Label>
                        <Input className="h-8" value={r.sku} onChange={(e) => patch(l.id, { sku: e.target.value, ai_sku: false })} />
                      </div>
                      <div>
                        <Label className="text-xs flex items-center gap-1">
                          Enhet {r.ai_base_unit && <Sparkles className="h-3 w-3 text-primary" />}
                        </Label>
                        <Select value={r.base_unit} onValueChange={(v) => patch(l.id, { base_unit: v, ai_base_unit: false })}>
                          <SelectTrigger className="h-8"><SelectValue placeholder="Velg" /></SelectTrigger>
                          <SelectContent>
                            {CANONICAL_BASE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs flex items-center gap-1">
                          Kategori {r.ai_category && <Sparkles className="h-3 w-3 text-primary" />}
                        </Label>
                        <Select value={r.category} onValueChange={(v) => patch(l.id, { category: v, ai_category: false })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <CategorySelectItems existing={[FALLBACK_CATEGORY, r.category]} />
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">
                          Pakn.str
                          {r.package_source === "description" && (
                            <span className="ml-1 text-[10px] text-ink-secondary">(fra beskrivelse)</span>
                          )}
                        </Label>
                        <Input className="h-8" value={r.package_size} onChange={(e) => patch(l.id, { package_size: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs">Pakn.enhet (baseenhet)</Label>
                        <Select value={r.package_unit} onValueChange={(v) => patch(l.id, { package_unit: v })}>
                          <SelectTrigger className="h-8"><SelectValue placeholder="Velg" /></SelectTrigger>
                          <SelectContent>
                            {[...CANONICAL_BASE_UNITS, ...CANONICAL_PACKAGE_UNITS].map((u) => (
                              <SelectItem key={u} value={u}>{u}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs">Pris pr {r.base_unit || "baseenhet"}</Label>
                        <Input
                          className={`h-8 ${noPrice ? "border-warning" : ""}`}
                          value={r.price_per_base_unit}
                          placeholder="Kunne ikke beregnes"
                          onChange={(e) => patch(l.id, { price_per_base_unit: e.target.value })}
                        />
                      </div>
                      <div className="col-span-2 flex items-center gap-2">
                        <Checkbox checked={r.set_primary} onCheckedChange={(c) => patch(l.id, { set_primary: !!c })} />
                        <Label className="text-xs">Sett denne leverandøren som primær</Label>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <SheetFooter className="mt-6 flex-row justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importMutation.isPending}>Lukk</Button>
          <Button variant="outline" onClick={() => importMutation.mutate(true)} disabled={importMutation.isPending || selectedCount === 0}>
            Importer kun valgte ({selectedCount})
          </Button>
          <Button onClick={() => importMutation.mutate(false)} disabled={importMutation.isPending || loadingSuggestions}>
            {importMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Importer alle ({lines.length})
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
