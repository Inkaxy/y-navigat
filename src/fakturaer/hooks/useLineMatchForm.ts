import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invalidateInvoice, invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import { deriveLinePackage, parseDecimal, resolveLineCost } from "@/fakturaer/lib/units";
import { acceptMatch, type AcceptMatchResult } from "@/fakturaer/lib/acceptMatch";
import { normalizeMatchKey } from "@/fakturaer/lib/matchNormalize";
import { fetchAiLineSuggestion, AI_REASON_LABELS, type AiLineSuggestion } from "@/fakturaer/lib/aiLineSuggestion";

/** Leverandørkoblingen bak et forslag — pris, pakning og SKU hos leverandøren. */
export interface LinkInfo {
  raw_material_id: string;
  supplier_sku: string | null;
  supplier_product_name: string | null;
  package_size: number | null;
  package_unit: string | null;
  agreed_price_per_base_unit: number | null;
  last_invoice_price: number | null;
  last_invoice_date: string | null;
}

export interface RmRow {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  current_cost_price: number | null;
  base_unit: string | null;
  primary_supplier_id: string | null;
  item_type?: string | null;
}

interface ExistingLink {
  id: string;
  supplier_id: string;
  agreed_price_per_base_unit: number | null;
  is_primary: boolean | null;
  package_size: number | null;
  package_unit: string | null;
}

/**
 * Ett felles skjema for å koble en fakturalinje til en råvare og bekrefte
 * pakningen. Brukes både av MatchDrawer og av kontrollflaten i køen, slik at
 * begge lagrer gjennom nøyaktig samme `acceptMatch`.
 *
 * Er linjen allerede koblet, starter skjemaet på DEN råvaren — brukeren skal
 * aldri måtte søke den opp på nytt for å kontrollere pakning eller pris.
 * Skjemaet nullstilles når linjen byttes (`line.id`) eller `resetKey` endres.
 */
export function useLineMatchForm(line: ReviewLineRow | null, resetKey: unknown = null) {
  const qc = useQueryClient();
  const [selectedRmId, setSelectedRmId] = useState<string | null>(line?.raw_material_id ?? null);
  const [search, setSearch] = useState("");
  const [rememberSku, setRememberSku] = useState(!!line?.supplier_sku);
  const [rememberName, setRememberName] = useState(!!line?.description && line?.description !== line?.supplier_sku);
  const [setAsPrimary, setSetAsPrimary] = useState(false);
  const [confirmPackage, setConfirmPackage] = useState(false);
  const [agreedPrice, setAgreedPrice] = useState("");
  const [packageSize, setPackageSize] = useState("");
  const [packageUnit, setPackageUnit] = useState("");
  const [packageTouched, setPackageTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<AiLineSuggestion | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  /** Linjen skjemaet gjelder nå — asynkrone svar for en annen linje ignoreres. */
  const currentLineId = useRef<string | null>(line?.id ?? null);

  useEffect(() => {
    currentLineId.current = line?.id ?? null;
    setSelectedRmId(line?.raw_material_id ?? null);
    setSearch("");
    setRememberSku(!!line?.supplier_sku);
    setRememberName(!!line?.description && line?.description !== line?.supplier_sku);
    setSetAsPrimary(false);
    setConfirmPackage(false);
    setAgreedPrice("");
    const pkg = line
      ? deriveLinePackage({
          package_size: line.package_size,
          package_unit: line.package_unit,
          count_per_package: line.count_per_package,
          description: line.description,
        })
      : null;
    setPackageSize(pkg ? String(pkg.size) : "");
    setPackageUnit(pkg?.unit ?? "");
    setPackageTouched(false);
    setAiSuggestion(null);
    setAiNotice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nullstilles bevisst bare ved ny linje
  }, [line?.id, resetKey]);

  const legalEntityId = line?.invoice.legal_entity_id;
  const supplierId = line?.invoice.supplier_id;

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
      return (data ?? []) as unknown as Array<{ alias_value: string | null; raw_material_suppliers: { raw_material_id: string } | null }>;
    },
  });

  /** Søk treffer navn og SKU på varen, leverandørens varenummer og registrerte alias. */
  const { data: rmResults = [], isLoading: searching } = useQuery({
    queryKey: ["rm-search", legalEntityId, supplierId, search, supplierAliasUpdatedAt],
    enabled: !!legalEntityId && search.length > 1,
    queryFn: async () => {
      const safe = search.trim().replace(/[,()]/g, " ");
      const term = `%${safe}%`;
      const needle = normalizeMatchKey(search);
      const bySupplier = await supabase
        .from("raw_material_suppliers")
        .select("raw_material_id")
        .or(`supplier_sku.ilike.${term},supplier_product_name.ilike.${term}`)
        .limit(50);
      if (bySupplier.error) throw bySupplier.error;
      const extraIds = [
        ...(bySupplier.data ?? []).map((r) => r.raw_material_id),
        ...supplierAliasRows
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

  const suggestions = useMemo(() => line?.suggestions ?? [], [line?.suggestions]);
  const suggestionIds = useMemo(() => suggestions.map((s) => s.raw_material_id), [suggestions]);
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
      const { data, error } = await supabase
        .from("raw_material_suppliers")
        .select("id, supplier_id, agreed_price_per_base_unit, is_primary, package_size, package_unit")
        .eq("raw_material_id", selectedRmId!);
      if (error) throw error;
      return (data ?? []) as ExistingLink[];
    },
  });

  const linkExists = useMemo(() => existingRms?.find((r) => r.supplier_id === supplierId), [existingRms, supplierId]);
  const anyPrimary = useMemo(() => existingRms?.some((r) => r.is_primary), [existingRms]);

  useEffect(() => {
    if (linkExists?.agreed_price_per_base_unit != null) setAgreedPrice(String(linkExists.agreed_price_per_base_unit));
    // Kjent pakning hos leverandøren er et forslag når linjen selv ikke sier noe.
    if (!packageTouched && !packageSize && linkExists?.package_size != null) {
      setPackageSize(String(linkExists.package_size));
      setPackageUnit(linkExists.package_unit ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kun når koblingen lastes
  }, [linkExists]);

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

  /**
   * Lagrer gjennom eksisterende `acceptMatch`. Kaster ved feil — inntastingen
   * blir stående. `stale` er sant hvis brukeren har byttet linje i mellomtiden.
   */
  async function save(opts: { applyToAll?: boolean; confirmPackage?: boolean } = {}): Promise<AcceptMatchResult & { stale: boolean }> {
    if (!line || !selectedRmId) throw new Error("Velg en råvare først");
    const lineId = line.id;
    setBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Du er ikke innlogget");
      const result = await acceptMatch({
        line,
        rawMaterialId: selectedRmId,
        userId: user.id,
        packageSize: parseDecimal(packageSize),
        packageUnit: packageUnit.trim() || null,
        baseUnitsPerPackage: cost?.baseUnitsPerPackage ?? null,
        agreedPricePerBaseUnit: parseDecimal(agreedPrice),
        rememberSku,
        rememberName,
        setAsPrimary,
        confirmPackage: opts.confirmPackage ?? confirmPackage,
        rejectedRawMaterialIds: suggestions
          .map((sg) => sg.raw_material_id)
          .filter((id): id is string => !!id && id !== selectedRmId),
        applyToAll: !!opts.applyToAll,
      });
      invalidateInvoice(qc, line.invoice_id);
      invalidateRawMaterial(qc, selectedRmId);
      return { ...result, stale: currentLineId.current !== lineId };
    } finally {
      setBusy(false);
    }
  }

  async function runAiSuggestion() {
    if (!line) return;
    const lineId = line.id;
    setAiBusy(true);
    setAiNotice(null);
    try {
      const { suggestion, reason } = await fetchAiLineSuggestion({
        invoiceLineId: line.id,
        candidateIds: suggestionIds.filter((id): id is string => !!id),
      });
      if (currentLineId.current !== lineId) return;
      if (!suggestion) {
        setAiSuggestion(null);
        setAiNotice(reason ? AI_REASON_LABELS[reason] : AI_REASON_LABELS.ai_feilet);
        return;
      }
      setAiSuggestion(suggestion);
      if (suggestion.rawMaterialId) setSelectedRmId(suggestion.rawMaterialId);
      if (suggestion.packageSize != null) setPackageSize(String(suggestion.packageSize));
      if (suggestion.packageUnit) setPackageUnit(suggestion.packageUnit);
      if (!suggestion.rawMaterialId) setAiNotice("AI-hjelpen fant ingen passende vare. Søk fram varen manuelt.");
    } finally {
      setAiBusy(false);
    }
  }

  return {
    selectedRmId,
    setSelectedRmId,
    search,
    setSearch,
    rmResults,
    searching,
    suggestions,
    suggestionLinks,
    selectedRm,
    linkExists,
    anyPrimary,
    rememberSku,
    setRememberSku,
    rememberName,
    setRememberName,
    setAsPrimary,
    setSetAsPrimary,
    confirmPackage,
    setConfirmPackage,
    agreedPrice,
    setAgreedPrice,
    packageSize,
    setPackageSize: (v: string) => {
      setPackageTouched(true);
      setPackageSize(v);
    },
    packageUnit,
    setPackageUnit: (v: string) => {
      setPackageTouched(true);
      setPackageUnit(v);
    },
    cost,
    linePricePerBaseUnit: cost && !cost.needsInput ? cost.pricePerBaseUnit : null,
    busy,
    save,
    aiBusy,
    aiSuggestion,
    aiNotice,
    runAiSuggestion,
  };
}

export type LineMatchForm = ReturnType<typeof useLineMatchForm>;
