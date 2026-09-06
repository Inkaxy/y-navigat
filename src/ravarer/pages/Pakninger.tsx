import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, CheckCircle2, Loader2, Pencil, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { computeBaseUnitsPerPackage } from "@/ravarer/lib/packageMath";

import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useRawMaterials, type RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { useAllRawMaterialPurchaseStats } from "@/ravarer/hooks/usePurchaseStats";
import { formatDate, formatNumber, BASE_UNITS, PACKAGE_UNITS } from "@/ravarer/lib/constants";
import { ItemTypeBadge } from "@/ravarer/components/ItemTypeBadge";
import { SetPackageDialog } from "@/ravarer/components/packages/SetPackageDialog";
import { usePreviewPackage, type PackageWorklistRow } from "@/ravarer/hooks/usePackageSizes";

const UNIT_OPTIONS = Array.from(new Set<string>([...BASE_UNITS, ...PACKAGE_UNITS]));

interface PackageSuggestion {
  raw_material_id: string;
  package_size: number;
  package_unit: string | null;
  count_per_package: number | null;
  description: string | null;
  invoice_date: string | null;
}

/** Nyeste fakturalinje med pakningsdata per vare — hentet i én spørring. */
function usePackageSuggestions(rawMaterialIds: string[]) {
  const key = rawMaterialIds.slice().sort().join(",");
  return useQuery({
    queryKey: ["package-suggestions", key],
    enabled: rawMaterialIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_lines")
        .select("raw_material_id, package_size, package_unit, count_per_package, description, invoice:invoices!inner(invoice_date)")
        .in("raw_material_id", rawMaterialIds)
        .not("package_size", "is", null)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;

      const map = new Map<string, PackageSuggestion>();
      for (const row of data ?? []) {
        const rmId = row.raw_material_id;
        if (!rmId) continue;
        const invoice = row.invoice as { invoice_date: string | null } | null;
        const existing = map.get(rmId);
        const date = invoice?.invoice_date ?? null;
        if (existing && (existing.invoice_date ?? "") >= (date ?? "")) continue;
        map.set(rmId, {
          raw_material_id: rmId,
          package_size: Number(row.package_size),
          package_unit: row.package_unit,
          count_per_package: row.count_per_package,
          description: row.description,
          invoice_date: date,
        });
      }
      return map;
    },
  });
}

interface EditValues {
  size: string;
  unit: string;
  count: string;
}

export default function PakningerPage() {
  const { canWrite } = useRavarer();
  const previewPackage = usePreviewPackage();
  const [dialogRow, setDialogRow] = useState<PackageWorklistRow | null>(null);
  const [pendingSuggestion, setPendingSuggestion] = useState<{ size: number | null; unit: string | null } | null>(null);
  const { data: rows = [], isLoading } = useRawMaterials();
  const { data: suppliers = [] } = useSuppliers();
  const { data: statsMap } = useAllRawMaterialPurchaseStats();

  const [skipped, setSkipped] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const supplierMap = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);

  const activeRows = useMemo(() => rows.filter((r) => r.is_active), [rows]);
  const confirmedCount = useMemo(
    () => activeRows.filter((r) => !!r.package_confirmed_at).length,
    [activeRows],
  );
  const pending = useMemo(() => activeRows.filter((r) => !r.package_confirmed_at), [activeRows]);

  const { data: suggestions } = usePackageSuggestions(pending.map((r) => r.id));

  const sortByVolume = (a: RawMaterialRow, b: RawMaterialRow) => {
    const sa = statsMap?.get(a.id)?.invoice_count_12m ?? 0;
    const sb = statsMap?.get(b.id)?.invoice_count_12m ?? 0;
    if (sb !== sa) return sb - sa;
    return a.name.localeCompare(b.name, "nb");
  };

  const withSuggestion = useMemo(() => {
    const list = pending.filter((r) => suggestions?.has(r.id)).sort(sortByVolume);
    // Hoppet over havner nederst i økten.
    return [
      ...list.filter((r) => !skipped.includes(r.id)),
      ...list.filter((r) => skipped.includes(r.id)),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, suggestions, statsMap, skipped]);

  const withoutSuggestion = useMemo(
    () => pending.filter((r) => !suggestions?.has(r.id)).sort(sortByVolume),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending, suggestions, statsMap],
  );

  // Enter bekrefter valgt (eller øverste) rad slik at man kan jobbe seg nedover.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      // Er dialogen åpen, eier den tastaturet — Enter bak den skal ikke starte noe nytt.
      if (dialogRow) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const row = withSuggestion.find((r) => r.id === selectedId) ?? withSuggestion[0];
      if (!row || !canWrite || savingId) return;
      const sug = suggestions?.get(row.id);
      if (!sug) return;
      e.preventDefault();
      void confirm(row, {
        size: String(sug.package_size),
        unit: sug.package_unit ?? row.base_unit,
        count: sug.count_per_package != null ? String(sug.count_per_package) : "1",
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withSuggestion, selectedId, suggestions, canWrite, savingId, dialogRow]);

  /** Bygger raden pakningsdialogen trenger, slik at full gjennomgang kan tas der. */
  function toWorklistRow(row: RawMaterialRow): PackageWorklistRow {
    return {
      id: row.id,
      legal_entity_id: null,
      name: row.name,
      base_unit: row.base_unit,
      category: row.category ?? null,
      current_cost_price: row.current_cost_price ?? null,
      pakningsfaktor: null,
      faktor_kilde: null,
      bekreftet_dato: row.package_confirmed_at ?? null,
      antall_fakturalinjer: null,
      antall_leverandorer: null,
      enheter_i_bruk: null,
      linjer_uten_pris: null,
      kjopt_kr_totalt: null,
      siste_faktura: null,
      pris_spredning: null,
      implisert_mengde: null,
      referansepris: null,
      referansekilde: null,
      referansedato: null,
      referanse_faktor: null,
      foreslatt_fra_navn: null,
      foreslatt_fra_referanse: null,
      status: null,
    };
  }

  /**
   * «Bekreft» lagrer aldri av seg selv. Forslaget regnes om til råvarens
   * baseenhet (500 g på en kg-vare = 0,5 kg), forhåndsvises via RPC-en, og
   * åpnes så i pakningsdialogen der bruker ser før/etter og bekrefter selv.
   */
  async function confirm(row: RawMaterialRow, values: EditValues) {
    const math = computeBaseUnitsPerPackage({
      size: values.size,
      unit: values.unit,
      count: values.count,
      baseUnit: row.base_unit,
    });
    if (!math.ok) {
      // Ingen skriving og ingen gjetting: varen sendes til manuell gjennomgang.
      toast.error(math.error);
      setPendingSuggestion({ size: null, unit: values.unit || null });
      setDialogRow(toWorklistRow(row));
      return;
    }

    setSavingId(row.id);
    try {
      const preview = await previewPackage.mutateAsync({
        p_raw_material_id: row.id,
        p_base_units_per_package: math.baseUnits,
        p_package_unit: values.unit || null,
        p_reason: "Bekreftet i Pakninger",
      });
      if (!preview.ok) {
        toast.error(`Forhåndsvisningen for ${row.name} kunne ikke beregnes`);
      } else if (preview.lines_outlier > 0 || preview.lines_unknown > 0) {
        toast.info(`${row.name} trenger en gjennomgang før pakningen kan bekreftes`);
      }
      setPendingSuggestion({ size: math.baseUnits, unit: values.unit || null });
      setDialogRow(toWorklistRow(row));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke forhåndsvise pakning");
    } finally {
      setSavingId(null);
    }
  }


  const total = activeRows.length;
  const pct = total > 0 ? Math.round((confirmedCount / total) * 100) : 0;
  const allDone = total > 0 && pending.length === 0;

  return (
    <div className="space-y-5">
      <RavarerHeaderBanner
        title="Pakninger"
        subtitle="Bekreft pakningsstørrelse slik at pris per baseenhet kan beregnes"
      />

      <Card className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink-primary">
              {confirmedCount} av {total} aktive varer har bekreftet pakning
            </p>
            <p className="text-sm text-ink-secondary">{pending.length} gjenstår</p>
          </div>
          <span className="text-2xl font-semibold tabular-nums text-ink-primary">{pct} %</span>
        </div>
        <Progress value={pct} className="mt-3" />
      </Card>

      {isLoading ? (
        <Card className="flex items-center justify-center p-12 text-ink-secondary">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…
        </Card>
      ) : allDone ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <CheckCircle2 className="mb-3 h-10 w-10 text-success" />
          <p className="font-medium text-ink-primary">Alle {total} varer har bekreftet pakning</p>
        </Card>
      ) : (
        <>
          <PackageTable
            title="Varer med forslag fra faktura"
            rows={withSuggestion}
            suggestions={suggestions}
            supplierMap={supplierMap}
            canWrite={canWrite}
            savingId={savingId}
            selectedId={selectedId}
            skipped={skipped}
            onSelect={setSelectedId}
            onSkip={(id) => setSkipped((s) => [...s.filter((x) => x !== id), id])}
            onConfirm={confirm}
          />

          {withoutSuggestion.length > 0 && (
            <PackageTable
              title="Uten forslag — ingen fakturalinje med pakningsdata"
              rows={withoutSuggestion}
              suggestions={undefined}
              supplierMap={supplierMap}
              canWrite={canWrite}
              savingId={savingId}
              selectedId={selectedId}
              skipped={skipped}
              onSelect={setSelectedId}
              onSkip={(id) => setSkipped((s) => [...s.filter((x) => x !== id), id])}
              onConfirm={confirm}
            />
          )}
        </>
      )}

      <SetPackageDialog
        row={dialogRow}
        open={!!dialogRow}
        suggestion={pendingSuggestion}
        onOpenChange={(v) => {
          if (!v) {
            setDialogRow(null);
            setPendingSuggestion(null);
          }
        }}
      />
    </div>
  );
}

function PackageTable({
  title,
  rows,
  suggestions,
  supplierMap,
  canWrite,
  savingId,
  selectedId,
  skipped,
  onSelect,
  onSkip,
  onConfirm,
}: {
  title: string;
  rows: RawMaterialRow[];
  suggestions: Map<string, PackageSuggestion> | undefined;
  supplierMap: Map<string, string>;
  canWrite: boolean;
  savingId: string | null;
  selectedId: string | null;
  skipped: string[];
  onSelect: (id: string) => void;
  onSkip: (id: string) => void;
  onConfirm: (row: RawMaterialRow, values: EditValues) => void | Promise<void>;
}) {
  if (rows.length === 0) return null;
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line-subtle bg-muted/20 px-4 py-3 text-sm font-medium text-ink-primary">
        {title} <span className="text-ink-secondary">({rows.length})</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
            <tr>
              <th className="px-4 py-3">Vare</th>
              <th className="px-4 py-3">Kategori</th>
              <th className="px-4 py-3">Leverandør</th>
              <th className="px-4 py-3">Registrert pakning</th>
              <th className="px-4 py-3">Forslag</th>
              <th className="px-4 py-3 text-right">Handlinger</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sug = suggestions?.get(r.id);
              const isSelected = selectedId === r.id;
              return (
                <tr
                  key={r.id}
                  onClick={() => onSelect(r.id)}
                  className={`cursor-pointer border-t border-line-subtle transition-colors hover:bg-muted/40 ${
                    isSelected ? "bg-primary/5" : ""
                  } ${skipped.includes(r.id) ? "opacity-60" : ""}`}
                >
                  <td className="px-4 py-3 font-medium">
                    <Link
                      to={`/ravarer/vareliste/${r.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-primary hover:underline"
                    >
                      {r.name}
                    </Link>
                    <ItemTypeBadge itemType={r.item_type} className="ml-2" />
                    <div className="font-mono text-xs font-normal text-ink-secondary">{r.sku}</div>
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">{r.category ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-secondary">
                    {r.primary_supplier_id ? supplierMap.get(r.primary_supplier_id) ?? "—" : "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {r.package_size != null ? (
                      <>
                        {formatNumber(r.package_size, 3)} {r.package_unit ?? ""}
                      </>
                    ) : (
                      <span className="text-ink-secondary">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {sug ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div>
                              <div className="font-medium tabular-nums">
                                {formatNumber(sug.package_size, 3)} {sug.package_unit ?? ""}
                                {sug.count_per_package != null && ` × ${sug.count_per_package}`}
                              </div>
                              <div className="text-xs text-ink-secondary">{formatDate(sug.invoice_date)}</div>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="max-w-sm">{sug.description ?? "Fakturalinje uten beskrivelse"}</div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span className="text-ink-secondary">Ingen fakturalinje med pakning</span>
                    )}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5">
                      {sug && (
                        <Button
                          size="sm"
                          disabled={!canWrite || savingId === r.id}
                          onClick={() =>
                            onConfirm(r, {
                              size: String(sug.package_size),
                              unit: sug.package_unit ?? r.base_unit,
                              count: sug.count_per_package != null ? String(sug.count_per_package) : "1",
                            })
                          }
                          className="bg-success text-success-foreground hover:bg-success/90"
                        >
                          {savingId === r.id ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="mr-1 h-4 w-4" />
                          )}
                          Bekreft
                        </Button>
                      )}
                      <EditPopover row={r} suggestion={sug} canWrite={canWrite} onConfirm={onConfirm} />
                      {sug && (
                        <Button size="sm" variant="ghost" onClick={() => onSkip(r.id)}>
                          <SkipForward className="mr-1 h-4 w-4" /> Hopp over
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function EditPopover({
  row,
  suggestion,
  canWrite,
  onConfirm,
}: {
  row: RawMaterialRow;
  suggestion: PackageSuggestion | undefined;
  canWrite: boolean;
  onConfirm: (row: RawMaterialRow, values: EditValues) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<EditValues>({
    size: suggestion ? String(suggestion.package_size) : row.package_size != null ? String(row.package_size) : "",
    unit: suggestion?.package_unit ?? row.package_unit ?? row.base_unit,
    count: suggestion?.count_per_package != null ? String(suggestion.count_per_package) : "1",
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" disabled={!canWrite}>
          <Pencil className="mr-1 h-4 w-4" /> Rediger
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align="end">
        <div>
          <Label>Pakningsstørrelse</Label>
          <Input value={values.size} onChange={(e) => setValues((v) => ({ ...v, size: e.target.value }))} />
        </div>
        <div>
          <Label>Enhet</Label>
          <Select value={values.unit} onValueChange={(u) => setValues((v) => ({ ...v, unit: u }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {UNIT_OPTIONS.map((u) => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Antall per pakke</Label>
          <Input value={values.count} onChange={(e) => setValues((v) => ({ ...v, count: e.target.value }))} />
        </div>
        <Button
          className="w-full"
          onClick={async () => {
            await onConfirm(row, values);
            setOpen(false);
          }}
        >
          Bekreft pakning
        </Button>
      </PopoverContent>
    </Popover>
  );
}
