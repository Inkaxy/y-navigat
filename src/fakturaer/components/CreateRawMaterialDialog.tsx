import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { showError } from "@/lib/userError";
import { AlertTriangle, Loader2 } from "lucide-react";
import { formatNok } from "@/fakturaer/lib/constants";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import { ITEM_TYPES, defaultCategoryFor, type ItemType } from "@/ravarer/lib/itemTypes";
import { CategorySelectItems, NEW_CATEGORY_VALUE } from "@/ravarer/components/CategorySelectItems";
import { InvoiceDocumentButton } from "@/fakturaer/components/InvoiceDocumentButton";
import { CANONICAL_BASE_UNITS, CANONICAL_PACKAGE_UNITS, fmtNum, normalizeUnit, parseDecimal, resolveLineCost } from "@/fakturaer/lib/units";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  line: ReviewLineRow | null;
  /** Kalles når råvaren faktisk ble opprettet (ikke ved avbryt). */
  onCreated?: (rawMaterialId: string) => void;
}

/** Basisenhet utledet av fakturaenheten — kun et forslag brukeren kan overstyre. */
function inferBaseUnit(unit: string | null | undefined): string {
  const u = normalizeUnit(unit);
  if (u === "g" || u === "kg") return "kg";
  if (u === "ml" || u === "cl" || u === "dl" || u === "l") return "l";
  if (u === "stk") return "stk";
  return "kg";
}

export function CreateRawMaterialDialog({ open, onOpenChange, line, onCreated }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [newCategory, setNewCategory] = useState(false);
  const [baseUnit, setBaseUnit] = useState("kg");
  const [packageSize, setPackageSize] = useState<string>("");
  const [packageUnit, setPackageUnit] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [itemType, setItemType] = useState<ItemType>("ravare");

  useEffect(() => {
    if (!line || !open) return;
    setItemType("ravare");
    setName(line.description ?? "");
    setBaseUnit(inferBaseUnit(line.unit));
    // NB: line.quantity er ANTALL pakninger på fakturaen — ikke pakningsstørrelsen.
    // Pakningsstørrelsen må fylles inn manuelt (f.eks. 25 kg pr sekk).
    setPackageSize("");
    setPackageUnit(normalizeUnit(line.unit) ?? "");
    setCategory("");
    setNewCategory(false);
  }, [line, open]);

  const { data: categories = [] } = useQuery({
    queryKey: ["rm-categories", line?.invoice.legal_entity_id],
    enabled: !!line?.invoice.legal_entity_id,
    queryFn: async () => {
      const { data } = await supabase.from("raw_materials")
        .select("category").eq("legal_entity_id", line!.invoice.legal_entity_id).not("category", "is", null);
      return Array.from(new Set(((data ?? []) as { category: string | null }[]).map((d) => d.category).filter((c): c is string => !!c)));
    },
  });

  const sizeInputRef = useRef<HTMLInputElement>(null);

  /**
   * Én motor for kostpris — samme som matching og masse-import bruker.
   * Pakningsstørrelsen er lager- og bestillingsinformasjon; den endrer bare
   * kostprisen når fakturaen faktisk er priset per pakning.
   */
  const cost = useMemo(() => {
    if (!line) return null;
    const size = parseDecimal(packageSize);
    return resolveLineCost({
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unit_price,
      totalAmount: line.total_amount,
      packageSize: line.package_size,
      packageUnit: line.package_unit,
      countPerPackage: line.count_per_package,
      description: line.description,
      baseUnit,
      supplierPackage: size && size > 0 ? { packageSize: size, packageUnit: packageUnit || baseUnit } : null,
    });
  }, [line, baseUnit, packageSize, packageUnit]);

  const pricePerBase = cost && !cost.needsInput ? Number(cost.pricePerBaseUnit.toFixed(4)) : null;
  const needsPackage = cost?.needsInput === "package_size";
  // Alt som mangler — pakning, beløp eller basisenhet — skal sperre opprettelsen.
  const blockedByInput = !!cost?.needsInput;
  const parsedPackageSize = parseDecimal(packageSize);

  useEffect(() => {
    if (needsPackage) sizeInputRef.current?.focus();
  }, [needsPackage]);

  async function submit() {
    if (!line || !name.trim() || !category.trim()) { toast.error("Navn og kategori er påkrevd"); return; }
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const nowIso = new Date().toISOString();

      // 1) Raw material
      const skuGen = (line.supplier_sku?.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32)) + "-" + Math.random().toString(36).slice(2, 6);
      const { data: rm, error: rmErr } = await supabase.from("raw_materials").insert({
        legal_entity_id: line.invoice.legal_entity_id,
        sku: skuGen,
        name: name.trim(), category: category.trim(), base_unit: baseUnit,
        item_type: itemType,
        package_size: parsedPackageSize,
        package_unit: packageUnit || null,
        current_cost_price: pricePerBase, price_source: "invoice", price_updated_at: nowIso,
        base_units_per_package: cost?.baseUnitsPerPackage ?? null,
        primary_supplier_id: line.invoice.supplier_id, is_active: true, created_by: user?.id,
      } as never).select().single();
      if (rmErr) throw rmErr;

      // 2) raw_material_suppliers
      const { data: rms, error: rmsErr } = await supabase.from("raw_material_suppliers").insert({
        raw_material_id: rm.id, supplier_id: line.invoice.supplier_id, is_primary: true,
        supplier_sku: line.supplier_sku, supplier_product_name: line.description,
        // Avtaleprisen er forbeholdt framforhandlede priser — dialogen rører den ikke.
        package_size: parsedPackageSize, package_unit: packageUnit || null,
        base_units_per_package: cost?.baseUnitsPerPackage ?? null,
        ...(parsedPackageSize != null ? { package_confirmed_at: nowIso, package_confirmed_by: user?.id ?? null } : {}),
        last_invoice_price: pricePerBase, last_invoice_date: line.invoice.invoice_date,
      }).select().single();
      if (rmsErr) throw rmsErr;

      // 3) Aliases
      const aliases: Array<{
        raw_material_supplier_id: string;
        alias_type: "supplier_sku" | "product_name";
        alias_value: string;
        status: "confirmed";
        confirmed_by?: string;
        confirmed_at: string;
        first_seen_invoice_id: string;
      }> = [];
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

      // 4) Prishistorikk — kun når vi faktisk har en pris per baseenhet.
      if (pricePerBase != null) {
        await supabase.from("raw_material_price_history").insert({
          raw_material_id: rm.id, supplier_id: line.invoice.supplier_id, price: pricePerBase,
          effective_date: line.invoice.invoice_date, source: "invoice", invoice_id: line.invoice_id, created_by: user?.id,
        });
      }

      // 5) Match line
      await supabase.from("invoice_lines").update({
        raw_material_id: rm.id, match_confidence: "manual", requires_review: false,
        review_reason: null, resolved_by: user?.id, resolved_at: nowIso,
        // Dialogen setter ALDRI sin egen beregning som fasit for avviksovervåkingen.
        price_per_base_unit: pricePerBase, base_quantity: cost?.baseQuantity ?? null,
      }).eq("id", line.id);

      toast.success(`Råvare «${name}» opprettet`, { description: "Husk å fylle inn næringsinnhold senere." });
      qc.invalidateQueries({ queryKey: ["fakturaer-review-lines"] });
      qc.invalidateQueries({ queryKey: ["fakturaer-review-count"] });
      // Ny kategori skal dukke opp i velgeren og i innstillinger med én gang
      qc.invalidateQueries({ queryKey: ["rm-categories"] });
      qc.invalidateQueries({ queryKey: ["raw-material-categories"] });
      qc.invalidateQueries({ queryKey: ["raw-materials"] });
      onCreated?.(rm.id);
      onOpenChange(false);
    } catch (e: unknown) {
      showError("opprett-raavare", e, "Kunne ikke opprette råvaren");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Opprett ny vare</DialogTitle>
          <div className="pt-1">
            <InvoiceDocumentButton path={line?.invoice.source_document_url} label="Åpne faktura" />
          </div>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Varetype">
            <div className="grid grid-cols-2 gap-2">
              {ITEM_TYPES.map((t) => {
                const active = itemType === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => {
                      setItemType(t.value);
                      const def = defaultCategoryFor(t.value);
                      setNewCategory(false);
                      setCategory(def ?? "");
                    }}
                    className={`rounded-lg border p-2.5 text-left transition-colors ${
                      active ? "border-primary bg-primary/5" : "border-line-subtle hover:bg-muted/40"
                    }`}
                  >
                    <div className="text-sm font-medium">{t.label}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{t.hint}</div>
                  </button>
                );
              })}
            </div>
          </Field>
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
            ) : null}
            {newCategory ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Bruk helst en av standardkategoriene — da kan innkjøpsstatistikk og prisoppfølging sammenlignes på tvers av varer.
              </p>
            ) : (
              <Select
                value={category}
                onValueChange={(v) => {
                  if (v === NEW_CATEGORY_VALUE) { setNewCategory(true); setCategory(""); }
                  else setCategory(v);
                }}
              >
                <SelectTrigger><SelectValue placeholder="Velg kategori…" /></SelectTrigger>
                <SelectContent>
                  <CategorySelectItems existing={[category, ...categories]} allowNew />
                </SelectContent>
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Basisenhet">
              <Select value={baseUnit} onValueChange={setBaseUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CANONICAL_BASE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={needsPackage ? "Pakke størrelse *" : "Pakke størrelse"}>
              <Input
                ref={sizeInputRef}
                type="number"
                value={packageSize}
                onChange={(e) => setPackageSize(e.target.value)}
                className={needsPackage ? "border-warning" : undefined}
              />
            </Field>
            <Field label="Pakke enhet">
              <Select value={packageUnit} onValueChange={setPackageUnit}>
                <SelectTrigger><SelectValue placeholder="Velg…" /></SelectTrigger>
                <SelectContent>
                  {[...CANONICAL_BASE_UNITS, ...CANONICAL_PACKAGE_UNITS].map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Regnestykket vises åpent — ikke bare svaret. */}
          <div className="space-y-2 rounded-lg border border-line-subtle bg-muted/30 p-3 text-sm">
            {line && (
              <div className="text-ink-secondary">
                Fakturalinje:{" "}
                <span className="text-ink-primary">
                  {fmtNum(Number(line.quantity ?? 0))} {normalizeUnit(line.unit) ?? line.unit ?? ""}
                  {line.unit_price != null ? ` à ${formatNok(Number(line.unit_price))}` : ""} ={" "}
                  {formatNok(line.total_amount != null ? Number(line.total_amount) : null)}
                </span>
              </div>
            )}
            {cost && !cost.needsInput ? (
              <>
                <div>
                  → {fmtNum(cost.baseQuantity)} {baseUnit} mottatt · kostpris{" "}
                  <strong>{formatNok(cost.pricePerBaseUnit)}/{baseUnit}</strong>
                </div>
                <p className="text-xs text-ink-secondary">{cost.explanation}</p>
              </>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{cost?.reason ?? "Kostprisen kan ikke regnes ut ennå."}</span>
              </div>
            )}

            <div className="border-t border-line-subtle pt-2 text-xs text-ink-secondary">
              Pakning: {packageSize ? `${fmtNum(parsedPackageSize ?? 0)} ${packageUnit || baseUnit} per pakning` : "ikke angitt"}
              {cost && !cost.needsInput && cost.baseUnitsPerPackage
                ? ` → ${fmtNum(cost.baseQuantity / cost.baseUnitsPerPackage)} pakninger`
                : ""}
              {" "}— brukes kun til lager og bestilling. Når fakturaen er priset per {baseUnit}, endrer den
              ikke kostprisen.
            </div>

            {cost && !cost.needsInput && (cost.confidenceLevel === "low" || cost.checks.historyOffByPackage) && cost.alternatives.length > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" /> Usikker tolkning
                </div>
                {cost.alternatives.map((alt, i) => (
                  <button
                    key={i}
                    type="button"
                    className="block w-full text-left underline-offset-2 hover:underline"
                    onClick={() => {
                      // Brukeren velger den forkastede tolkningen: sett pakning deretter.
                      if (alt.basis === "pakning" && alt.baseUnitsPerPackage) {
                        setPackageSize(String(alt.baseUnitsPerPackage));
                        setPackageUnit(baseUnit);
                      } else {
                        setPackageSize("");
                      }
                    }}
                  >
                    Mente du {formatNok(alt.pricePerBaseUnit)}/{baseUnit}? {alt.explanation}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Avbryt</Button>
          <Button onClick={submit} disabled={busy || blockedByInput}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Opprett</Button>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><Label className="mb-1.5 block">{label}</Label>{children}</div>);
}
