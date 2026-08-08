import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { formatNok } from "@/fakturaer/lib/constants";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

interface Props { open: boolean; onOpenChange: (v: boolean) => void; line: ReviewLineRow | null; }

const UNIT_TO_BASE: Record<string, string> = { g: "kg", kg: "kg", ml: "l", l: "l", stk: "stk", pakke: "stk" };
function toBaseFactor(from: string | null, to: string): number {
  if (!from) return 1;
  if (from === to) return 1;
  const m: Record<string, [string, number]> = { g: ["kg", 0.001], ml: ["l", 0.001] };
  const e = m[from];
  return e && e[0] === to ? e[1] : 1;
}

export function CreateRawMaterialDialog({ open, onOpenChange, line }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [newCategory, setNewCategory] = useState(false);
  const [baseUnit, setBaseUnit] = useState("kg");
  const [packageSize, setPackageSize] = useState<string>("");
  const [packageUnit, setPackageUnit] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!line || !open) return;
    setName(line.description ?? "");
    const inferred = UNIT_TO_BASE[(line.unit ?? "").toLowerCase()] ?? "kg";
    setBaseUnit(inferred);
    // NB: line.quantity er ANTALL pakninger på fakturaen — ikke pakningsstørrelsen.
    // Pakningsstørrelsen må fylles inn manuelt (f.eks. 25 kg pr sekk).
    setPackageSize("");
    setPackageUnit(line.unit ?? "");
    setCategory("");
  }, [line, open]);

  const { data: categories = [] } = useQuery({
    queryKey: ["rm-categories", line?.invoice.legal_entity_id],
    enabled: !!line?.invoice.legal_entity_id,
    queryFn: async () => {
      const { data } = await supabase.from("raw_materials")
        .select("category").eq("legal_entity_id", line!.invoice.legal_entity_id).not("category", "is", null);
      return Array.from(new Set((data ?? []).map((d: any) => d.category as string))).sort();
    },
  });

  async function submit() {
    if (!line || !name.trim() || !category) { toast.error("Navn og kategori er påkrevd"); return; }
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // Kostpris pr baseenhet = pris pr pakning / pakningsstørrelse omregnet til baseenhet.
      // («10 sekker à 25 kg» til 450 kr/sekk => 18 kr/kg, ikke 450 kr/kg.)
      const sizeNum = packageSize ? Number(packageSize) : null;
      const unitForSize = (packageUnit || line.unit || "").toLowerCase();
      const sizeInBase =
        sizeNum && sizeNum > 0 ? sizeNum * toBaseFactor(unitForSize, baseUnit) : null;
      const fallbackFactor = toBaseFactor((line.unit ?? "").toLowerCase(), baseUnit);
      const divisor = sizeInBase && sizeInBase > 0 ? sizeInBase : fallbackFactor;
      const pricePerBase =
        line.unit_price != null && divisor > 0 ? Number(line.unit_price) / divisor : null;
      const nowIso = new Date().toISOString();

      // 1) Raw material
      const skuGen = (line.supplier_sku?.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32)) + "-" + Math.random().toString(36).slice(2, 6);
      const { data: rm, error: rmErr } = await supabase.from("raw_materials").insert({
        legal_entity_id: line.invoice.legal_entity_id,
        sku: skuGen,
        name: name.trim(), category, base_unit: baseUnit,
        package_size: packageSize ? Number(packageSize) : null,
        package_unit: packageUnit || null,
        current_cost_price: pricePerBase ?? 0, price_source: "invoice", price_updated_at: nowIso,
        primary_supplier_id: line.invoice.supplier_id, is_active: true, created_by: user?.id,
      }).select().single();
      if (rmErr) throw rmErr;

      // 2) raw_material_suppliers
      const { data: rms, error: rmsErr } = await supabase.from("raw_material_suppliers").insert({
        raw_material_id: rm.id, supplier_id: line.invoice.supplier_id, is_primary: true,
        supplier_sku: line.supplier_sku, supplier_product_name: line.description,
        agreed_price: line.unit_price, agreed_price_per_base_unit: pricePerBase,
        package_size: packageSize ? Number(packageSize) : null, package_unit: packageUnit || null,
        last_invoice_price: line.unit_price, last_invoice_date: line.invoice.invoice_date,
      }).select().single();
      if (rmsErr) throw rmsErr;

      // 3) Aliases
      const aliases: any[] = [];
      if (line.supplier_sku) aliases.push({
        raw_material_supplier_id: rms.id, alias_type: "supplier_sku",
        alias_value: line.supplier_sku, status: "confirmed",
        confirmed_by: user?.id, confirmed_at: nowIso, first_seen_invoice_id: line.invoice_id,
      });
      if (line.description) aliases.push({
        raw_material_supplier_id: rms.id, alias_type: "product_name",
        alias_value: line.description, status: "confirmed",
        confirmed_by: user?.id, confirmed_at: nowIso, first_seen_invoice_id: line.invoice_id,
      });
      if (aliases.length) await supabase.from("raw_material_supplier_aliases").insert(aliases);

      // 4) Price history
      await supabase.from("raw_material_price_history").insert({
        raw_material_id: rm.id, supplier_id: line.invoice.supplier_id, price: pricePerBase ?? 0,
        effective_date: line.invoice.invoice_date, source: "invoice", invoice_id: line.invoice_id, created_by: user?.id,
      });

      // 5) Match line
      await supabase.from("invoice_lines").update({
        raw_material_id: rm.id, match_confidence: "manual", requires_review: false,
        review_reason: null, resolved_by: user?.id, resolved_at: nowIso,
        price_per_base_unit: pricePerBase, expected_price_per_base_unit: pricePerBase, variance_status: "within_tolerance",
      }).eq("id", line.id);

      toast.success(`Råvare «${name}» opprettet`, { description: "Husk å fylle inn næringsinnhold senere." });
      qc.invalidateQueries({ queryKey: ["fakturaer-review-lines"] });
      qc.invalidateQueries({ queryKey: ["fakturaer-review-count"] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke opprette");
    } finally { setBusy(false); }
  }

  const previewPricePerBase = (() => {
    if (!line || line.unit_price == null) return null;
    const sizeNum = packageSize ? Number(packageSize) : null;
    const sizeInBase =
      sizeNum && sizeNum > 0
        ? sizeNum * toBaseFactor((packageUnit || line.unit || "").toLowerCase(), baseUnit)
        : null;
    const divisor =
      sizeInBase && sizeInBase > 0
        ? sizeInBase
        : toBaseFactor((line.unit ?? "").toLowerCase(), baseUnit);
    return divisor > 0 ? Number(line.unit_price) / divisor : null;
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Opprett ny råvare</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Navn"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Kategori">
            {newCategory ? (
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Navn på ny kategori…"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setNewCategory(false); setCategory(""); }}
                >
                  Avbryt
                </Button>
              </div>
            ) : (
              <Select
                value={category}
                onValueChange={(v) => {
                  if (v === "__new__") { setNewCategory(true); setCategory(""); }
                  else setCategory(v);
                }}
              >
                <SelectTrigger><SelectValue placeholder="Velg kategori…" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  <SelectItem value="__new__">+ Ny kategori…</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Basisenhet">
              <Select value={baseUnit} onValueChange={setBaseUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["kg", "l", "stk"].map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Pakke størrelse"><Input type="number" value={packageSize} onChange={(e) => setPackageSize(e.target.value)} /></Field>
            <Field label="Pakke enhet"><Input value={packageUnit} onChange={(e) => setPackageUnit(e.target.value)} /></Field>
          </div>
          <div className="rounded-lg bg-muted/30 p-3 text-sm">
            Beregnet kostpris/{baseUnit}: <strong>{formatNok(previewPricePerBase)}</strong>
            <p className="mt-1 text-xs text-muted-foreground">
              Pakke størrelse = innhold pr pakning (f.eks. 25 kg pr sekk), ikke antall pakninger på fakturaen
              {line?.quantity != null ? ` (fakturaen har ${line.quantity} stk)` : ""}.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Avbryt</Button>
          <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Opprett</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><Label className="mb-1.5 block">{label}</Label>{children}</div>);
}
