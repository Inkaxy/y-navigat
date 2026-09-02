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
import { useGenerateDeliveryNotes } from "@/ordre/hooks/useGenerateDeliveryNotes";
import {
  usePendingOrdersList,
  type PendingOrderType,
} from "@/ordre/hooks/usePendingOrdersList";
import { formatDate, formatNOK, todayISO } from "@/ordre/lib/format";
import { cn } from "@/lib/utils";
import { BulkPakkseddelPDFButton } from "@/ordre/components/pakksedler/BulkPakkseddelPDFButton";
import { UnfinalizeButton } from "@/ordre/components/pakksedler/UnfinalizeButton";
import { PendingOrderRowActions } from "@/ordre/components/pakksedler/PendingOrderRowActions";
import { NULL_TOUR_KEY } from "@/ordre/hooks/useTourRunStatus";

type ListType = "pakksedler" | PendingOrderType;

const TYPE_LABEL: Record<ListType, string> = {
  pakksedler: "pakksedler",
  fast: "fastordre",
  datert: "daterte ordre",
  ekstra: "ekstraordre",
  retur: "returordre",
};

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
  const mode: "date" | "correction" =
    params.get("mode") === "correction" ? "correction" : "date";
  const typeParam = (params.get("type") as ListType | null) ?? "pakksedler";
  const type: ListType =
    typeParam === "fast" || typeParam === "datert" || typeParam === "ekstra" || typeParam === "retur"
      ? typeParam
      : "pakksedler";

  const { data: tours = [] } = useDeliveryTours({ activeOnly: true });
  const { data: rows = [], isLoading } = useDeliveryNotesList(date, tourParam, mode);
  const { data: pending = [], isLoading: pendingLoading } = usePendingOrdersList(
    date,
    tourParam,
    type === "pakksedler" ? "fast" : type,
    mode,
  );
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

  // Når type=pakksedler viser vi kun de genererte pakksedlene.
  // Når type=fast/datert/retur viser vi pending-listen for den typen.
  const isPending = type !== "pakksedler";
  const totalCount = isPending ? pending.length : rows.length;
  const loading = isPending ? pendingLoading : isLoading;
  const allChecked = !isPending && rows.length > 0 && selected.size === rows.length;
  const someChecked = !isPending && selected.size > 0 && selected.size < rows.length;

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


  const tourFilter =
    tourParam === "all" || tourParam === NULL_TOUR_KEY ? null : [tourParam];

  async function runGenerate(runType: "main" | "additional" = "main") {
    try {
      if (mode === "correction") {
        // Iterér over unike leveringsdatoer for pending-radene.
        const uniqueDates = Array.from(
          new Set(pending.map((p) => p.delivery_date).filter((d): d is string => !!d)),
        ).sort();
        if (uniqueDates.length === 0) {
          toast.info("Ingen ordre å generere pakksedler for");
          return;
        }
        let totalNotes = 0;
        let totalLines = 0;
        for (const d of uniqueDates) {
          const r = await generate.mutateAsync({ date: d, tourFilter, runType });
          totalNotes += r.notes_generated;
          totalLines += r.lines_generated;
        }
        toast.success(
          `Genererte ${totalNotes} pakksedler (${totalLines} linjer) over ${uniqueDates.length} dato${uniqueDates.length === 1 ? "" : "er"}`,
        );
        return;
      }
      const result = await generate.mutateAsync({ date, tourFilter, runType });
      toast.success(
        `Genererte ${result.notes_generated} pakksedler (${result.lines_generated} linjer)` +
          (result.recurring_orders_created
            ? ` · ${result.recurring_orders_created} fastordre opprettet`
            : ""),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Uventet feil");
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 space-y-4">
        {/* Tittel-stripe */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/ordre/pakksedler${mode === "correction" ? "?mode=correction" : ""}`)} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Tilbake
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            {mode === "correction" ? `T.o.m. ${formatDate(date)}` : formatDate(date)} ({tourLabel}), {TYPE_LABEL[type]}
          </h1>
          <Badge
            variant="outline"
            className="ml-2 bg-brand-ink text-brand-cream border-brand-ink"
          >
            {totalCount} treff
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            {isPending && totalCount > 0 && (
              <Button
                variant="brand"
                size="sm"
                className="gap-2"
                disabled={generate.isPending}
                onClick={() => runGenerate(type === "fast" ? "main" : "additional")}
              >
                <Play className="h-4 w-4" />
                Generer pakksedler ({totalCount})
              </Button>
            )}
            {!isPending && (() => {
              const printableRows = rows.filter((r) => r.status !== "draft");
              const printableSelected = Array.from(selected).filter((id) =>
                printableRows.some((r) => r.id === id),
              );
              const selectedFinalizedIds = Array.from(selected).filter((id) =>
                rows.some((r) => r.id === id && r.status === "finalized"),
              );
              return (
                <>
                  <UnfinalizeButton
                    ids={selectedFinalizedIds}
                    label="Tilbakekjør valgte"
                    disabled={selectedFinalizedIds.length === 0}
                  />
                  <BulkPakkseddelPDFButton
                    scope={{ kind: "ids", date, ids: printableRows.map((r) => r.id) }}
                    label="Skriv ut alle ferdige"
                    disabled={printableRows.length === 0}
                  />
                  <BulkPakkseddelPDFButton
                    scope={{ kind: "ids", date, ids: printableSelected }}
                    label={`Skriv ut valgte${printableSelected.length ? ` (${printableSelected.length})` : ""}`}
                    variant="default"
                    disabled={printableSelected.length === 0}
                  />
                </>
              );
            })()}
          </div>
        </div>

        {/* Toggle-stripe (kun for pakksedler) */}
        {!isPending && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Checkbox
                checked={allChecked || (someChecked ? "indeterminate" : false)}
                onCheckedChange={(v) => toggleAll(v === true)}
                aria-label="Velg alle"
              />
              <span>{selected.size > 0 ? `${selected.size} valgt` : "Velg alle"}</span>
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
        )}

        {/* Liste */}
        <div className="rounded-xl border bg-card overflow-hidden">
          {loading && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">Laster…</div>
          )}

          {!loading && totalCount === 0 && (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              Ingen {TYPE_LABEL[type]} for valgt dato/tur.
            </div>
          )}

          <ul className="divide-y divide-border">
            {isPending &&
              pending.map((p) => (
                <li
                  key={`${p.kind}-${p.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/60 cursor-pointer"
                  onClick={() => {
                    if (p.kind === "order") navigate(`/ordre/ordrer/${p.id}`);
                  }}
                >
                  <div className="flex-1 min-w-0 flex items-baseline gap-2 truncate">
                    {p.customer_number && (
                      <span className="tabular-nums font-semibold">{p.customer_number}</span>
                    )}
                    <span className="font-medium truncate">{p.customer_display_name}</span>
                  </div>
                  <div className="hidden sm:flex items-baseline gap-2 text-sm">
                    <span className="text-emerald-700 dark:text-emerald-400 font-medium tabular-nums">
                      {formatDate(p.delivery_date ?? date)}
                    </span>
                    <span className="text-muted-foreground">({weekdayShort(p.delivery_date ?? date)})</span>
                    <span className="text-muted-foreground">
                      {p.tour_label ? tourLabelShort(p.tour_label) : "uten tur"}
                    </span>
                    {p.kind === "order" ? (
                      <span className="text-muted-foreground tabular-nums">
                        {p.line_count} ordrelinjer
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic">fastordre-mal</span>
                    )}
                  </div>
                  {p.kind === "order" && p.total_incl_vat > 0 && (
                    <span className="hidden md:inline text-sm tabular-nums text-muted-foreground">
                      {formatNOK(p.total_incl_vat)}
                    </span>
                  )}
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-normal whitespace-nowrap",
                      p.kind === "schedule"
                        ? "bg-amber-100 text-amber-900 border-amber-200"
                        : "bg-muted text-foreground border-border",
                    )}
                  >
                    {p.kind === "schedule" ? "Ikke generert" : "Klar for pakkseddel"}
                  </Badge>
                  <div onClick={(e) => e.stopPropagation()}>
                    <PendingOrderRowActions row={p} />
                  </div>
                </li>
              ))}

            {!isPending &&
              rows.map((r) => {
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
                          {formatDate(r.delivery_date ?? date)}
                        </span>
                        <span className="text-muted-foreground">({weekdayShort(r.delivery_date ?? date)})</span>
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

                      {r.status !== "draft" && (
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
                      )}
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

