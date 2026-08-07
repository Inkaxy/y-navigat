import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addWeeks,
  format,
  getISOWeek,
  parseISO,
  startOfWeek,
  addDays,
} from "date-fns";
import { nb } from "date-fns/locale";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  Check,
  X,
} from "lucide-react";
import { AppBanner } from "@/ordre/components/shell/AppBanner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { useNBCustomers, type CustomerOption } from "@/ordre/hooks/useNBCustomers";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";
import {
  RULE_TYPE_SHORT_LABEL,
  RULE_TYPE_LABEL,
  type DeliveryRuleType,
} from "@/ordre/hooks/useDeliveryRules";

type PlanRow = {
  dato: string;
  weekday: number;
  tour_id: string | null;
  tour_name: string | null;
  tour_number: number | null;
  gjelder_alle_turer: boolean;
  rule_id: string;
  rule_name: string;
  rule_type: string;
  effect: string;
  beskrivelse: string | null;
  kunde_scope: string | null;
  antall_varer: number | null;
};

const RULE_TYPES: DeliveryRuleType[] = [
  "order_deadline",
  "delivery_weekdays",
  "available_tours",
  "available_products",
  "no_delivery",
];

const WEEKDAYS = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];

const EFFECT_CLASS: Record<string, string> = {
  block: "border-destructive/40 bg-destructive/10 text-destructive",
  warn: "border-amber-400/50 bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
  info: "border-blue-400/50 bg-blue-100 text-blue-900 dark:bg-blue-500/15 dark:text-blue-200",
};

const EFFECT_ICON: Record<string, string> = { block: "⛔", warn: "⚠️", info: "ℹ️" };

function isoMonday(d: Date): string {
  return format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

function CustomerFilter({
  value,
  onSelect,
}: {
  value: CustomerOption | null;
  onSelect: (c: CustomerOption | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 250);
  const { data: customers, isLoading } = useNBCustomers(debouncedQ);

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" size="sm" className="w-[280px] justify-between">
            <span className="truncate">
              {value ? `${value.customer_number} — ${value.display_name}` : "Alle kunder"}
            </span>
            <Search className="ml-2 h-4 w-4 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[360px] p-0">
          <div className="border-b border-border p-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Søk navn, kundenr..."
              autoFocus
            />
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              </div>
            ) : !customers || customers.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Ingen treff</div>
            ) : (
              customers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onSelect(c);
                    setOpen(false);
                  }}
                >
                  <div className="flex-1">
                    <div className="font-medium">{c.display_name}</div>
                    <div className="text-xs text-muted-foreground">{c.customer_number}</div>
                  </div>
                  {value?.id === c.id && <Check className="h-4 w-4 text-primary" />}
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          aria-label="Nullstill kundefilter"
          onClick={() => onSelect(null)}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export default function WeeklyDeliveryPlan() {
  const [weekStart, setWeekStart] = useState<string>(() => isoMonday(new Date()));
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [types, setTypes] = useState<DeliveryRuleType[]>([]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["weekly-delivery-plan", weekStart, customer?.id ?? null, types],
    staleTime: 30_000,
    queryFn: async (): Promise<PlanRow[]> => {
      const { data, error } = await supabase.rpc("get_weekly_delivery_plan", {
        p_legal_entity_id: NB_LEGAL_ENTITY_ID,
        p_week_start: weekStart,
        p_customer_id: (customer?.id ?? null) as string,
        p_rule_types: (types.length > 0 ? types : null) as string[],
      });
      if (error) throw error;
      return (data ?? []) as unknown as PlanRow[];
    },
  });

  const weekNo = getISOWeek(parseISO(weekStart));
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(parseISO(weekStart), i)),
    [weekStart],
  );

  // Rader: «Alle turer» først, deretter hver tur som forekommer i uken.
  const tourRows = useMemo(() => {
    const map = new Map<string, { id: string; label: string; number: number }>();
    for (const r of rows) {
      if (r.gjelder_alle_turer || !r.tour_id) continue;
      if (!map.has(r.tour_id)) {
        map.set(r.tour_id, {
          id: r.tour_id,
          label: r.tour_name ?? `Tur ${r.tour_number ?? "?"}`,
          number: r.tour_number ?? 9999,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.number - b.number);
  }, [rows]);

  const hasAllTours = rows.some((r) => r.gjelder_alle_turer || !r.tour_id);

  const cell = (tourId: string | null, weekday: number) =>
    rows.filter((r) =>
      tourId === null
        ? (r.gjelder_alle_turer || !r.tour_id) && r.weekday === weekday
        : !r.gjelder_alle_turer && r.tour_id === tourId && r.weekday === weekday,
    );

  const toggleType = (t: DeliveryRuleType) =>
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const shiftWeek = (delta: number) =>
    setWeekStart(isoMonday(addWeeks(parseISO(weekStart), delta)));

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <AppBanner
          title="Leveranseplan"
          subtitle="Hvilke leveringsregler som gjelder per tur og ukedag"
          icon={CalendarRange}
        />

        <div className="mx-auto w-full max-w-[1400px] space-y-4 px-4 py-6">
          {/* Verktøylinje */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => shiftWeek(-1)} aria-label="Forrige uke">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-[220px] text-center">
                <div className="text-sm font-semibold">Uke {weekNo}</div>
                <div className="text-xs text-muted-foreground">
                  {format(parseISO(weekStart), "d. MMM", { locale: nb })} –{" "}
                  {format(addDays(parseISO(weekStart), 6), "d. MMM yyyy", { locale: nb })}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => shiftWeek(1)} aria-label="Neste uke">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setWeekStart(isoMonday(new Date()))}>
                Denne uken
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <CustomerFilter value={customer} onSelect={setCustomer} />
              <div className="flex flex-wrap gap-1">
                {RULE_TYPES.map((t) => {
                  const active = types.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleType(t)}
                      title={RULE_TYPE_LABEL[t]}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {RULE_TYPE_SHORT_LABEL[t]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Rutenett */}
          <Card className="overflow-x-auto p-0">
            {isLoading ? (
              <div className="flex items-center justify-center p-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : rows.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                Ingen leveringsregler treffer denne uken med valgte filtre.
              </div>
            ) : (
              <table className="w-full min-w-[1000px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="w-[150px] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Tur
                    </th>
                    {days.map((d, i) => (
                      <th key={i} className="px-2 py-2 text-left text-xs font-semibold">
                        <div>{WEEKDAYS[i]}</div>
                        <div className="font-normal text-muted-foreground">
                          {format(d, "d. MMM", { locale: nb })}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hasAllTours && (
                    <PlanTableRow label="Alle turer" weekdayCells={(w) => cell(null, w)} />
                  )}
                  {tourRows.map((t) => (
                    <PlanTableRow
                      key={t.id}
                      label={t.label}
                      weekdayCells={(w) => cell(t.id, w)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {/* Tegnforklaring */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="font-semibold">Tegnforklaring:</span>
            <span className={cn("rounded-full border px-2 py-0.5", EFFECT_CLASS.block)}>
              ⛔ Blokkerer
            </span>
            <span className={cn("rounded-full border px-2 py-0.5", EFFECT_CLASS.warn)}>
              ⚠️ Advarer
            </span>
            <span className={cn("rounded-full border px-2 py-0.5", EFFECT_CLASS.info)}>
              ℹ️ Info
            </span>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function PlanTableRow({
  label,
  weekdayCells,
}: {
  label: string;
  weekdayCells: (weekday: number) => PlanRow[];
}) {
  return (
    <tr className="border-b border-border align-top last:border-0">
      <th className="bg-muted/20 px-3 py-2 text-left text-xs font-semibold">{label}</th>
      {[1, 2, 3, 4, 5, 6, 7].map((w) => {
        const items = weekdayCells(w);
        return (
          <td key={w} className="px-2 py-2">
            {items.length === 0 ? (
              <span className="text-xs text-muted-foreground/50">—</span>
            ) : (
              <div className="flex flex-col gap-1">
                {items.map((r) => (
                  <Tooltip key={`${r.rule_id}-${r.dato}`}>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          "cursor-default truncate rounded-md border px-2 py-1 text-[11px] font-medium",
                          EFFECT_CLASS[r.effect] ?? EFFECT_CLASS.info,
                        )}
                      >
                        {EFFECT_ICON[r.effect] ?? "ℹ️"}{" "}
                        {RULE_TYPE_SHORT_LABEL[r.rule_type as DeliveryRuleType] ?? r.rule_type}
                        {": "}
                        {r.rule_name}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[320px]">
                      <div className="text-xs font-semibold">{r.rule_name}</div>
                      {r.beskrivelse && <div className="mt-1 text-xs">{r.beskrivelse}</div>}
                      {r.kunde_scope && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          Gjelder: {r.kunde_scope}
                        </div>
                      )}
                      {!!r.antall_varer && (
                        <div className="text-[11px] text-muted-foreground">
                          {r.antall_varer} vare(r)
                        </div>
                      )}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
}
