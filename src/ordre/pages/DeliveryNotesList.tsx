import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Play, Printer, ListTree, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useDeliveryNotesList,
  type DeliveryNoteRow,
  type DeliveryNoteLineRow,
} from "@/ordre/hooks/useDeliveryNotesList";
import { useDeliveryTours } from "@/ordre/hooks/useDeliveryTours";
import { usePendingRecurringOrderRows } from "@/ordre/hooks/usePendingRecurringOrders";
import { useGenerateDeliveryNotes } from "@/ordre/hooks/useGenerateDeliveryNotes";
import { formatDate, todayISO } from "@/ordre/lib/format";
import { cn } from "@/lib/utils";
import { BulkPakkseddelPDFButton } from "@/ordre/components/pakksedler/BulkPakkseddelPDFButton";
import { NULL_TOUR_KEY } from "@/ordre/hooks/useTourRunStatus";

const WEEKDAY_SHORT = ["søn", "man", "tir", "ons", "tor", "fre", "lør"];

function weekdayShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return WEEKDAY_SHORT[d.getDay()] ?? "";
}

function statusVariant(status: string): { label: string; cls: string } {
  switch (status) {
    case "draft":
      return { label: "Draft", cls: "bg-muted text-foreground border-border" };
    case "printed":
      return { label: "Skrevet ut", cls: "bg-blue-100 text-blue-900 border-blue-200" };
    case "delivered":
      return { label: "Levert", cls: "bg-emerald-100 text-emerald-900 border-emerald-200" };
    case "under_correction":
      return { label: "Korrigeres", cls: "bg-amber-100 text-amber-900 border-amber-200" };
    case "finalized":
      return { label: "Finalisert", cls: "bg-emerald-200 text-emerald-950 border-emerald-300" };
    case "invoiced":
      return { label: "Fakturert", cls: "bg-purple-200 text-purple-950 border-purple-300" };
    case "cancelled":
      return { label: "Kansellert", cls: "bg-destructive/15 text-destructive border-destructive/30" };
    default:
      return { label: status, cls: "bg-muted text-foreground border-border" };
  }
}

function sourceBadge(kind: DeliveryNoteRow["source_kind"]) {
  switch (kind) {
    case "fast":
      return { label: "Pakkseddel – fast", cls: "bg-brand-ink text-brand-cream border-brand-ink" };
    case "datert":
      return { label: "Pakkseddel – datert", cls: "bg-brand-bronze text-brand-cream border-brand-bronze" };
    case "mixed":
      return { label: "Pakkseddel – blandet", cls: "bg-amber-700 text-amber-50 border-amber-700" };
  }
}

function customerNameOf(row: DeliveryNoteRow): string {
  return (
    (row.customer_snapshot?.["display_name"] as string | undefined) ??
    (row.customer_snapshot?.["name"] as string | undefined) ??
    "—"
  );
}

function customerNumberOf(row: DeliveryNoteRow): string | null {
  const n =
    (row.customer_snapshot?.["customer_number"] as string | number | undefined) ??
    (row.customer_snapshot?.["number"] as string | number | undefined) ??
    null;
  return n == null ? null : String(n);
}

function productNameOf(line: DeliveryNoteLineRow): string {
  return (
    (line.product_snapshot?.["display_name"] as string | undefined) ??
    (line.product_snapshot?.["name"] as string | undefined) ??
    "—"
  );
}

function productNumberOf(line: DeliveryNoteLineRow): string | null {
  const n =
    (line.product_snapshot?.["product_number"] as string | number | undefined) ??
    (line.product_snapshot?.["number"] as string | number | undefined) ??
    null;
  return n == null ? null : String(n);
}

function tourLabelShort(label: string | null): string {
  if (!label) return "uten tur";
  // Match "Tur 3" or first number → "tur 3"
  const m = label.match(/(\d+)/);
  return m ? `tur ${m[1]}` : label.toLowerCase();
}

export default function DeliveryNotesList() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const date = params.get("date") || todayISO();
  const tourParam = params.get("tour") || "all";

  const { data: tours = [] } = useDeliveryTours({ activeOnly: true });
  const { data: rows = [], isLoading } = useDeliveryNotesList(date, tourParam);
  const { data: pendingRows = [], isLoading: pendingLoading } = usePendingRecurringOrderRows(date, tourParam);
  const generate = useGenerateDeliveryNotes();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showLines, setShowLines] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  const tourLabel = useMemo(() => {
    if (tourParam === "all") return "alle turer";
    if (tourParam === NULL_TOUR_KEY) return "uten tur";
    const t = tours.find((x) => x.id === tourParam);
    return t ? `tur ${t.tour_number}` : "valgt tur";
  }, [tourParam, tours]);

  const totalCount = rows.length + pendingRows.length;
  const allChecked = rows.length > 0 && selected.size === rows.length;
  const someChecked = selected.size > 0 && selected.size < rows.length;

  function toggleAll(checked: boolean) {
    if (checked) setSelected(new Set(rows.map((r) => r.id)));
    else setSelected(new Set());
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const wd = weekdayShort(date);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 space-y-4">
        {/* Tittel-stripe */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Tilbake
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            {formatDate(date)} ({tourLabel}), pakksedler
          </h1>
          <Badge
            variant="outline"
            className="ml-2 bg-brand-ink text-brand-cream border-brand-ink"
          >
            {totalCount} treff
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            {pendingRows.length > 0 && (
              <Button
                variant="brand"
                size="sm"
                className="gap-2"
                disabled={generate.isPending}
                onClick={async () => {
                  try {
                    const tourFilter =
                      tourParam === "all" || tourParam === NULL_TOUR_KEY ? null : [tourParam];
                    const result = await generate.mutateAsync({ date, tourFilter, runType: "main" });
                    toast.success(
                      `Hovedkjøring: ${result.notes_generated} pakksedler · ${result.recurring_orders_created ?? 0} fastordre opprettet`,
                    );
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Uventet feil");
                  }
                }}
              >
                <Play className="h-4 w-4" />
                Generer {pendingRows.length} fastordre
              </Button>
            )}
            <BulkPakkseddelPDFButton
              scope={{ kind: "date_tour", date, tourId: tourParam }}
              label="Skriv ut alle"
              disabled={rows.length === 0}
            />
            <BulkPakkseddelPDFButton
              scope={{ kind: "ids", date, ids: Array.from(selected) }}
              label={`Skriv ut valgte${selected.size ? ` (${selected.size})` : ""}`}
              variant="default"
              disabled={selected.size === 0}
            />
          </div>
        </div>

        {/* Toggle-stripe */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Checkbox
              checked={allChecked || (someChecked ? "indeterminate" : false)}
              onCheckedChange={(v) => toggleAll(v === true)}
              aria-label="Velg alle"
            />
            <span>
              {selected.size > 0 ? `${selected.size} valgt` : "Velg alle"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={showLines ? "default" : "outline"}
              size="sm"
              className="gap-2"
              onClick={() => setShowLines((v) => !v)}
            >
              <ListTree className="h-4 w-4" />
              {showLines ? "Skjul linjer" : "Vis linjer"}
            </Button>
            <Button
              variant={showNotes ? "default" : "outline"}
              size="sm"
              className="gap-2"
              onClick={() => setShowNotes((v) => !v)}
            >
              <MessageSquareText className="h-4 w-4" />
              {showNotes ? "Skjul merkn." : "Vis merkn."}
            </Button>
          </div>
        </div>

        {/* Liste */}
        <div className="rounded-xl border bg-card overflow-hidden">
          {(isLoading || pendingLoading) && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">Laster…</div>
          )}

          {!isLoading && !pendingLoading && totalCount === 0 && (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              Ingen pakksedler for valgt dato/tur.
            </div>
          )}

          <ul className="divide-y divide-border">
            {pendingRows.map((p) => (
              <li
                key={`pending-${p.schedule_id}`}
                className="flex items-center gap-3 px-4 py-2.5 bg-amber-50/60 dark:bg-amber-950/20"
              >
                <div className="w-4" />
                <div className="flex-1 min-w-0 truncate text-sm">
                  <span className="text-muted-foreground italic">Ikke generert · </span>
                  <span className="font-medium">
                    {p.customer_number ? `${p.customer_number} ` : ""}
                    {p.customer_display_name}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(date)} <span className="opacity-70">({wd})</span> {p.tour_label ? tourLabelShort(p.tour_label) : "uten tur"}
                </div>
                <Badge
                  variant="outline"
                  className="font-normal bg-amber-100 text-amber-900 border-amber-200"
                >
                  Fastordre – ikke generert
                </Badge>
                <div className="w-9" />
              </li>
            ))}

            {rows.map((r) => {
              const isChecked = selected.has(r.id);
              const sv = statusVariant(r.status);
              const src = sourceBadge(r.source_kind);
              const number = customerNumberOf(r);
              const name = customerNameOf(r);
              const tour = tourLabelShort(r.route_label);

              return (
                <li key={r.id} className="group">
                  <div
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5 transition-colors cursor-pointer",
                      "hover:bg-muted/60",
                      isChecked && "bg-accent/10",
                    )}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.closest("[data-stop-row]")) return;
                      navigate(`/ordre/pakksedler/${r.id}`);
                    }}
                  >
                    <div data-stop-row onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(v) => toggleOne(r.id, v === true)}
                        aria-label={`Velg pakkseddel ${r.display_number}`}
                      />
                    </div>

                    <div className="flex-1 min-w-0 flex items-baseline gap-2 truncate">
                      {number && (
                        <span className="tabular-nums font-semibold text-foreground">
                          {number}
                        </span>
                      )}
                      <span className="font-medium text-foreground truncate">{name}</span>
                    </div>

                    <div className="hidden sm:flex items-baseline gap-2 text-sm">
                      <span className="text-emerald-700 dark:text-emerald-400 font-medium tabular-nums">
                        {formatDate(date)}

                      </span>
                      <span className="text-muted-foreground">({wd})</span>
                      <span className="text-muted-foreground">{tour}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {r.line_count} ordrelinjer
                      </span>
                    </div>

                    <Badge
                      variant="outline"
                      className={cn("font-normal whitespace-nowrap", src.cls)}
                    >
                      {src.label}
                    </Badge>

                    <Badge
                      variant="outline"
                      className={cn("hidden md:inline-flex font-normal", sv.cls)}
                    >
                      {sv.label}
                    </Badge>

                    <div data-stop-row onClick={(e) => e.stopPropagation()}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div>
                            <BulkPakkseddelPDFButton
                              scope={{ kind: "ids", date, ids: [r.id] }}
                              label=""
                              variant="ghost"
                              size="icon"
                              icon={<Printer className="h-4 w-4" />}
                              ariaLabel={`Skriv ut pakkseddel ${r.display_number}`}
                            />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>Skriv ut</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>

                  {showNotes && r.notes && (
                    <div className="px-4 pb-2 pl-12 text-xs text-muted-foreground italic">
                      {r.notes}
                    </div>
                  )}

                  {showLines && r.lines.length > 0 && (
                    <div className="px-4 pb-3 pl-12">
                      <div className="rounded-md border bg-muted/30 overflow-hidden">
                        <table className="w-full text-sm">
                          <tbody>
                            {r.lines.map((l, idx) => (
                              <tr
                                key={l.id}
                                className={cn(
                                  "border-b last:border-b-0 border-border/50",
                                  idx % 2 === 0 ? "bg-background/40" : "",
                                )}
                              >
                                <td className="w-10 px-2 py-1 tabular-nums text-muted-foreground text-right">
                                  {idx + 1}
                                </td>
                                <td className="w-14 px-2 py-1 tabular-nums text-muted-foreground">
                                  {productNumberOf(l) ?? ""}
                                </td>
                                <td className="px-2 py-1">{productNameOf(l)}</td>
                                <td className="w-16 px-2 py-1 text-right tabular-nums font-medium">
                                  {l.quantity}
                                </td>
                                <td className="w-12 px-2 py-1 text-muted-foreground">
                                  {l.sales_unit}
                                </td>
                                {showNotes && (
                                  <td className="w-1/3 px-2 py-1 text-xs text-muted-foreground italic">
                                    {l.notes ?? ""}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </TooltipProvider>
  );
}
