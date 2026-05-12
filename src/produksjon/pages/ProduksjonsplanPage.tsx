import { useMemo, useState } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
    return lines.join("\n");
  }, [criteria, mains.data, subs.data]);

  const counts = plan.data?.orderCounts;
  const rows = plan.data?.rows ?? [];

  const applyTemplate = (t: CriteriaTemplate) => {
    setCriteria({ ...DEFAULT_CRITERIA, ...t.criteria });
    setActiveTemplate(t);
  };

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
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" onClick={() => window.print()}>
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
              <DropdownMenuItem disabled>Produksjonsliste (aktiv)</DropdownMenuItem>
              <DropdownMenuItem disabled>Pakkeliste</DropdownMenuItem>
              <DropdownMenuItem disabled>Spesifisert pakkeliste</DropdownMenuItem>
              <DropdownMenuItem disabled>Veieliste</DropdownMenuItem>
              <DropdownMenuItem disabled>Kvitteringsliste</DropdownMenuItem>
              <DropdownMenuItem disabled>Lagerliste</DropdownMenuItem>
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
            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm"
            style={{ backgroundColor: activeColor ?? undefined }}
          >
            <span className="font-medium">{activeTemplate.name}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => window.print()} title="Skriv ut">
              <Printer className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSaveDialog(true)} title="Lagre">
              <Save className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => plan.refetch()} title="Last på nytt">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setActiveTemplate(null)} title="Fjern">
              <X className="h-3.5 w-3.5" />
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

      {legalEntityId && (
        <div className="print-area space-y-3">
          <div className="hidden print:block mb-2">
            <h1 className="text-lg font-semibold">Produksjonsplan — {format(date, "dd.MM.yyyy")}</h1>
            {activeTemplate && <p className="text-xs">{activeTemplate.name}</p>}
            <pre className="text-[10px] font-mono whitespace-pre-wrap">{summary}</pre>
          </div>
          <ProductionPlanTable
            rows={rows}
            showByMainGroup={prefs.showByMainGroup}
            showTraysWithPlus={prefs.showTraysWithPlus}
            loading={plan.isLoading}
          />
        </div>
      )}

      {/* Footer hint */}
      <p className="text-xs text-muted-foreground print-hide">
        <Plus className="inline h-3 w-3 mr-1" />
        Snapshot- og korreksjons-funksjonen kommer i neste fase.
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
    </div>
  );
}
