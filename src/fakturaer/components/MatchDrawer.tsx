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
import { showError } from "@/lib/userError";
import { invalidateInvoice, invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { formatNok, formatDate } from "@/fakturaer/lib/constants";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import { CANONICAL_BASE_UNITS, CANONICAL_PACKAGE_UNITS, deriveLinePackage, parseDecimal, resolveLineCost } from "@/fakturaer/lib/units";
import { CreateRawMaterialDialog } from "@/fakturaer/components/CreateRawMaterialDialog";
import { ItemTypeBadge } from "@/ravarer/components/ItemTypeBadge";
import { InvoiceDocumentButton } from "@/fakturaer/components/InvoiceDocumentButton";
import { acceptMatch, recalculateLines, startPriceOutcomeLabel } from "@/fakturaer/lib/acceptMatch";
import { normalizeMatchKey } from "@/fakturaer/lib/matchNormalize";
import { AI_REASON_LABELS, fetchAiLineSuggestion, type AiLineSuggestion } from "@/fakturaer/lib/aiLineSuggestion";
import { Sparkles } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  line: ReviewLineRow | null;
  /**
   * Kalles etter «Godta og neste». Skuffen holdes åpen slik at brukeren kan
   * jobbe seg gjennom køen uten å lukke og åpne på nytt.
   */
  onAcceptedNext?: () => void;
}

/** Leverandørkoblingen bak et forslag — pris, pakning og SKU hos leverandøren. */
interface LinkInfo {
  raw_material_id: string;
  supplier_sku: string | null;
  supplier_product_name: string | null;
  package_size: number | null;
  package_unit: string | null;
  agreed_price_per_base_unit: number | null;
  last_invoice_price: number | null;
  last_invoice_date: string | null;
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

export function MatchDrawer({ open, onOpenChange, line, onAcceptedNext }: Props) {
  const qc = useQueryClient();
  const [selectedRmId, setSelectedRmId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [rememberSku, setRememberSku] = useState(true);
  const [rememberName, setRememberName] = useState(true);
  const [setAsPrimary, setSetAsPrimary] = useState(false);
  // Pakningen som tolkes fra linjen er et FORSLAG. Den lagres som bekreftet
  // bare når brukeren aktivt sier at den stemmer.
  const [confirmPackage, setConfirmPackage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agreedPrice, setAgreedPrice] = useState("");
  const [packageSize, setPackageSize] = useState("");
  const [packageUnit, setPackageUnit] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  // AI-forslag hentes bare når brukeren ber om det, og er aldri en bekreftelse.
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<AiLineSuggestion | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedRmId(null);
    setSearch("");
    setRememberSku(!!line?.supplier_sku);
    setRememberName(!!line?.description && line?.description !== line?.supplier_sku);
    setSetAsPrimary(false);
    setConfirmPackage(false);
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
    setAiSuggestion(null);
    setAiNotice(null);
  }, [open, line?.id]);

  const legalEntityId = line?.invoice.legal_entity_id;
  const supplierId = line?.invoice.supplier_id;

  /**
   * Leverandørens alias hentes ÉN gang per leverandør og filtreres i minnet.
   * Før lå dette inne i søket, som betød et nytt uttrekk av inntil 2000 rader
   * for hvert tastetrykk.
   */
  const { data: supplierAliasRows = [], dataUpdatedAt: supplierAliasUpdatedAt } = useQuery({
    queryKey: ["supplier-aliases-all", supplierId],
    enabled: !!supplierId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_supplier_aliases")
        .select("alias_value, raw_material_suppliers!inner(raw_material_id, supplier_id)")
        .eq("raw_material_suppliers.supplier_id", supplierId!)
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as unknown as Array<{
        alias_value: string | null;
        raw_material_suppliers: { raw_material_id: string } | null;
      }>;
    },
  });

  /**
   * Søk treffer navn og SKU på varen, men også leverandørens eget varenummer
   * og registrerte alias — det er ofte det eneste som står på fakturaen.
   */
  const { data: rmResults = [], isLoading: searching } = useQuery({
    // Cache-buster: siste vellykkede henting av aliasene, ikke antallet
    // rader — to ulike alias-sett kan tilfeldigvis ha samme lengde og
    // ville da IKKE trigget et nytt søk.
    queryKey: ["rm-search", legalEntityId, supplierId, search, supplierAliasUpdatedAt],
    enabled: !!legalEntityId && search.length > 1,
    queryFn: async () => {
      // Komma og parentes er skilletegn i PostgREST-filtre — fjernes fra søket.
      const safe = search.trim().replace(/[,()]/g, " ");
      const term = `%${safe}%`;
      const needle = normalizeMatchKey(search);

      // MERK: `alias_value_normalized` i databasen er bare lower(trim(...)),
      // så et normalisert ilike-søk treffer aldri «crème» eller «hvetemel, 25 kg».
      // Derfor filtreres leverandørens alias i minnet med samme normalisering
      // som matchemotoren.
      const bySupplier = await supabase
        .from("raw_material_suppliers")
        .select("raw_material_id")
        .or(`supplier_sku.ilike.${term},supplier_product_name.ilike.${term}`)
        .limit(50);
      if (bySupplier.error) throw bySupplier.error;

      const aliasRows = supplierAliasRows;
      const extraIds = [
        ...(bySupplier.data ?? []).map((r) => r.raw_material_id),
        ...aliasRows
          .filter((r) => normalizeMatchKey(r.alias_value).includes(needle))
          .map((r) => r.raw_material_suppliers?.raw_material_id),
      ].filter((id): id is string => !!id);

      const filter = extraIds.length
        ? `name.ilike.${term},sku.ilike.${term},id.in.(${[...new Set(extraIds)].join(",")})`
        : `name.ilike.${term},sku.ilike.${term}`;

      const { data, error } = await supabase
        .from("raw_materials")
        .select("id, name, sku, category, current_cost_price, base_unit, primary_supplier_id, item_type")
        .eq("legal_entity_id", legalEntityId!)
        .eq("is_active", true)
        .or(filter)
        .limit(20);
      if (error) throw error;
      return (data ?? []) as RmRow[];
    },
  });

  /** Leverandørkoblingene for varene som foreslås — vises rett i forslagsraden. */
  const suggestionIds = useMemo(
    () => (line?.suggestions ?? []).map((s) => s.raw_material_id),
    [line?.suggestions],
  );
  const { data: suggestionLinks } = useQuery({
    queryKey: ["rm-suggestion-links", supplierId, suggestionIds],
    enabled: !!supplierId && suggestionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_suppliers")
        .select(
          `raw_material_id, supplier_sku, supplier_product_name, package_size, package_unit,
           agreed_price_per_base_unit, last_invoice_price, last_invoice_date`,
        )
        .eq("supplier_id", supplierId!)
        .in("raw_material_id", suggestionIds);
      if (error) throw error;
      const map = new Map<string, LinkInfo>();
      ((data ?? []) as LinkInfo[]).forEach((r) => map.set(r.raw_material_id, r));
      return map;
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

  const linkExists = useMemo(() => existingRms?.find((r) => r.supplier_id === supplierId), [existingRms, supplierId]);
  const anyPrimary = useMemo(() => existingRms?.some((r) => r.is_primary), [existingRms]);

  // Når koblingen finnes fra før: forhåndsutfyll avtaleprisen slik at brukeren ser den.
  useEffect(() => {
    if (linkExists?.agreed_price_per_base_unit != null) {
      setAgreedPrice(String(linkExists.agreed_price_per_base_unit));
    }
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

  async function performMatch(applyToAll: boolean, keepOpen = false) {
    if (!line || !selectedRmId) return;
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Ikke innlogget");

      const pkgSize = parseDecimal(packageSize);
      const pkgUnit = packageUnit.trim() || null;
      const agreed = parseDecimal(agreedPrice);

      // Én felles implementasjon for både enkelt- og massegodkjenning.
      const { lineIds, startPrice, recalculationPending, recalculationError } = await acceptMatch({
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
        confirmPackage,
        rejectedRawMaterialIds: suggestions
          .map((sg) => sg.raw_material_id)
          .filter((id): id is string => !!id && id !== selectedRmId),
        applyToAll,
      });


      const antall = lineIds.length;
      const startPriceNote = startPriceOutcomeLabel(startPrice) ?? undefined;
      const invoiceId = line.invoice_id;
      if (recalculationPending) {
        // Matchen står, men prisavviket er ikke regnet om. Vi later ikke som
        // om linjen er ferdig — brukeren får prøve reberegningen på nytt.
        toast.warning(
          `Koblingen er lagret, men prisen er ikke regnet om for ${antall} ${antall === 1 ? "linje" : "linjer"}`,
          {
            description: [recalculationError, startPriceNote].filter(Boolean).join(" ") || undefined,
            duration: 15000,
            action: {
              label: "Prøv igjen",
              onClick: () => {
                void (async () => {
                  try {
                    await recalculateLines(invoiceId, lineIds);
                    toast.success("Prisen er regnet om");
                    invalidateInvoice(qc, invoiceId);
                  } catch (err: unknown) {
                    showError("faktura-match", err, "Reberegningen feilet fortsatt");
                  }
                })();
              },
            },
          },
        );
      } else {
        toast.success(applyToAll ? `Matchet ${antall} ${antall === 1 ? "linje" : "linjer"}` : "Linje matchet", {
          // Serveren avgjør om startprisen faktisk ble lagret — vi gjengir bare svaret.
          description: startPriceNote,
        });
      }
      invalidateInvoice(qc, line.invoice_id);
      invalidateRawMaterial(qc, selectedRmId);
      if (recalculationPending) {
        // Skuffen blir stående åpen så brukeren ser at noe gjenstår.
      } else if (keepOpen && onAcceptedNext) {
        // Skuffen blir stående — neste linje lastes inn av kalleren.
        setSelectedRmId(null);
        setSearch("");
        onAcceptedNext();
      } else {
        onOpenChange(false);
      }
    } catch (e: unknown) {
      showError("faktura-match", e, "Kunne ikke matche linjen");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Henter et AI-forslag for linjen. Forslaget fyller bare ut skjemaet —
   * bekreftelsen gjør brukeren selv, akkurat som før.
   */
  async function runAiSuggestion() {
    if (!line) return;
    setAiBusy(true);
    setAiNotice(null);
    try {
      const { suggestion, reason } = await fetchAiLineSuggestion({
        invoiceLineId: line.id,
        candidateIds: suggestions.map((s) => s.raw_material_id).filter((id): id is string => !!id),
      });
      if (!suggestion) {
        setAiSuggestion(null);
        setAiNotice(reason ? AI_REASON_LABELS[reason] : AI_REASON_LABELS.ai_feilet);
        return;
      }
      setAiSuggestion(suggestion);
      if (suggestion.rawMaterialId) setSelectedRmId(suggestion.rawMaterialId);
      if (suggestion.packageSize != null) setPackageSize(String(suggestion.packageSize));
      if (suggestion.packageUnit) setPackageUnit(suggestion.packageUnit);
      if (!suggestion.rawMaterialId) {
        setAiNotice("AI-hjelpen fant ingen passende vare. Søk fram varen manuelt.");
      }
    } finally {
      setAiBusy(false);
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
            {/*
              AI-hjelp er valgfri og hentes på forespørsel. «AI-forslag» vises kun
              når svaret faktisk kommer fra modellen — regelforslagene under heter
              «Foreslåtte matcher» og er noe annet.
            */}
            <div className="rounded-lg border border-line-subtle p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">AI-hjelp</span>
                <Button type="button" variant="outline" size="sm" onClick={runAiSuggestion} disabled={aiBusy || busy}>
                  {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Hent AI-forslag
                </Button>
              </div>
              {aiNotice && <p className="mt-2 text-xs text-ink-secondary">{aiNotice}</p>}
              {aiSuggestion && (
                <div className="mt-2 space-y-1 rounded-md bg-muted/40 p-2 text-xs">
                  <div className="font-medium">
                    AI-forslag{aiSuggestion.confidence != null ? ` • ${Math.round(aiSuggestion.confidence * 100)}% sikkerhet` : ""}
                  </div>
                  {aiSuggestion.explanation && <p>{aiSuggestion.explanation}</p>}
                  {aiSuggestion.uncertainties.length > 0 && (
                    <ul className="list-disc pl-4 text-ink-secondary">
                      {aiSuggestion.uncertainties.map((u) => <li key={u}>{u}</li>)}
                    </ul>
                  )}
                  <p className="text-ink-secondary">
                    Forslaget er en gjetning og er ikke bekreftet. Du bekrefter vare og pakning selv.
                  </p>
                </div>
              )}
            </div>

            {suggestions.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold">Foreslåtte matcher</h4>
                <RadioGroup value={selectedRmId ?? ""} onValueChange={(v) => setSelectedRmId(v)} className="space-y-2">
                  {suggestions.map((s) => {
                    const link = suggestionLinks?.get(s.raw_material_id) ?? null;
                    return (
                      <label key={s.raw_material_id}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-line-subtle p-3 hover:bg-muted/30">
                        <RadioGroupItem value={s.raw_material_id} className="mt-1" />
                        <div className="flex-1">
                          <div className="flex items-center gap-1.5 font-medium">
                            {s.raw_material?.name ?? "Ukjent"}
                            <ItemTypeBadge itemType={s.raw_material?.item_type} />
                          </div>
                          <div className="mt-0.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-ink-secondary sm:grid-cols-4">
                            <span>
                              Lev-SKU:{" "}
                              <span className="font-mono">{link?.supplier_sku ?? "—"}</span>
                            </span>
                            <span>
                              Siste pris: {link?.last_invoice_price != null ? formatNok(link.last_invoice_price) : "—"}
                              {link?.last_invoice_date ? ` (${formatDate(link.last_invoice_date)})` : ""}
                            </span>
                            <span>
                              Avtalepris:{" "}
                              {link?.agreed_price_per_base_unit != null
                                ? `${formatNok(link.agreed_price_per_base_unit)} / ${s.raw_material?.base_unit ?? "enhet"}`
                                : "—"}
                            </span>
                            <span>
                              Pakning:{" "}
                              {link?.package_size != null ? `${link.package_size} ${link.package_unit ?? ""}`.trim() : "—"}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-ink-secondary">
                            {s.match_reason} • {Math.round(s.confidence * 100)}%
                          </div>
                        </div>
                      </label>
                    );
                  })}
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
                  <label className="flex items-start gap-2">
                    <Checkbox checked={confirmPackage} onCheckedChange={(v) => setConfirmPackage(!!v)} />
                    <span>
                      Bekreft pakningen for denne leverandøren
                      {cost?.baseUnitsPerPackage
                        ? ` (${cost.baseUnitsPerPackage} ${selectedRm?.base_unit ?? ""} per pakning)`
                        : ""}
                      <span className="block text-xs text-ink-secondary">
                        Uten avkrysning brukes pakningen kun som forslag ved senere fakturaer.
                      </span>
                    </span>
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

            {selectedRmId && (
              /* Én informert hovedhandling: brukeren ser hva som faktisk lagres. */
              <div className="rounded-lg border border-line-subtle bg-muted/20 p-3 text-xs">
                <div className="mb-1 text-sm font-semibold">Dette lagres når du bekrefter</div>
                <ul className="list-disc space-y-0.5 pl-4">
                  <li>Bekreftet kobling mellom linjen og «{selectedRm?.name ?? "valgt vare"}»</li>
                  <li>
                    Pakning: {packageSize ? `${packageSize} ${packageUnit || ""}`.trim() : "ikke satt"}
                    {confirmPackage ? " (bekreftet for leverandøren)" : " (kun som forslag)"}
                  </li>
                  <li>
                    Avtalepris: {parseDecimal(agreedPrice) != null
                      ? `${formatNok(parseDecimal(agreedPrice) as number)} per ${selectedRm?.base_unit ?? "enhet"}`
                      : "uendret"}
                  </li>
                  <li>
                    Startpris: lagres bare hvis innstillingen er på, det ikke finnes avtalepris eller startpris
                    fra før, og serveren godkjenner grunnlaget.
                  </li>
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button onClick={() => performMatch(false)} disabled={!selectedRmId || busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Bekreft match
              </Button>
              {onAcceptedNext && (
                <Button variant="outline" onClick={() => performMatch(false, true)} disabled={!selectedRmId || busy}>
                  Godta og neste
                </Button>
              )}
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
