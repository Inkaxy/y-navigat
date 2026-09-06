import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ExternalLink, Search, Plus } from "lucide-react";
import { toast } from "sonner";
import { invalidateInvoice, invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { formatNok, formatDate } from "@/fakturaer/lib/constants";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import { CANONICAL_BASE_UNITS, CANONICAL_PACKAGE_UNITS, deriveLinePackage, parseDecimal, resolveLineCost } from "@/fakturaer/lib/units";
import { CreateRawMaterialDialog } from "@/fakturaer/components/CreateRawMaterialDialog";
import { ItemTypeBadge } from "@/ravarer/components/ItemTypeBadge";
import { InvoiceDocumentButton } from "@/fakturaer/components/InvoiceDocumentButton";
import { acceptMatch } from "@/fakturaer/lib/acceptMatch";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  line: ReviewLineRow | null;
}

interface RmRow {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  current_cost_price: number | null;
  base_unit: string | null;
  primary_supplier_id: string | null;
  item_type?: string | null;
}

export function MatchDrawer({ open, onOpenChange, line }: Props) {
  const qc = useQueryClient();
  const [selectedRmId, setSelectedRmId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [rememberSku, setRememberSku] = useState(true);
  const [rememberName, setRememberName] = useState(true);
  const [setAsPrimary, setSetAsPrimary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agreedPrice, setAgreedPrice] = useState("");
  const [packageSize, setPackageSize] = useState("");
  const [packageUnit, setPackageUnit] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedRmId(null);
    setSearch("");
    setRememberSku(!!line?.supplier_sku);
    setRememberName(!!line?.description && line?.description !== line?.supplier_sku);
    setSetAsPrimary(false);
    setAgreedPrice("");
    // Forhåndsutfyll pakning fra linjens lagrede felter, ellers fra beskrivelsen.
    const pkg = line ? deriveLinePackage({
      package_size: line.package_size,
      package_unit: line.package_unit,
      count_per_package: line.count_per_package,
      description: line.description,
    }) : null;
    setPackageSize(pkg ? String(pkg.size) : "");
    setPackageUnit(pkg?.unit ?? "");
  }, [open, line?.id]);

  const legalEntityId = line?.invoice.legal_entity_id;
  const supplierId = line?.invoice.supplier_id;

  const { data: rmResults = [], isLoading: searching } = useQuery({
    queryKey: ["rm-search", legalEntityId, search],
    enabled: !!legalEntityId && search.length > 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_materials")
        .select("id, name, sku, category, current_cost_price, base_unit, primary_supplier_id, item_type")
        .eq("legal_entity_id", legalEntityId!)
        .eq("is_active", true)
        .or(`name.ilike.%${search}%,sku.ilike.%${search}%`)
        .limit(20);
      if (error) throw error;
      return (data ?? []) as RmRow[];
    },
  });

  const { data: selectedRm } = useQuery({
    queryKey: ["rm-detail", selectedRmId],
    enabled: !!selectedRmId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_materials")
        .select("id, name, sku, category, current_cost_price, base_unit, primary_supplier_id, item_type")
        .eq("id", selectedRmId!)
        .single();
      if (error) throw error;
      return data as RmRow;
    },
  });

  const { data: existingRms } = useQuery({
    queryKey: ["rms-link", selectedRmId, supplierId],
    enabled: !!selectedRmId && !!supplierId,
    queryFn: async () => {
      const { data } = await supabase
        .from("raw_material_suppliers")
        .select("id, supplier_id, agreed_price_per_base_unit, is_primary")
        .eq("raw_material_id", selectedRmId!);
      return data ?? [];
    },
  });

  const linkExists = useMemo(() => existingRms?.find((r: any) => r.supplier_id === supplierId), [existingRms, supplierId]);
  const anyPrimary = useMemo(() => existingRms?.some((r: any) => r.is_primary), [existingRms]);

  // Når koblingen finnes fra før: forhåndsutfyll avtaleprisen slik at brukeren ser den.
  useEffect(() => {
    const existing = linkExists as any;
    if (existing?.agreed_price_per_base_unit != null) setAgreedPrice(String(existing.agreed_price_per_base_unit));
  }, [linkExists]);

  const suggestions = line?.suggestions ?? [];

  /** Kostpris per baseenhet fra kostprismotoren — samme beregning som overalt ellers. */
  const cost = useMemo(() => {
    const baseUnit = selectedRm?.base_unit;
    if (!line || !baseUnit) return null;
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
      knownPricePerBaseUnit: selectedRm?.current_cost_price ?? null,
    });
  }, [line, selectedRm?.base_unit, selectedRm?.current_cost_price, packageSize, packageUnit]);

  const linePricePerBaseUnit = cost && !cost.needsInput ? cost.pricePerBaseUnit : null;

  async function performMatch(applyToAll: boolean) {
    if (!line || !selectedRmId) return;
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Ikke innlogget");

      const pkgSize = parseDecimal(packageSize);
      const pkgUnit = packageUnit.trim() || null;
      const agreed = parseDecimal(agreedPrice);

      // Én felles implementasjon for både enkelt- og massegodkjenning.
      const { lineIds } = await acceptMatch({
        line,
        rawMaterialId: selectedRmId,
        userId: user.id,
        packageSize: pkgSize,
        packageUnit: pkgUnit,
        baseUnitsPerPackage: cost?.baseUnitsPerPackage ?? null,
        agreedPricePerBaseUnit: agreed,
        rememberSku,
        rememberName,
        setAsPrimary,
        applyToAll,
      });


      toast.success(applyToAll ? `Matchet ${lineIds.length} linjer` : "Linje matchet");
      invalidateInvoice(qc, line.invoice_id);
      invalidateRawMaterial(qc, selectedRmId);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke matche");
    } finally {
      setBusy(false);
    }
  }

  if (!line) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-[60vw] sm:max-w-[60vw] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Match fakturalinje</SheetTitle>
          <div className="pt-1">
            <InvoiceDocumentButton path={line?.invoice.source_document_url} label="Åpne faktura" />
          </div>
        </SheetHeader>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
          {/* Left – context */}
          <div className="space-y-4 text-sm">
            <div>
              <div className="text-lg font-semibold">{line.invoice.supplier?.name}</div>
              <div className="text-ink-secondary">Faktura {line.invoice.invoice_number} • {formatDate(line.invoice.invoice_date)}</div>
            </div>
            <dl className="space-y-2 rounded-lg border border-line-subtle bg-muted/20 p-4">
              <KV k="SKU" v={line.supplier_sku ?? "—"} mono />
              <KV k="Beskrivelse" v={line.description ?? "—"} />
              <KV k="Mengde" v={`${line.quantity ?? "—"} ${line.unit ?? ""}`} />
              <KV k="Pris/enhet" v={formatNok(line.unit_price)} />
              <KV k="Sum" v={formatNok(line.total_amount)} />
            </dl>
            {line.invoice.source_document_url && (
              <a href={line.invoice.source_document_url} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> Originaldokument
              </a>
            )}
          </div>

          {/* Right – matching */}
          <div className="space-y-5">
            {suggestions.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold">Foreslåtte matcher</h4>
                <RadioGroup value={selectedRmId ?? ""} onValueChange={(v) => setSelectedRmId(v)} className="space-y-2">
                  {suggestions.map((s) => (
                    <label key={s.raw_material_id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-line-subtle p-3 hover:bg-muted/30">
                      <RadioGroupItem value={s.raw_material_id} className="mt-1" />
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5 font-medium">
                          {s.raw_material?.name ?? "Ukjent"}
                          <ItemTypeBadge itemType={(s.raw_material as any)?.item_type} />
                        </div>
                        <div className="text-xs text-ink-secondary">
                          {s.raw_material?.category ?? "—"} • Kostpris {formatNok(s.raw_material?.current_cost_price)}
                        </div>
                        <div className="mt-1 text-xs text-ink-secondary">
                          {s.match_reason} • {Math.round(s.confidence * 100)}%
                        </div>
                      </div>
                    </label>
                  ))}
                </RadioGroup>
              </div>
            )}

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <Label>Søk etter vare</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Opprett ny vare
                </Button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Navn eller SKU — søker i alle varetyper…" className="pl-9" />
              </div>
              {searching && <Loader2 className="mx-auto my-3 h-4 w-4 animate-spin text-ink-secondary" />}
              {rmResults.length > 0 && (
                <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-line-subtle">
                  {rmResults.map((r) => (
                    <button key={r.id} type="button"
                      onClick={() => { setSelectedRmId(r.id); setSearch(r.name); }}
                      className="flex w-full items-center justify-between gap-3 border-b border-line-subtle p-2.5 text-left text-sm last:border-0 hover:bg-muted/40">
                      <div>
                        <div className="flex items-center gap-1.5 font-medium">
                          {r.name}
                          <ItemTypeBadge itemType={r.item_type} />
                        </div>
                        <div className="text-xs text-ink-secondary">{r.sku ?? "—"} • {r.category ?? "—"}</div>
                      </div>
                      <div className="text-xs tabular-nums text-ink-secondary">{formatNok(r.current_cost_price)}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedRm && (
              <div className="rounded-lg border border-line-subtle p-4">
                <div className="flex items-center gap-1.5 font-medium">
                  {selectedRm.name}
                  <ItemTypeBadge itemType={selectedRm.item_type} />
                </div>
                <div className="text-xs text-ink-secondary">{selectedRm.category ?? "—"} • {selectedRm.sku ?? "—"}</div>
                <div className="mt-3 text-sm">
                  {linkExists ? (
                    <div className="text-success">✅ Denne leverandøren er allerede knyttet til råvaren</div>
                  ) : (
                    <div className="text-warning">⚠️ Ny leverandørkobling vil opprettes</div>
                  )}
                </div>
                <div className="mt-4 space-y-3 rounded-md border border-line-subtle bg-muted/20 p-3">
                  <div>
                    <Label className="text-xs">
                      Avtalepris pr {selectedRm.base_unit ?? "baseenhet"} hos denne leverandøren
                    </Label>
                    <Input
                      className="mt-1 h-8"
                      value={agreedPrice}
                      onChange={(e) => setAgreedPrice(e.target.value)}
                      placeholder="tom = ingen avtale registrert"
                    />
                    <p className="mt-1 text-xs text-ink-secondary">tom = ingen avtale registrert</p>
                  </div>
                  <div className="text-xs text-ink-secondary">
                    Kostpris pr {selectedRm.base_unit ?? "baseenhet"} fra denne fakturalinjen:{" "}
                    <span className="font-medium text-ink">
                      {linePricePerBaseUnit != null ? formatNok(linePricePerBaseUnit) : "kunne ikke beregnes"}
                    </span>
                    {cost && (
                      <p className={`mt-1 ${cost.needsInput || cost.confidenceLevel === "low" ? "text-warning" : ""}`}>
                        {cost.needsInput ? cost.reason : cost.explanation}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Pakningsstørrelse</Label>
                      <Input className="mt-1 h-8" value={packageSize} onChange={(e) => setPackageSize(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Pakningsenhet</Label>
                      <Select value={packageUnit} onValueChange={setPackageUnit}>
                        <SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Velg" /></SelectTrigger>
                        <SelectContent>
                          {[...CANONICAL_BASE_UNITS, ...CANONICAL_PACKAGE_UNITS].map((u) => (
                            <SelectItem key={u} value={u}>{u}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <div className="mt-3 space-y-2 text-sm">
                  <label className="flex items-start gap-2">
                    <Checkbox checked={rememberSku} onCheckedChange={(v) => setRememberSku(!!v)} disabled={!line.supplier_sku} />
                    <span>Husk SKU <code className="rounded bg-muted px-1">{line.supplier_sku ?? "—"}</code> for denne leverandøren</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <Checkbox checked={rememberName} onCheckedChange={(v) => setRememberName(!!v)} disabled={!line.description} />
                    <span>Husk produktnavn «{line.description}» for denne leverandøren</span>
                  </label>
                  {!anyPrimary && (
                    <label className="flex items-start gap-2">
                      <Checkbox checked={setAsPrimary} onCheckedChange={(v) => setSetAsPrimary(!!v)} />
                      <span>Sett denne leverandøren som primær for råvaren</span>
                    </label>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button onClick={() => performMatch(false)} disabled={!selectedRmId || busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Bekreft match
              </Button>
              <Button variant="outline" onClick={() => performMatch(true)} disabled={!selectedRmId || busy}>
                Bekreft og bruk på alle like linjer
              </Button>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Avbryt</Button>
            </div>
          </div>
        </div>

        <CreateRawMaterialDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          line={line}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ["fakturaer-review-lines"] });
            qc.invalidateQueries({ queryKey: ["fakturaer-review-count"] });
            onOpenChange(false);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-secondary">{k}</dt>
      <dd className={mono ? "font-mono text-xs" : "font-medium"}>{v}</dd>
    </div>
  );
}
