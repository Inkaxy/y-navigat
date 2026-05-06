import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

export interface BulkLine {
  id: string;
  description: string | null;
  supplier_sku: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total_amount: number | null;
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
  set_primary: boolean;
  ai_sku: boolean;
  ai_category: boolean;
  ai_base_unit: boolean;
}

const CATEGORIES = [
  "mel", "sukker", "fett", "frø", "frukt_baer", "smaksetting",
  "gjær", "salt", "egg", "meieri", "sjokolade", "noetter",
  "krydder", "konserveringsmiddel", "emballasje", "annet",
];
const FALLBACK_CATEGORY = "Importert – ikke kategorisert";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoiceId: string;
  legalEntityId: string;
  lines: BulkLine[];
  onComplete?: () => void;
}

export function BulkImportRawMaterialsDrawer({ open, onOpenChange, invoiceId, legalEntityId, lines, onComplete }: Props) {
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [rows, setRows] = useState<Record<string, RowState>>({});

  useEffect(() => {
    if (!open) return;
    const init: Record<string, RowState> = {};
    for (const l of lines) {
      const ppbu = l.quantity && l.unit_price ? (l.unit_price).toString() : "";
      init[l.id] = {
        selected: true,
        name: l.description ?? "",
        sku: l.supplier_sku ?? "",
        category: "",
        base_unit: "",
        package_size: l.quantity ? String(l.quantity) : "",
        package_unit: l.unit ?? "",
        price_per_base_unit: ppbu,
        set_primary: true,
        ai_sku: false,
        ai_category: false,
        ai_base_unit: false,
      };
    }
    setRows(init);
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
          // Beregn pris pr base unit fra pakningsstr (heuristikk)
          const line = lines.find((l) => l.id === s.line_id);
          if (line && line.quantity && line.unit_price && s.base_unit) {
            // unit_price er pris pr enhet på fakturalinja; antar at base unit er samme som unit
            // Hvis ikke, bruker vi unit_price direkte
            r.price_per_base_unit = String(line.unit_price);
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
    setRows((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...p } }));
  }

  function applyToAll(field: "category" | "base_unit", value: string) {
    setRows((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        next[id] = { ...next[id], [field]: value, ...(field === "category" ? { ai_category: false } : { ai_base_unit: false }) };
      }
      return next;
    });
  }

  const selectedCount = useMemo(() => Object.values(rows).filter((r) => r.selected).length, [rows]);

  const importMutation = useMutation({
    mutationFn: async (onlySelected: boolean) => {
      const items = lines
        .filter((l) => (onlySelected ? rows[l.id]?.selected : true))
        .map((l) => {
          const r = rows[l.id];
          return {
            line_id: l.id,
            name: r.name.trim(),
            sku: r.sku.trim(),
            category: r.category || FALLBACK_CATEGORY,
            base_unit: r.base_unit,
            package_size: r.package_size ? parseFloat(r.package_size.replace(",", ".")) : null,
            package_unit: r.package_unit || null,
            agreed_price: l.unit_price && r.package_size ? parseFloat(r.package_size.replace(",", ".")) * l.unit_price : l.unit_price ?? null,
            agreed_price_per_base_unit: r.price_per_base_unit ? parseFloat(r.price_per_base_unit.replace(",", ".")) : null,
            set_primary: r.set_primary,
            supplier_sku: l.supplier_sku,
            supplier_product_name: l.description,
          };
        });
      const { data, error } = await supabase.functions.invoke("bulk-import-raw-materials-from-invoice", {
        body: { invoice_id: invoiceId, items },
      });
      if (error) throw error;
      return data as { created: any[]; skipped: any[] };
    },
    onSuccess: (res) => {
      const created = res.created?.length ?? 0;
      const skipped = res.skipped?.length ?? 0;
      if (created > 0) {
        toast.success(`${created} nye råvarer opprettet og koblet til fakturaen. Husk å fylle inn næringsinnhold senere.`, {
          action: { label: "Vis", onClick: () => window.location.assign("/ravarer/vareliste") },
        });
      }
      if (skipped > 0) toast.warning(`${skipped} linjer ble hoppet over (se konsoll).`);
      console.log("bulk-import skipped:", res.skipped);
      onComplete?.();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(`Import feilet: ${e.message ?? e}`),
  });

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
            <div className="my-4 flex flex-wrap items-center gap-3 border-b border-line-subtle pb-4">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-ink-secondary">Kategori for alle:</Label>
                <Select onValueChange={(v) => applyToAll("category", v)}>
                  <SelectTrigger className="h-8 w-[180px]"><SelectValue placeholder="Velg…" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    <SelectItem value={FALLBACK_CATEGORY}>{FALLBACK_CATEGORY}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-ink-secondary">Enhet for alle:</Label>
                <Select onValueChange={(v) => applyToAll("base_unit", v)}>
                  <SelectTrigger className="h-8 w-[120px]"><SelectValue placeholder="Velg…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kg">kg</SelectItem>
                    <SelectItem value="l">l</SelectItem>
                    <SelectItem value="stk">stk</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3">
              {lines.map((l) => {
                const r = rows[l.id];
                if (!r) return null;
                return (
                  <div key={l.id} className="rounded-lg border border-line-subtle p-3">
                    <div className="mb-2 flex items-start gap-2">
                      <Checkbox checked={r.selected} onCheckedChange={(c) => patch(l.id, { selected: !!c })} className="mt-1" />
                      <div className="flex-1 text-xs text-ink-secondary">
                        <div className="font-mono">{l.supplier_sku ?? "—"}</div>
                        <div>{l.description}</div>
                        <div>Antall: {l.quantity} {l.unit} · Pris: {l.unit_price}</div>
                      </div>
                    </div>
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
                            <SelectItem value="kg">kg</SelectItem>
                            <SelectItem value="l">l</SelectItem>
                            <SelectItem value="stk">stk</SelectItem>
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
                            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            <SelectItem value={FALLBACK_CATEGORY}>{FALLBACK_CATEGORY}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Pakn.str</Label>
                        <Input className="h-8" value={r.package_size} onChange={(e) => patch(l.id, { package_size: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs">Pakn.enhet</Label>
                        <Input className="h-8" value={r.package_unit} onChange={(e) => patch(l.id, { package_unit: e.target.value })} />
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs">Pris pr {r.base_unit || "base unit"}</Label>
                        <Input className="h-8" value={r.price_per_base_unit} onChange={(e) => patch(l.id, { price_per_base_unit: e.target.value })} />
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importMutation.isPending}>Avbryt</Button>
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
