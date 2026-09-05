import { flushSync } from "react-dom";
import { useMemo, useState, useCallback } from "react";
import { format, addDays, subDays, parseISO, isToday, isTomorrow, isYesterday } from "date-fns";
import { nb } from "date-fns/locale";
import {
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Settings as SettingsIcon,
  ChevronDown,
  Save,
  Printer,
  X,
  Plus,
  FileText,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import {
  fetchLatestSnapshotItems,
  saveProductionPlanSnapshot,
  type SnapshotItem,
} from "../features/produksjonsplan/hooks/useProductionPlanSnapshots";
import { CorrectionPlanTable } from "../features/produksjonsplan/components/CorrectionPlanTable";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { useSelection } from "@/providers/SelectionProvider";
import { useUiPreference } from "@/hooks/useUiPreference";
import { cn } from "@/lib/utils";

import { DEFAULT_CRITERIA, type CriteriaTemplate, type ProduksjonsplanCriteria } from "../features/produksjonsplan/types";
import { useProductionPlan } from "../features/produksjonsplan/hooks/useProductionPlan";
import { useTemplateCategories } from "../features/produksjonsplan/hooks/useTemplateCategories";
import {
  useMainCategories,
  useSubCategories,
} from "../features/produksjonsplan/hooks/useReferenceData";
import { ProductionPlanTable, type ColumnVisibility } from "../features/produksjonsplan/components/ProductionPlanTable";
import { SettKriteriaDialog } from "../features/produksjonsplan/components/SettKriteriaDialog";
import { HentKriteriaDialog } from "../features/produksjonsplan/components/HentKriteriaDialog";
import { SaveTemplateDialog } from "../features/produksjonsplan/components/SaveTemplateDialog";
import {
  PrintProduksjonslisteDialog,
  DEFAULT_PRINT_PRODUKSJON_OPTIONS,
  type PrintProduksjonslisteOptions,
} from "../features/produksjonsplan/components/PrintProduksjonslisteDialog";
import {
  PrintPakkelisteDialog,
  DEFAULT_PRINT_PAKKELISTE_OPTIONS,
  type PrintPakkelisteOptions,
} from "../features/produksjonsplan/components/PrintPakkelisteDialog";
import { OverforePakkesystemDialog } from "../features/produksjonsplan/components/OverforePakkesystemDialog";

interface UiPrefs {
  showCustomers: boolean;
  showNotes: boolean;
  showStockAlerts: boolean;
  showTraysWithPlus: boolean;
  showByMainGroup: boolean;
  useLeadTimes: boolean;
  hideDoughTypes: boolean;
  expandPackages: boolean;
  // Kolonne-valg
  colMainGroup?: boolean;
  colDoughType?: boolean;
  colUnit?: boolean;
  colOrdered?: boolean;
  colFromStock?: boolean;
  colLiters?: boolean;
  colOnStock?: boolean;
}

const DEFAULT_PREFS: UiPrefs = {
  showCustomers: false,
  showNotes: false,
  showStockAlerts: false,
  showTraysWithPlus: true,
  showByMainGroup: true,
  useLeadTimes: true,
  hideDoughTypes: false,
  expandPackages: false,
  colMainGroup: true,
  colDoughType: true,
  colUnit: true,
  colOrdered: true,
  colFromStock: true,
  colLiters: true,
  colOnStock: true,
};

function relativeLabel(d: Date): string {
  if (isToday(d)) return "i dag";
  if (isTomorrow(d)) return "i morgen, " + format(d, "EEEE", { locale: nb });
  if (isYesterday(d)) return "i går";
  return format(d, "EEEE", { locale: nb });
}

export default function ProduksjonsplanPage() {
  const { legalEntityId } = useSelection();
  const { value: prefs, setValue: setPrefs } = useUiPreference<UiPrefs>("produksjonsplan.prefs", DEFAULT_PREFS);

  const [date, setDate] = useState<Date>(new Date());
  const dateStr = format(date, "yyyy-MM-dd");

  const [criteria, setCriteria] = useState<ProduksjonsplanCriteria>(DEFAULT_CRITERIA);
  const [activeTemplate, setActiveTemplate] = useState<CriteriaTemplate | null>(null);

  const [setDialog, setSetDialog] = useState(false);
  const [hentDialog, setHentDialog] = useState(false);
  const [saveDialog, setSaveDialog] = useState(false);
  const [editingTpl, setEditingTpl] = useState<CriteriaTemplate | null>(null);

  const [printProdDialog, setPrintProdDialog] = useState(false);
  const [printPackDialog, setPrintPackDialog] = useState(false);
  const [pakkesystemDialog, setPakkesystemDialog] = useState(false);
  const { value: printProdDefaults, setValue: setPrintProdDefaults } =
    useUiPreference<PrintProduksjonslisteOptions>(
      "produksjonsplan.print.produksjon",
      DEFAULT_PRINT_PRODUKSJON_OPTIONS,
    );
  const { value: printPackDefaults, setValue: setPrintPackDefaults } =
    useUiPreference<PrintPakkelisteOptions>(
      "produksjonsplan.print.pakkeliste",
      DEFAULT_PRINT_PAKKELISTE_OPTIONS,
    );

  const plan = useProductionPlan({ legalEntityId, date: dateStr, criteria });
  const cats = useTemplateCategories();
  const mains = useMainCategories(legalEntityId);
  const subs = useSubCategories(legalEntityId);

  const activeColor = useMemo(() => {
    if (!activeTemplate) return null;
    return cats.data?.find((c) => c.code === activeTemplate.category_code)?.color_hex ?? "#e2e8f0";
  }, [activeTemplate, cats.data]);

  const summary = useMemo(() => {
    const lines: string[] = [];
    lines.push(
      `Tur: ${criteria.tour_numbers.length === 0 ? "Alle" : criteria.tour_numbers.join(",")}` +
      (criteria.sum_tours ? " (summert)" : ""),
    );
    const mainCodes = (mains.data ?? [])
      .filter((m) => criteria.main_category_ids.includes(m.id))
      .map((m) => m.code);
    lines.push(
      `Hovedvaregrupper: ${mainCodes.length === 0 ? "Alle" : mainCodes.join(", ")}`,
    );
    const subCodes = (subs.data ?? [])
      .filter((s) => criteria.sub_category_ids.includes(s.id))
      .map((s) => s.code);
    lines.push(
      `Undervaregrupper: ${subCodes.length === 0 ? "Alle" : subCodes.join(", ")}`,
    );
    if (criteria.include_products_without_subcategory) {
      lines.push("       (og uten undervaregruppe)");
    }
    const aggLabel: Record<ProduksjonsplanCriteria["aggregation"], string> = {
      per_product: "Pr varenr",
      per_main_and_production_group: "Pr hovedgrp. + produksjonsgrp",
      per_production_group: "Pr produksjonsgruppe",
    };
    lines.push(aggLabel[criteria.aggregation]);
    lines.push(criteria.customer_group_ids.length === 0 ? "Alle kunder" : `${criteria.customer_group_ids.length} kundegrupper`);
    const sortLabel: Record<ProduksjonsplanCriteria["sort_by"], string> = {
      default: "Sorteres etter standard",
      product_number: "Sorteres etter varenummer",
      product_name: "Sorteres etter varenavn",
    };
    lines.push(sortLabel[criteria.sort_by]);
    lines.push(`Utskrift: hovedliste${criteria.print_correction_last ? " + korreksjonsliste" : ""}`);
    return lines.join("\n");
  }, [criteria, mains.data, subs.data]);

  const counts = plan.data?.orderCounts;
  const rows = plan.data?.rows ?? [];
  const basis = plan.data?.basis ?? null;

  const applyTemplate = (t: CriteriaTemplate) => {
    setCriteria({ ...DEFAULT_CRITERIA, ...t.criteria });
    setActiveTemplate(t);
  };

  // === Print: snapshot + korreksjon =====================================
  const [printJob, setPrintJob] = useState<{
    correction: boolean;
    prevItems: Map<string, SnapshotItem> | null;
    prevTakenAt: string | null;
    alternateRowGray: boolean;
  } | null>(null);

  const handlePrint = useCallback(async (options: PrintProduksjonslisteOptions = printProdDefaults) => {
    if (!legalEntityId) {
      window.print();
      return;
    }
    if (rows.length === 0) {
      toast({
        title: "Ingen rader å skrive ut",
        description: "Snapshot lagres ikke før produksjonslisten har innhold.",
      });
      return;
    }
    const wantCorrection = !!criteria.print_correction_last;

    let prev: { takenAt: string; items: Map<string, SnapshotItem> } | null = null;
    let savedItemCount = 0;
    if (wantCorrection) {
      try {
        prev = await fetchLatestSnapshotItems(legalEntityId, dateStr, criteria);
      } catch (e) {
        console.error(e);
      }
      if (!prev) {
        toast({
          title: "Ingen tidligere snapshot",
          description: "Korreksjonsliste hoppes over – siste kopi blir vanlig liste.",
        });
      }
    }

    try {
      const saved = await saveProductionPlanSnapshot(legalEntityId, dateStr, criteria, rows);
      if (!saved) {
        toast({
          title: "Snapshot ble ikke lagret",
          description: "Utskrift er avbrutt slik at neste korreksjonsliste ikke får feil grunnlag.",
          variant: "destructive",
        });
        return;
      }
      savedItemCount = saved.itemCount;
    } catch (e) {
      console.error("Snapshot-lagring feilet", e);
      toast({
        title: "Snapshot ble ikke lagret",
        description: "Utskrift er avbrutt slik at neste korreksjonsliste ikke får feil grunnlag.",
        variant: "destructive",
      });
      return;
    }

    flushSync(() => {
      setPrintJob({
        correction: wantCorrection && !!prev,
        prevItems: prev?.items ?? null,
        prevTakenAt: prev?.takenAt ?? null,
        alternateRowGray: options.alternateRowGray,
      });
    });

    // Snapshot er lagret før print-dialogen åpnes, slik at avbrutt/ferdig utskrift gir samme grunnlag.
    setTimeout(() => {
      window.print();
      setTimeout(() => {
        setPrintJob(null);
        toast({
          title: "Snapshot lagret",
          description: `Lagret ${savedItemCount} varelinjer for ${format(date, "dd.MM.yyyy")}.`,
        });
      }, 500);
    }, 100);
  }, [legalEntityId, dateStr, date, criteria, rows, printProdDefaults]);


  return (
    <div className="space-y-4">
      {/* Topp-bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setDate(subDays(date, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2 font-mono">
                <CalendarIcon className="h-4 w-4" />
                {format(date, "dd.MM.yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar
                mode="single"
                selected={date}
                onSelect={(d) => d && setDate(d)}
                initialFocus
                locale={nb}
                weekStartsOn={1}
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon" onClick={() => setDate(addDays(date, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground ml-2">{relativeLabel(date)}</span>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => plan.refetch()} title="Last på nytt">
            <RefreshCw className={cn("h-4 w-4", plan.isFetching && "animate-spin")} />
          </Button>

          {/* Innstillinger */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" title="Innstillinger">
                <SettingsIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Innstillinger</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={prefs.showCustomers} onCheckedChange={(v) => setPrefs({ ...prefs, showCustomers: !!v })}>Vis kunder</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={prefs.showNotes} onCheckedChange={(v) => setPrefs({ ...prefs, showNotes: !!v })}>Vis merknader</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={prefs.showStockAlerts} onCheckedChange={(v) => setPrefs({ ...prefs, showStockAlerts: !!v })}>Vis lagervarsler</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={prefs.showTraysWithPlus} onCheckedChange={(v) => setPrefs({ ...prefs, showTraysWithPlus: !!v })}>Vis antall plater med pluss-tegn</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={prefs.showByMainGroup} onCheckedChange={(v) => setPrefs({ ...prefs, showByMainGroup: !!v })}>Vis pr hovedgruppe</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={prefs.useLeadTimes} onCheckedChange={(v) => setPrefs({ ...prefs, useLeadTimes: !!v })}>Bruk ledetider</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={prefs.hideDoughTypes} onCheckedChange={(v) => setPrefs({ ...prefs, hideDoughTypes: !!v })}>Skriv uten deigtyper</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={prefs.expandPackages} onCheckedChange={(v) => setPrefs({ ...prefs, expandPackages: !!v })}>Ekspander pakker</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Kolonner</DropdownMenuLabel>
              <DropdownMenuCheckboxItem checked={prefs.colMainGroup ?? true} onCheckedChange={(v) => setPrefs({ ...prefs, colMainGroup: !!v })}>Hovedgruppe</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={prefs.colDoughType ?? true} onCheckedChange={(v) => setPrefs({ ...prefs, colDoughType: !!v })}>Deigtype</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={prefs.colOrdered ?? true} onCheckedChange={(v) => setPrefs({ ...prefs, colOrdered: !!v })}>I ordre</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={prefs.colFromStock ?? true} onCheckedChange={(v) => setPrefs({ ...prefs, colFromStock: !!v })}>Fra lager</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={prefs.colUnit ?? true} onCheckedChange={(v) => setPrefs({ ...prefs, colUnit: !!v })}>Enhet</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={prefs.colLiters ?? true} onCheckedChange={(v) => setPrefs({ ...prefs, colLiters: !!v })}>Liter</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={prefs.colOnStock ?? true} onCheckedChange={(v) => setPrefs({ ...prefs, colOnStock: !!v })}>På lager</DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" onClick={() => setPrintProdDialog(true)}>
            <Printer className="h-4 w-4 mr-2" />
            Skriv ut
          </Button>

          {/* Handling-meny */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="brand" className="gap-1">
                Handling <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => setPrintProdDialog(true)}>Produksjonsliste</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPrintPackDialog(true)}>Pakkeliste</DropdownMenuItem>
              <DropdownMenuItem disabled>Spesifisert pakkeliste</DropdownMenuItem>
              <DropdownMenuItem disabled>Veieliste</DropdownMenuItem>
              <DropdownMenuItem disabled>Kvitteringsliste</DropdownMenuItem>
              <DropdownMenuItem disabled>Lagerliste</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPakkesystemDialog(true)}>Overføre til Pakkesystem</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSetDialog(true)}>Sett kriteria</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setHentDialog(true)}>Hent kriteria</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSaveDialog(true)}>Lagre som mal…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Status-boks + mal-pille */}
      <div className="flex flex-wrap items-start gap-3">
        <Card
          className="p-3 cursor-pointer hover:bg-muted/40 transition-colors"
          onClick={() => setSetDialog(true)}
        >
          <pre className="text-xs font-mono leading-snug whitespace-pre-wrap">{summary}</pre>
        </Card>

        {activeTemplate && (
          <div
            className="mx-auto inline-flex items-center justify-center gap-2 rounded-full border-2 border-brand-bronze/40 px-5 py-2 text-base font-semibold shadow-sm"
            style={{ backgroundColor: activeColor ?? undefined }}
          >
            <span className="font-display tracking-tight">{activeTemplate.name}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPrintProdDialog(true)} title="Skriv ut">
              <Printer className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSaveDialog(true)} title="Lagre">
              <Save className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => plan.refetch()} title="Last på nytt">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setActiveTemplate(null)} title="Fjern">
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>


      {/* Status-tekst */}
      {counts && (
        <p className="text-xs text-muted-foreground">
          {counts.fast} fastordre &nbsp;·&nbsp; {counts.datert} daterte ordre &nbsp;·&nbsp; {counts.pakkseddel} pakksedler
          {criteria.tour_numbers.length > 0 && ` — kriteriene gjelder tur ${criteria.tour_numbers.join(", ")}`}
        </p>
      )}

      {!legalEntityId && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Velg selskap i hovedmenyen for å se produksjonsplanen.
        </Card>
      )}

      {legalEntityId && (() => {
        const cols: ColumnVisibility = {
          mainGroup: prefs.colMainGroup ?? true,
          doughType: (prefs.colDoughType ?? true) && !prefs.hideDoughTypes,
          unit: prefs.colUnit ?? true,
          ordered: prefs.colOrdered ?? true,
          fromStock: prefs.colFromStock ?? true,
          liters: prefs.colLiters ?? true,
          onStock: prefs.colOnStock ?? true,
        };
        const correctionLast = !!printJob?.correction && !!printJob?.prevItems;
        const baseDateLabel = `${format(date, "EEEE dd.MM.yy", { locale: nb })}${criteria.sum_tours ? " sum alle turer" : ""}`;
        const printedAt = format(new Date(), "dd.MM.yy HH:mm");

        // Bygg liste over "sider": hovedliste + evt. én korreksjonsside
        const pages: Array<{ kind: "normal" | "correction"; copyIdx: number }> = [
          { kind: "normal", copyIdx: 0 },
        ];
        if (correctionLast) {
          pages.push({ kind: "correction", copyIdx: 1 });
        }

        return (
          <div className={cn("print-area space-y-3", (printJob?.alternateRowGray ?? true) && "print-zebra-rows")}>
            {/* Skjerm-visning: kun den vanlige tabellen én gang */}
            <div className="print:hidden">
              {basis && (
                <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-line-subtle bg-muted/40 px-3 py-2 text-xs">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  {basis.mode === "pakksedler" ? (
                    <>
                      <span>
                        Grunnlag: pakksedler kjørt
                        {basis.runAt ? ` kl. ${format(new Date(basis.runAt), "HH:mm")}` : ""} (
                        {basis.noteCount} pakksedler)
                        {basis.newAfterRunCount > 0
                          ? ` + ${basis.newAfterRunCount} ordre lagt inn etter kjøringen`
                          : ""}
                      </span>
                      <Link
                        to={`/ordre/pakksedler?date=${dateStr}`}
                        className="font-medium underline underline-offset-2"
                      >
                        Se pakksedler
                      </Link>
                    </>
                  ) : (
                    <span>Grunnlag: bestillinger og fastordre — hovedkjøring ikke kjørt ennå</span>
                  )}
                </div>
              )}
              <ProductionPlanTable

                rows={rows}
                showByMainGroup={prefs.showByMainGroup}
                showTraysWithPlus={prefs.showTraysWithPlus}
                loading={plan.isLoading}
                columns={cols}
                deliveryDate={dateStr}
              />
              {counts && (
                <p className="text-xs text-muted-foreground mt-2">
                  Fra {counts.datert} daterte ordre, {counts.fast} fastordre
                  {counts.pakkseddel > 0 ? `, ${counts.pakkseddel} pakksedler` : ""}
                </p>
              )}
            </div>

            {/* Print-visning: N sider, evt. korreksjon på siste */}
            <div className="hidden print:block">
              {pages.map((p) => (
                <div key={p.copyIdx} className="print-page">
                  <div className="flex justify-between items-baseline mb-2">
                    <h1 className="text-base font-bold uppercase">
                      {p.kind === "correction" ? "Korreksjonsliste for: " : "Produksjonsliste for: "}
                      {baseDateLabel}
                      {p.kind === "correction" && printJob?.prevTakenAt && (
                        <span className="ml-2 text-[9pt] font-normal normal-case">
                          – endring siden {format(new Date(printJob.prevTakenAt), "HH:mm")}
                        </span>
                      )}
                    </h1>
                    <span className="text-[9pt]">
                      Skrevet ut: {printedAt}
                    </span>
                  </div>
                  {p.kind === "correction" && printJob?.prevItems ? (
                    <CorrectionPlanTable
                      rows={rows}
                      showByMainGroup={prefs.showByMainGroup}
                      showTraysWithPlus={prefs.showTraysWithPlus}
                      columns={cols}
                      previousItems={printJob.prevItems}
                      criteria={criteria}
                    />
                  ) : (
                    <ProductionPlanTable
                      rows={rows}
                      showByMainGroup={prefs.showByMainGroup}
                      showTraysWithPlus={prefs.showTraysWithPlus}
                      loading={false}
                      columns={cols}
                      deliveryDate={dateStr}
                    />
                  )}
                  {counts && (
                    <p className="text-[9pt] mt-2">
                      Fra {counts.datert} daterte ordre, {counts.fast} fastordre
                      {counts.pakkseddel > 0 ? `, ${counts.pakkseddel} pakksedler` : ""}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Footer hint */}
      <p className="text-xs text-muted-foreground print-hide">
        <Plus className="inline h-3 w-3 mr-1" />
        Snapshots lagres automatisk ved utskrift og slettes etter 2 dager.
      </p>

      <SettKriteriaDialog
        open={setDialog}
        onOpenChange={setSetDialog}
        legalEntityId={legalEntityId}
        initial={criteria}
        onApply={(c) => {
          setCriteria(c);
          // mal er ikke lenger en eksakt kopi
          if (activeTemplate && JSON.stringify(c) !== JSON.stringify(activeTemplate.criteria)) {
            // behold pille men marker som endret? for nå: behold
          }
        }}
      />
      <HentKriteriaDialog
        open={hentDialog}
        onOpenChange={setHentDialog}
        legalEntityId={legalEntityId}
        onPick={applyTemplate}
        onEdit={(t) => { setEditingTpl(t); setSaveDialog(true); }}
      />
      <SaveTemplateDialog
        open={saveDialog}
        onOpenChange={(o) => { setSaveDialog(o); if (!o) setEditingTpl(null); }}
        legalEntityId={legalEntityId}
        criteria={criteria}
        editing={editingTpl ?? activeTemplate}
        onSaved={() => { /* refetched by hook */ }}
      />

      <PrintProduksjonslisteDialog
        open={printProdDialog}
        onOpenChange={setPrintProdDialog}
        summary={summary}
        templateName={activeTemplate?.name ?? null}
        initial={printProdDefaults}
        onSaveDefaults={(o) => {
          setPrintProdDefaults(o);
          toast({ title: "Standardvalg lagret" });
        }}
        onPrint={(o) => {
          setPrintProdDefaults(o);
          // Synk snapshot/diff-valg inn i criteria slik at handlePrint bruker samme grunnlag
          if (o.showSnapshotDiff !== !!criteria.print_correction_last) {
            setCriteria({ ...criteria, print_correction_last: o.showSnapshotDiff });
          }
          setPrintProdDialog(false);
          // Vent én tick slik at criteria oppdateres før vi printer
          setTimeout(() => handlePrint(o), 50);
        }}
      />

      <OverforePakkesystemDialog
        open={pakkesystemDialog}
        onOpenChange={setPakkesystemDialog}
        date={dateStr}
        criteria={criteria}
        summary={summary}
      />

      <PrintPakkelisteDialog
        open={printPackDialog}
        onOpenChange={setPrintPackDialog}
        summary={summary}
        templateName={activeTemplate?.name ?? null}
        initial={printPackDefaults}
        onSaveDefaults={(o) => {
          setPrintPackDefaults(o);
          toast({ title: "Standardvalg lagret" });
        }}
        onPrint={(o) => {
          setPrintPackDefaults(o);
          setPrintPackDialog(false);
          toast({
            title: "Pakkeliste",
            description: "Utskrift av pakkeliste er ikke implementert ennå.",
          });
        }}
      />
    </div>
  );
}
