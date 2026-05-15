import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDeliveryNotesList } from "@/ordre/hooks/useDeliveryNotesList";
import { useDeliveryTours } from "@/ordre/hooks/useDeliveryTours";
import { usePendingRecurringOrderRows } from "@/ordre/hooks/usePendingRecurringOrders";
import { useGenerateDeliveryNotes } from "@/ordre/hooks/useGenerateDeliveryNotes";
import { formatDate, formatNOK, todayISO } from "@/ordre/lib/format";
import { cn } from "@/lib/utils";
import { BulkPakkseddelPDFButton } from "@/ordre/components/pakksedler/BulkPakkseddelPDFButton";
import { NULL_TOUR_KEY } from "@/ordre/hooks/useTourRunStatus";

function statusVariant(status: string): { label: string; cls: string } {
  switch (status) {
    case "draft":
      return { label: "Draft", cls: "bg-muted text-foreground" };
    case "printed":
      return { label: "Skrevet ut", cls: "bg-blue-100 text-blue-900" };
    case "delivered":
      return { label: "Levert", cls: "bg-emerald-100 text-emerald-900" };
    case "under_correction":
      return { label: "Korrigeres", cls: "bg-amber-100 text-amber-900" };
    case "finalized":
      return { label: "Finalisert", cls: "bg-emerald-200 text-emerald-950" };
    case "invoiced":
      return { label: "Fakturert", cls: "bg-purple-200 text-purple-950" };
    case "cancelled":
      return { label: "Kansellert", cls: "bg-destructive/15 text-destructive" };
    default:
      return { label: status, cls: "bg-muted text-foreground" };
  }
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

  const tourLabel = useMemo(() => {
    if (tourParam === "all") return "Alle turer";
    if (tourParam === NULL_TOUR_KEY) return "Uten tur";
    const t = tours.find((x) => x.id === tourParam);
    return t ? `Tur ${t.tour_number} ${t.display_name}` : "Valgt tur";
  }, [tourParam, tours]);

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

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Tilbake
        </Button>
        <h1 className="text-xl font-semibold">
          Pakksedler — {formatDate(date)} — {tourLabel}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <BulkPakkseddelPDFButton
            scope={{ kind: "date_tour", date, tourId: tourParam }}
            label="Skriv ut alle i listen"
            disabled={rows.length === 0}
          />
          <BulkPakkseddelPDFButton
            scope={{ kind: "ids", date, ids: Array.from(selected) }}
            label="Skriv ut valgte"
            variant="default"
            disabled={selected.size === 0}
          />
        </div>
      </div>

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allChecked || (someChecked ? "indeterminate" : false)}
                  onCheckedChange={(v) => toggleAll(v === true)}
                  aria-label="Velg alle"
                />
              </TableHead>
              <TableHead>Nr</TableHead>
              <TableHead>Kunde</TableHead>
              <TableHead>Tur</TableHead>
              <TableHead className="text-right">Linjer</TableHead>
              <TableHead className="text-right">Sum</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Laster…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Ingen pakksedler for valgt dato/tur.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const sv = statusVariant(r.status);
              const customerName =
                (r.customer_snapshot?.["display_name"] as string | undefined) ??
                (r.customer_snapshot?.["name"] as string | undefined) ??
                "—";
              const isChecked = selected.has(r.id);
              return (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    // ikke naviger hvis brukeren klikker checkboks-cellen
                    const target = e.target as HTMLElement;
                    if (target.closest("[data-row-checkbox]")) return;
                    navigate(`/ordre/pakksedler/${r.id}`);
                  }}
                >
                  <TableCell data-row-checkbox onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={(v) => toggleOne(r.id, v === true)}
                      aria-label={`Velg pakkseddel ${r.display_number}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium tabular-nums">{r.display_number}</TableCell>
                  <TableCell>{customerName}</TableCell>
                  <TableCell>{r.route_label ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.line_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNOK(r.total_incl_vat)}</TableCell>
                  <TableCell>
                    <Badge className={cn("font-normal", sv.cls)} variant="outline">
                      {sv.label}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
