import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, Truck } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppBanner } from "@/components/shell/AppBanner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/lib/constants";
import { todayISO } from "@/lib/format";
import { logAudit } from "@/lib/audit";
import {
  DAY_LABELS,
  trimSec,
  useDeliveryTours,
  useTourOrderCounts,
  sortToursByPriority,
  type DeliveryTour,
} from "@/hooks/useDeliveryTours";
import { TourFormDialog } from "@/components/orders/TourFormDialog";

const DAY_FIELDS = [
  "active_monday",
  "active_tuesday",
  "active_wednesday",
  "active_thursday",
  "active_friday",
  "active_saturday",
  "active_sunday",
] as const;

function ActiveDays({ tour }: { tour: DeliveryTour }) {
  return (
    <div className="flex gap-1 text-xs">
      {DAY_LABELS.map((label, i) => (
        <span
          key={label}
          className={
            tour[DAY_FIELDS[i]]
              ? "font-semibold text-foreground"
              : "text-muted-foreground/40 line-through"
          }
        >
          {label}
        </span>
      ))}
    </div>
  );
}

/** Sjekk hvor mange ordrer som refererer en tur (alle datoer) */
function useTourUsageCount(tourId: string | null) {
  return useQuery({
    queryKey: ["tour-usage", tourId],
    enabled: !!tourId,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("delivery_tour_id", tourId!);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export default function Tours() {
  const qc = useQueryClient();
  const today = todayISO();
  const { data: toursRaw = [], isLoading } = useDeliveryTours();
  const tours = useMemo(() => sortToursByPriority(toursRaw), [toursRaw]);
  const { data: countsData } = useTourOrderCounts(today);
  const countsMap = countsData?.byTour ?? {};

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DeliveryTour | null>(null);
  const [deleting, setDeleting] = useState<DeliveryTour | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const { data: deleteUsage } = useTourUsageCount(deleting?.id ?? null);

  const nextTourNumber = useMemo(
    () => (tours.length ? Math.max(...tours.map((t) => t.tour_number)) + 1 : 1),
    [tours],
  );

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(t: DeliveryTour) {
    setEditing(t);
    setFormOpen(true);
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const usage = deleteUsage ?? 0;
      if (usage > 0) {
        // Deaktiver i stedet for å slette
        const { error } = await supabase
          .from("delivery_tours")
          .update({ status: "inactive" })
          .eq("id", deleting.id);
        if (error) throw error;
        await logAudit({
          action: "updated",
          entity_type: "delivery_tour",
          entity_id: deleting.id,
          entity_display_reference: `${deleting.tour_number} — ${deleting.display_name}`,
          legal_entity_id: NB_LEGAL_ENTITY_ID,
          changes: { status: "inactive", reason: "deactivated_due_to_usage", referenced_by_orders: usage },
        });
        toast.info(
          `Turen brukes av ${usage} ordrer og kan ikke slettes. Den er nå deaktivert.`,
        );
      } else {
        const { error } = await supabase.from("delivery_tours").delete().eq("id", deleting.id);
        if (error) throw error;
        await logAudit({
          action: "deleted",
          entity_type: "delivery_tour",
          entity_id: deleting.id,
          entity_display_reference: `${deleting.tour_number} — ${deleting.display_name}`,
          legal_entity_id: NB_LEGAL_ENTITY_ID,
        });
        toast.success(`Tur ${deleting.tour_number} slettet`);
      }
      setDeleting(null);
      await qc.invalidateQueries({ queryKey: ["delivery-tours"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke slette tur");
    } finally {
      setDeleteBusy(false);
    }
  }

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["delivery-tours"] });
  }

  return (
    <>
      <AppBanner
        title="Turer"
        subtitle="Leveringsrutiner for Nøtterø Bakeri AS"
        icon={Truck}
        actions={
          <Button onClick={openNew} size="sm" className="gap-2">
            <Plus className="h-4 w-4" /> Ny tur
          </Button>
        }
      />

      <div className="container mx-auto space-y-4 px-4 py-6 sm:px-6">
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Nr</TableHead>
                <TableHead>Navn</TableHead>
                <TableHead>Sjåfør</TableHead>
                <TableHead>Avgangstid</TableHead>
                <TableHead>Tidsvindu</TableHead>
                <TableHead>Aktive dager</TableHead>
                <TableHead className="text-right">Ordrer i dag</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32 text-right">Handlinger</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : tours.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                    Ingen turer registrert. Opprett den første turen.
                  </TableCell>
                </TableRow>
              ) : (
                tours.map((t) => (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer hover:bg-accent/40"
                    onClick={() => openEdit(t)}
                  >
                    <TableCell className="font-mono">{t.tour_number}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        {t.display_name}
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          P{t.priority}
                        </span>
                      </div>
                      {t.description && (
                        <div className="text-xs text-muted-foreground">{t.description}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{t.driver_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {t.departure_time ? trimSec(t.departure_time) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {trimSec(t.time_from)} – {trimSec(t.time_to)}
                    </TableCell>
                    <TableCell>
                      <ActiveDays tour={t} />
                    </TableCell>
                    <TableCell className="text-right">{countsMap[t.id] ?? 0}</TableCell>
                    <TableCell>
                      {t.status === "active" ? (
                        <span className="inline-flex rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                          Aktiv
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          Inaktiv
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(t)}
                        className="h-7 w-7 p-0"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleting(t)}
                        className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <TourFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        tour={editing}
        nextTourNumber={nextTourNumber}
        onSaved={refresh}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Slett tur {deleting?.tour_number} — {deleting?.display_name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteUsage && deleteUsage > 0
                ? `Denne turen brukes av ${deleteUsage} ordrer og kan ikke slettes. Den blir i stedet deaktivert og vil ikke lenger brukes for nye auto-tildelinger.`
                : "Turen slettes permanent. Dette kan ikke angres."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteBusy}>
              {deleteBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {deleteUsage && deleteUsage > 0 ? "Deaktiver" : "Slett"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
