/**
 * ImportPricesDialog — D.2 Tedebe-import.
 * 4-stegs wizard: last opp → forhåndsvis → bekreft → rapport.
 * Kaller edge function `import_products_prices` for transaksjonell import.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppContext } from "@/varer/context/AppContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Info,
  Loader2,
  RefreshCw,
  SkipForward,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  buildStats,
  classifyRow,
  parseTedebeFile,
  type ClassificationStats,
  type ClassifiedRow,
  type ExistingProduct,
  type FilterOptions,
  type ParseResult,
  type RowAction,
} from "@/varer/lib/tedebeImport";
import { osloTodayISO } from "@/lib/osloDate";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Refresh-callback når import er fullført. */
  onComplete?: () => void;
}

interface ImportResult {
  created: number;
  updated: number;
  price_items_upserted: number;
  skipped: number;
  errors: Array<{ row_index: number; varenummer: number; error: string }>;
}

type Step = 1 | 2 | 3 | 4;

type ConflictChoice = "keep" | "overwrite" | "skip";

const CONFLICT_LABEL: Record<ConflictChoice, string> = {
  keep: "Behold NBOS-navn",
  overwrite: "Overskriv med Tedebe-navn",
  skip: "Hopp over raden",
};

/** RPC-en krever at selskapet har begge base-prislistene. */
const REQUIRED_PRICE_LIST_CODES = ["engros_base", "utsalg_base"] as const;

interface EntityOption {
  id: string;
  short_code: string;
  legal_name: string;
  hasBasePriceLists: boolean;
}

const ALL_MOMSKODER: Array<"F" | "H" | "P" | "null"> = ["F", "H", "P", "null"];
const MOMSKODE_LABEL: Record<"F" | "H" | "P" | "null", string> = {
  F: "F (0%)",
  H: "H (15%)",
  P: "P (25%)",
  null: "ingen (→ 15%)",
};

export function ImportPricesDialog({ open, onOpenChange, onComplete }: Props) {
  const { legalEntityId: activeLegalEntityId } = useAppContext();
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [legalEntityId, setLegalEntityId] = useState<string>(activeLegalEntityId ?? "");
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);

  // Import-state
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Filter
  const [filter, setFilter] = useState<FilterOptions>({
    skip_without_prices: true,
    varenr_min: null,
    varenr_max: null,
    momskoder: new Set(ALL_MOMSKODER),
    create_new: true,
    update_existing: true,
    import_prices: true,
  });

  // Navnekonflikt-håndtering
  const [conflictResolution, setConflictResolution] = useState<ConflictChoice>("keep");
  const [rowDecisions, setRowDecisions] = useState<Record<number, ConflictChoice>>({});

  /* ---- Hent legal entities for selskap-velger ---- */
  const entitiesQuery = useQuery({
    queryKey: ["import-legal-entities-with-price-lists"],
    enabled: open,
    queryFn: async (): Promise<EntityOption[]> => {
      const { data, error } = await supabase
        .from("legal_entities")
        .select("id, short_code, legal_name")
        .eq("status", "active")
        .order("short_code");
      if (error) throw error;
      const rows = data ?? [];

      // Én ekstra spørring — ikke N+1
      const { data: lists, error: listErr } = await supabase
        .from("price_lists")
        .select("legal_entity_id, code")
        .in("code", REQUIRED_PRICE_LIST_CODES as unknown as string[]);
      if (listErr) throw listErr;

      const byEntity = new Map<string, Set<string>>();
      for (const l of lists ?? []) {
        if (!l.legal_entity_id) continue;
        const s = byEntity.get(l.legal_entity_id) ?? new Set<string>();
        s.add(l.code);
        byEntity.set(l.legal_entity_id, s);
      }

      return rows.map((e) => {
        const codes = byEntity.get(e.id) ?? new Set<string>();
        return { ...e, hasBasePriceLists: REQUIRED_PRICE_LIST_CODES.every((c) => codes.has(c)) };
      });
    },
  });

  const entities: EntityOption[] = entitiesQuery.data ?? [];
  const selectedEntity = entities.find((e) => e.id === legalEntityId) ?? null;
  const entityValid = !!selectedEntity?.hasBasePriceLists;

  /* ---- Default til et selskap som faktisk KAN importere ---- */
  useEffect(() => {
    if (!open || entities.length === 0) return;
    if (entities.find((e) => e.id === legalEntityId)?.hasBasePriceLists) return;
    const firstValid = entities.find((e) => e.hasBasePriceLists);
    if (firstValid && firstValid.id !== legalEntityId) setLegalEntityId(firstValid.id);
  }, [open, entities, legalEntityId]);

  /* ---- Hent eksisterende produkter for valgt entity ---- */
  const existingQuery = useQuery({
    queryKey: ["import-existing-products", legalEntityId],
    enabled: open && step >= 2,
    queryFn: async (): Promise<Map<number, ExistingProduct>> => {
      const { data, error } = await supabase
        .from("products")
        .select("id, display_number, display_name, mva_rate")
        .eq("legal_entity_id", legalEntityId);
      if (error) throw error;
      const m = new Map<number, ExistingProduct>();
      for (const p of data ?? []) {
        m.set(p.display_number, {
          id: p.id,
          display_number: p.display_number,
          display_name: p.display_name,
          mva_rate: Number(p.mva_rate ?? 15),
        });
      }
      return m;
    },
  });

  /* ---- Reset state når dialog lukkes ---- */
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setStep(1);
        setFile(null);
        setParseResult(null);
        setParsing(false);
        setImporting(false);
        setImportResult(null);
        setImportError(null);
        setFilter({
          skip_without_prices: true,
          varenr_min: null,
          varenr_max: null,
          momskoder: new Set(ALL_MOMSKODER),
          create_new: true,
          update_existing: true,
          import_prices: true,
        });
        setConflictResolution("keep");
        setRowDecisions({});
      }, 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  /* ---- Klassifisering basert på filter ---- */
  const classified: ClassifiedRow[] = useMemo(() => {
    if (!parseResult || !existingQuery.data) return [];
    return parseResult.rows.map((r) => classifyRow(r, existingQuery.data, filter));
  }, [parseResult, existingQuery.data, filter]);

  const stats: ClassificationStats | null = useMemo(
    () => (classified.length > 0 ? buildStats(classified) : null),
    [classified],
  );

  /* ---- Parse-handler ---- */
  async function handleParse() {
    if (!file) return;
    setParsing(true);
    try {
      const res = await parseTedebeFile(file);
      setParseResult(res);
      if (res.missing_columns.length > 0) {
        toast.error(`Fil mangler kolonner: ${res.missing_columns.join(", ")}`);
        return;
      }
      if (res.parse_errors.length > 0) {
        toast.warning(`Parsing fullført med ${res.parse_errors.length} advarsel(er)`);
      }
      setStep(2);
    } catch (e) {
      toast.error(`Kunne ikke parse fil: ${(e as Error).message}`);
    } finally {
      setParsing(false);
    }
  }

  function toggleMomskode(m: "F" | "H" | "P" | "null") {
    setFilter((f) => {
      const n = new Set(f.momskoder);
      if (n.has(m)) n.delete(m);
      else n.add(m);
      return { ...f, momskoder: n };
    });
  }

  /* ---- Navnekonflikter ---- */
  const conflictRows = useMemo(
    () => classified.filter((r) => r.action === "update_name_conflict"),
    [classified],
  );

  const conflictSummary = useMemo(() => {
    const s: Record<ConflictChoice, number> = { keep: 0, overwrite: 0, skip: 0 };
    for (const r of conflictRows) s[rowDecisions[r.row_index] ?? conflictResolution]++;
    return s;
  }, [conflictRows, rowDecisions, conflictResolution]);

  /* ---- Import-handler ---- */
  async function handleImport() {
    if (!file || classified.length === 0) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    setStep(4);

    // Filtrer ut rader som faktisk skal sendes (ikke skipped_filter/skipped_invalid/skipped_no_prices)
    const rowsToSend = classified
      .filter(
        (r) =>
          r.action === "create_with_prices" ||
          r.action === "create_no_prices" ||
          r.action === "update_match" ||
          r.action === "update_name_conflict",
      )
      .map((r) => ({
        row_index: r.row_index,
        varenummer: r.varenummer!,
        varenavn: r.varenavn,
        utsalgspris: r.utsalgspris,
        engrospris: r.engrospris,
        momskode: r.momskode,
      }));

    // Per-rad-overstyring: bruk «per_row» kun når minst én rad avviker fra det globale valget
    const hasOverride = conflictRows.some(
      (r) => rowDecisions[r.row_index] && rowDecisions[r.row_index] !== conflictResolution,
    );
    const perRowDecisions: Record<string, ConflictChoice> = {};
    if (hasOverride) {
      for (const r of conflictRows) {
        perRowDecisions[String(r.row_index)] = rowDecisions[r.row_index] ?? conflictResolution;
      }
    }

    try {
      const { data, error } = await supabase.functions.invoke("import_products_prices", {
        body: {
          legal_entity_id: legalEntityId,
          rows: rowsToSend,
          options: {
            create_new: filter.create_new,
            update_existing: filter.update_existing,
            import_prices: filter.import_prices,
            name_conflict_resolution: hasOverride ? "per_row" : conflictResolution,
            ...(hasOverride ? { per_row_decisions: perRowDecisions } : {}),
          },
          source_filename: file.name,
        },
      });
      if (error) throw error;
      setImportResult(data as ImportResult);
    } catch (e) {
      setImportError((e as Error).message ?? "Ukjent feil");
    } finally {
      setImporting(false);
    }
  }

  function handleFinish() {
    if (importResult) {
      toast.success(
        `Import fullført: ${importResult.created + importResult.updated} varer, ${importResult.price_items_upserted} priser`,
      );
      onComplete?.();
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-app" />
            Importer priser fra Tedebe (F82)
          </DialogTitle>
          <DialogDescription>
            Last opp varer + priser eksportert fra F82. 5-kolonne CSV eller Excel.
          </DialogDescription>
          <StepIndicator step={step} />
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {step === 1 && (
            <Step1Upload
              file={file}
              setFile={setFile}
              legalEntityId={legalEntityId}
              setLegalEntityId={setLegalEntityId}
              entities={entities}
              selectedEntity={selectedEntity}
              entityValid={entityValid}
            />
          )}

          {step === 2 && parseResult && (
            <Step2Preview
              parseResult={parseResult}
              classified={classified}
              stats={stats}
              filter={filter}
              setFilter={setFilter}
              toggleMomskode={toggleMomskode}
              loadingExisting={existingQuery.isLoading}
              conflictResolution={conflictResolution}
              setConflictResolution={setConflictResolution}
              rowDecisions={rowDecisions}
              setRowDecisions={setRowDecisions}
            />
          )}

          {step === 3 && stats && (
            <Step3Confirm
              stats={stats}
              fileName={file?.name ?? ""}
              conflictSummary={conflictSummary}
            />
          )}

          {step === 4 && (
            <Step4Report
              importing={importing}
              result={importResult}
              error={importError}
              onRetry={() => setStep(3)}
            />
          )}
        </div>

        <div className="border-t px-6 py-3 flex items-center justify-between gap-2 bg-muted/30">
          <div className="text-xs text-muted-foreground">
            {file && (
              <span className="flex items-center gap-1.5">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                {file.name} · {(file.size / 1024).toFixed(1)} KB
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step > 1 && step < 4 && (
              <Button variant="ghost" size="sm" onClick={() => setStep((step - 1) as Step)} disabled={importing}>
                Tilbake
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={importing}>
              {step === 4 && importResult ? "Lukk" : "Avbryt"}
            </Button>
            {step === 1 && (
              <Button
                size="sm"
                onClick={handleParse}
                disabled={!file || parsing || !entityValid}
                title={!entityValid ? "Valgt selskap mangler base-prislistene" : undefined}
                className="bg-app hover:bg-app-dark text-app-foreground"
              >
                {parsing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Parse fil
              </Button>
            )}
            {step === 2 && parseResult && parseResult.missing_columns.length === 0 && (
              <Button
                size="sm"
                onClick={() => setStep(3)}
                disabled={!stats || stats.total === 0}
                className="bg-app hover:bg-app-dark text-app-foreground"
              >
                Neste: Bekreft
              </Button>
            )}
            {step === 3 && (
              <Button
                size="sm"
                onClick={handleImport}
                disabled={!file || !entityValid || !stats || stats.total === 0 || importing}
                className="bg-app hover:bg-app-dark text-app-foreground"
              >
                {importing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Bekreft og start import
              </Button>
            )}

            {step === 4 && importResult && (
              <Button
                size="sm"
                onClick={handleFinish}
                className="bg-app hover:bg-app-dark text-app-foreground"
              >
                Ferdig
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ============== STEG-INDIKATOR ============== */

function StepIndicator({ step }: { step: Step }) {
  const steps = ["Last opp", "Forhåndsvis", "Bekreft", "Rapport"];
  return (
    <div className="flex items-center gap-2 mt-4">
      {steps.map((label, i) => {
        const n = (i + 1) as Step;
        const active = step === n;
        const done = step > n;
        return (
          <div key={label} className="flex items-center gap-2 flex-1">
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold shrink-0",
                done && "bg-app text-app-foreground",
                active && "bg-app text-app-foreground ring-2 ring-app/30",
                !done && !active && "bg-muted text-muted-foreground",
              )}
            >
              {done ? <CheckCircle2 className="h-4 w-4" /> : n}
            </div>
            <span
              className={cn(
                "text-xs",
                active ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <div className={cn("flex-1 h-px", done ? "bg-app" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ============== STEG 1: UPLOAD ============== */

function Step1Upload({
  file,
  setFile,
  legalEntityId,
  setLegalEntityId,
  entities,
  selectedEntity,
  entityValid,
}: {
  file: File | null;
  setFile: (f: File | null) => void;
  legalEntityId: string;
  setLegalEntityId: (s: string) => void;
  entities: EntityOption[];
  selectedEntity: EntityOption | null;
  entityValid: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="entity">Selskap</Label>
        <Select value={legalEntityId} onValueChange={setLegalEntityId}>
          <SelectTrigger id="entity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {entities.map((e) => (
              <SelectItem key={e.id} value={e.id} disabled={!e.hasBasePriceLists}>
                {e.short_code} — {e.legal_name}
                {!e.hasBasePriceLists && (
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · ingen prislister — import ikke mulig
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Importerte produkter og priser tilknyttes dette selskapet.
        </p>
      </div>

      {!entityValid && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Import ikke mulig for dette selskapet</AlertTitle>
          <AlertDescription>
            {selectedEntity
              ? `${selectedEntity.short_code} — ${selectedEntity.legal_name} mangler base-prislistene (engros_base og utsalg_base). Importen kan ikke kjøres for dette selskapet.`
              : "Velg et selskap som har base-prislistene (engros_base og utsalg_base)."}
          </AlertDescription>
        </Alert>
      )}

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "rounded-lg border-2 border-dashed p-10 text-center cursor-pointer transition",
          dragOver ? "border-app bg-app/5" : "border-border hover:border-app/50 hover:bg-muted/30",
        )}
      >
        <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm font-medium">
          Slipp CSV eller Excel-fil her, eller klikk for å velge
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Forventer 5 kolonner: varenummer, varenavn, utsalgspris eks mva, engrospris eks mva, momskode
        </p>
        {file && (
          <div className="mt-4 inline-flex items-center gap-2 text-sm bg-background rounded-md px-3 py-1.5 border">
            <FileSpreadsheet className="h-4 w-4 text-app" />
            <span className="font-medium">{file.name}</span>
            <span className="text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
    </div>
  );
}

/* ============== STEG 2: PREVIEW ============== */

function Step2Preview({
  parseResult,
  classified,
  stats,
  filter,
  setFilter,
  toggleMomskode,
  loadingExisting,
  conflictResolution,
  setConflictResolution,
  rowDecisions,
  setRowDecisions,
}: {
  parseResult: ParseResult;
  classified: ClassifiedRow[];
  stats: ClassificationStats | null;
  filter: FilterOptions;
  setFilter: React.Dispatch<React.SetStateAction<FilterOptions>>;
  toggleMomskode: (m: "F" | "H" | "P" | "null") => void;
  loadingExisting: boolean;
  conflictResolution: ConflictChoice;
  setConflictResolution: (c: ConflictChoice) => void;
  rowDecisions: Record<number, ConflictChoice>;
  setRowDecisions: React.Dispatch<React.SetStateAction<Record<number, ConflictChoice>>>;
}) {
  if (parseResult.missing_columns.length > 0) {
    return (
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertTitle>Filen mangler påkrevde kolonner</AlertTitle>
        <AlertDescription>
          <p className="mt-1">Mangler: {parseResult.missing_columns.join(", ")}</p>
          <p className="mt-1 text-xs">Funnet i fil: {parseResult.found_columns.join(", ") || "(ingen)"}</p>
        </AlertDescription>
      </Alert>
    );
  }

  if (loadingExisting) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const previewRows = classified.slice(0, 100);
  const conflictCount = stats?.conflicts ?? 0;

  return (
    <div className="space-y-4">
      {/* Statistikk-kort */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <StatCard label="Totalt rader" value={parseResult.total_in_file} tone="neutral" />
        <StatCard label="Vil opprettes" value={stats?.to_create ?? 0} tone="success" />
        <StatCard label="Vil oppdateres" value={stats?.to_update ?? 0} tone="info" />
        <StatCard label="Med utsalgspris" value={stats?.with_utsalg ?? 0} tone="neutral" />
        <StatCard label="Med engrospris > 0" value={stats?.with_engros ?? 0} tone="neutral" />
        <StatCard
          label="Hoppes over"
          value={stats?.to_skip ?? 0}
          tone={(stats?.parse_errors ?? 0) > 0 ? "warning" : "neutral"}
        />
      </div>

      {conflictCount > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{conflictCount} navnekonflikt(er) funnet</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              Tedebe-navn skiller seg fra eksisterende NBOS-navn. Velg hva som skal skje med alle
              konflikter — du kan overstyre enkeltrader i tabellen under.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={conflictResolution}
                onValueChange={(v) => setConflictResolution(v as ConflictChoice)}
              >
                <SelectTrigger className="h-8 w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONFLICT_LABEL) as ConflictChoice[]).map((c) => (
                    <SelectItem key={c} value={c}>
                      {CONFLICT_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {Object.keys(rowDecisions).length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setRowDecisions({})}>
                  Nullstill {Object.keys(rowDecisions).length} overstyring(er)
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Filter-rad */}
      <div className="rounded-md border bg-muted/30 p-3 space-y-3">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Filter
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 items-center">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={filter.skip_without_prices}
              onCheckedChange={(v) =>
                setFilter((f) => ({ ...f, skip_without_prices: v === true }))
              }
            />
            Hopp over rader uten priser
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={filter.create_new}
              onCheckedChange={(v) => setFilter((f) => ({ ...f, create_new: v === true }))}
            />
            Opprett nye produkter
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={filter.update_existing}
              onCheckedChange={(v) => setFilter((f) => ({ ...f, update_existing: v === true }))}
            />
            Oppdater eksisterende
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={filter.import_prices}
              onCheckedChange={(v) => setFilter((f) => ({ ...f, import_prices: v === true }))}
            />
            Importer priser
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Label className="text-sm shrink-0">Varenr mellom</Label>
          <Input
            type="number"
            placeholder="min"
            className="h-8 w-24"
            value={filter.varenr_min ?? ""}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                varenr_min: e.target.value === "" ? null : Number(e.target.value),
              }))
            }
          />
          <span className="text-sm text-muted-foreground">og</span>
          <Input
            type="number"
            placeholder="max"
            className="h-8 w-24"
            value={filter.varenr_max ?? ""}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                varenr_max: e.target.value === "" ? null : Number(e.target.value),
              }))
            }
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-sm shrink-0">Inkluder momskoder:</Label>
          {ALL_MOMSKODER.map((m) => (
            <Badge
              key={m}
              onClick={() => toggleMomskode(m)}
              className={cn(
                "cursor-pointer select-none",
                filter.momskoder.has(m)
                  ? "bg-app text-app-foreground hover:bg-app-dark"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {MOMSKODE_LABEL[m]}
            </Badge>
          ))}
        </div>
      </div>

      {/* Preview-tabell */}
      <div className="rounded-md border">
        <div className="px-3 py-2 border-b bg-muted/20 text-xs text-muted-foreground flex items-center justify-between">
          <span>
            Forhåndsvisning · viser {previewRows.length} av {classified.length} rader
          </span>
          {classified.length > 100 && <span>(de første 100)</span>}
        </div>
        <ScrollArea className="h-[280px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background border-b">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium text-xs text-muted-foreground">Nr</th>
                <th className="px-3 py-2 font-medium text-xs text-muted-foreground">Navn</th>
                <th className="px-3 py-2 font-medium text-xs text-muted-foreground">Mva</th>
                <th className="px-3 py-2 font-medium text-xs text-muted-foreground text-right">Utsalg</th>
                <th className="px-3 py-2 font-medium text-xs text-muted-foreground text-right">Engros</th>
                <th className="px-3 py-2 font-medium text-xs text-muted-foreground">Handling</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((r) => (
                <tr key={r.row_index} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-1.5 font-mono text-xs">{r.varenummer ?? "—"}</td>
                  <td className="px-3 py-1.5">{r.varenavn || <em className="text-muted-foreground">tom</em>}</td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    {r.momskode ?? "null"} → {r.mva_rate}%
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">
                    {r.utsalgspris != null ? r.utsalgspris.toFixed(2).replace(".", ",") : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">
                    {r.engrospris != null ? r.engrospris.toFixed(2).replace(".", ",") : "—"}
                  </td>
                  <td className="px-3 py-1.5">
                    <ActionCell action={r.action} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "success" | "info" | "warning";
}) {
  const toneClasses: Record<typeof tone, string> = {
    neutral: "bg-muted/40 text-foreground",
    success: "bg-app/10 text-app-dark",
    info: "bg-accent text-accent-foreground",
    warning: "bg-warning/15 text-warning-foreground",
  };
  return (
    <div className={cn("rounded-md border p-3", toneClasses[tone])}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="text-2xl font-bold mt-0.5 tabular-nums">{value.toLocaleString("nb-NO")}</div>
    </div>
  );
}

function ActionCell({ action }: { action: RowAction }) {
  const map: Record<RowAction, { icon: React.ReactNode; label: string; className: string }> = {
    create_with_prices: {
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      label: "Ny + priser",
      className: "text-app-dark",
    },
    create_no_prices: {
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      label: "Ny (ingen priser)",
      className: "text-app-dark",
    },
    update_match: {
      icon: <RefreshCw className="h-3.5 w-3.5" />,
      label: "Oppdater",
      className: "text-foreground",
    },
    update_name_conflict: {
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      label: "Navnekonflikt",
      className: "text-warning-foreground",
    },
    skip_no_prices: {
      icon: <SkipForward className="h-3.5 w-3.5" />,
      label: "Hoppes over (ingen priser)",
      className: "text-muted-foreground",
    },
    skip_filter: {
      icon: <SkipForward className="h-3.5 w-3.5" />,
      label: "Hoppes over (filter)",
      className: "text-muted-foreground",
    },
    skip_invalid: {
      icon: <XCircle className="h-3.5 w-3.5" />,
      label: "Ugyldig data",
      className: "text-destructive",
    },
  };
  const a = map[action];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", a.className)}>
      {a.icon}
      {a.label}
    </span>
  );
}

/* ============== STEG 3: BEKREFT ============== */

function Step3Confirm({ stats, fileName }: { stats: ClassificationStats; fileName: string }) {
  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Klar for import</AlertTitle>
        <AlertDescription>
          Når du trykker «Bekreft og start import» vil endringene bli skrevet til databasen i én
          transaksjon. Pris-endringer versjoneres (gammel pris får sluttdato i går, ny pris starter i dag).
        </AlertDescription>
      </Alert>

      <div className="rounded-md border p-4 space-y-2">
        <div className="text-sm font-semibold">Oppsummering for «{fileName}»</div>
        <div className="grid grid-cols-2 gap-y-1 gap-x-4 text-sm">
          <div className="text-muted-foreground">Totalt i fil</div>
          <div className="font-mono tabular-nums">{stats.total}</div>
          <div className="text-muted-foreground">Produkter vil opprettes</div>
          <div className="font-mono tabular-nums text-app-dark">{stats.to_create}</div>
          <div className="text-muted-foreground">Produkter vil oppdateres</div>
          <div className="font-mono tabular-nums text-foreground">{stats.to_update}</div>
          <div className="text-muted-foreground">Hvor av navnekonflikter</div>
          <div className="font-mono tabular-nums">{stats.conflicts}</div>
          <div className="text-muted-foreground">Hoppes over</div>
          <div className="font-mono tabular-nums">{stats.to_skip}</div>
        </div>
      </div>
    </div>
  );
}

/* ============== STEG 4: RAPPORT ============== */

function Step4Report({
  importing,
  result,
  error,
  onRetry,
}: {
  importing: boolean;
  result: ImportResult | null;
  error: string | null;
  onRetry: () => void;
}) {
  if (importing) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
        <Loader2 className="h-10 w-10 animate-spin text-app" />
        <div className="text-lg font-semibold">Behandler import…</div>
        <p className="text-sm text-muted-foreground max-w-sm">
          Importerer produkter og priser. Dette kan ta noen sekunder for store filer.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Importen feilet</AlertTitle>
          <AlertDescription>
            <p className="mt-1">{error}</p>
            <p className="mt-2 text-xs">Ingen endringer ble lagret. Du kan prøve igjen.</p>
          </AlertDescription>
        </Alert>
        <Button onClick={onRetry} variant="outline" size="sm">
          Prøv igjen
        </Button>
      </div>
    );
  }

  if (!result) return null;

  function downloadErrorCsv() {
    if (!result || result.errors.length === 0) return;
    const header = "radnr,varenummer,feilmelding\n";
    const escape = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const body = result.errors
      .map((e) => `${e.row_index},${e.varenummer},${escape(e.error)}`)
      .join("\n");
    const blob = new Blob(["\uFEFF" + header + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = osloTodayISO();
    a.href = url;
    a.download = `feilrapport_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-md border bg-app/5 p-4">
        <CheckCircle2 className="h-8 w-8 text-app shrink-0" />
        <div>
          <div className="text-lg font-semibold">Import fullført</div>
          <p className="text-sm text-muted-foreground">
            {result.created + result.updated} varer behandlet, {result.price_items_upserted} pris-endringer.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <StatCard label="Opprettet" value={result.created} tone="success" />
        <StatCard label="Oppdatert" value={result.updated} tone="info" />
        <StatCard label="Prisrader tilføyd" value={result.price_items_upserted} tone="success" />
        <StatCard label="Hoppet over" value={result.skipped} tone="neutral" />
        <StatCard
          label="Feilet"
          value={result.errors.length}
          tone={result.errors.length > 0 ? "warning" : "neutral"}
        />
      </div>

      {result.errors.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">
              {result.errors.length} feil under import
            </div>
            <Button onClick={downloadErrorCsv} variant="outline" size="sm">
              Last ned feilrapport (CSV)
            </Button>
          </div>
          <div className="rounded-md border max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50 border-b">
                <tr className="text-left">
                  <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Rad</th>
                  <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Varenr</th>
                  <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Feil</th>
                </tr>
              </thead>
              <tbody>
                {result.errors.slice(0, 20).map((e, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-mono text-xs">{e.row_index}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{e.varenummer}</td>
                    <td className="px-3 py-1.5 text-xs text-destructive">{e.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.errors.length > 20 && (
            <p className="text-xs text-muted-foreground">
              Viser de første 20 feilene. Last ned CSV for full liste.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
