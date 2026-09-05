import { useMemo, useState } from "react";
import { CalendarRange, Copy, Info, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AppBanner } from "@/ordre/components/shell/AppBanner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  useDeleteRecurringSchedule,
  useDuplicateRecurringSchedule,
  useRecurringSchedules,
  type RecurringScheduleFilter,
  type RecurringScheduleWithCustomer,
} from "@/ordre/hooks/useRecurringOrders";
import { formatDateLong } from "@/ordre/lib/format";
import { RecurringScheduleDialog } from "@/ordre/components/orders/RecurringScheduleDialog";
import { isScheduleLiveNow } from "@/ordre/lib/recurringOverrides";
import { osloTodayISO } from "@/lib/osloDate";


export default function RecurringOrders() {
  const [search, setSearch] = useState("");
  const [status, setStatus] =
    useState<NonNullable<RecurringScheduleFilter["status"]>>("active");
  const filter = useMemo<RecurringScheduleFilter>(
    () => ({ search, status }),
    [search, status],
  );
  const { data: schedules = [], isLoading } = useRecurringSchedules(filter);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringScheduleWithCustomer | null>(null);
  const [deleting, setDeleting] = useState<RecurringScheduleWithCustomer | null>(null);

  const deleteSchedule = useDeleteRecurringSchedule();
  const duplicateSchedule = useDuplicateRecurringSchedule();

  async function handleDuplicate(s: RecurringScheduleWithCustomer) {
    try {
      await duplicateSchedule.mutateAsync(s.id);
      toast.success(`Kopi opprettet: «${s.name} (kopi)» — inaktiv til du aktiverer den`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke kopiere mal");
    }
  }

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(s: RecurringScheduleWithCustomer) {
    setEditing(s);
    setFormOpen(true);
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await deleteSchedule.mutateAsync(deleting.id);
      toast.success("Fastordre slettet");
      setDeleting(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke slette");
    }
  }

  return (
    <>
      <AppBanner
        title="Fastordre"
        subtitle="Ukentlige maler — beskriver hva en kunde normalt mottar"
        icon={CalendarRange}
        actions={
          <Button onClick={openNew} size="sm" className="gap-2">
            <Plus className="h-4 w-4" /> Ny fastordre
          </Button>
        }
      />

      <div className="container mx-auto space-y-4 px-4 py-6 sm:px-6">
        <Card className="flex flex-wrap items-start gap-2 border-l-4 border-l-primary/50 p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="flex-1 text-muted-foreground">
            Fastordre er maler. De blir til faktiske ordre først når pakksedler kjøres for
            en dato — endringer her påvirker bare leveringer som ennå ikke er kjørt.{" "}
            <Link to="/ordre/pakksedler" className="font-medium text-primary underline-offset-2 hover:underline">
              Gå til pakksedler
            </Link>
          </p>
        </Card>

        <Card className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Søk kunde, nummer eller navn …"
              className="pl-8"
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Aktive</SelectItem>
              <SelectItem value="inactive">Inaktive</SelectItem>
              <SelectItem value="all">Alle</SelectItem>
            </SelectContent>
          </Select>
        </Card>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Kunde</TableHead>
                <TableHead>Navn</TableHead>
                <TableHead className="text-right w-24">Linjer</TableHead>
                <TableHead>Gyldig</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-24 text-right">Handlinger</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : schedules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-16 text-center">
                    <div className="mx-auto max-w-md space-y-2">
                      <CalendarRange className="mx-auto h-10 w-10 text-muted-foreground/40" />
                      <div className="text-sm font-medium">Ingen fastordre ennå</div>
                      <p className="text-xs text-muted-foreground">
                        Fastordre er ukentlige maler som beskriver hva en kunde normalt
                        mottar. Malen blir automatisk til faktiske ordre i matrisen og på
                        pakksedlene for hver leveringsdag.
                      </p>
                      <Button onClick={openNew} size="sm" className="gap-1.5">
                        <Plus className="h-3.5 w-3.5" /> Opprett din første fastordre
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                schedules.map((s, idx) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer hover:bg-accent/40"
                    onClick={() => openEdit(s)}
                  >
                    <TableCell className="text-xs text-muted-foreground">
                      {idx + 1}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{s.customer_display_name}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {s.customer_number}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{s.name}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {s.item_count}
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.valid_from || s.valid_to ? (
                        <>
                          {s.valid_from ? formatDateLong(s.valid_from) : "Ingen start"}
                          {" — "}
                          {s.valid_to ? formatDateLong(s.valid_to) : "Ingen slutt"}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Alltid gyldig</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.is_active ? (
                        isScheduleLiveNow(s, TODAY_ISO) ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success"
                            title="Aktiv i dag — gjeldende mal for kunden"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-success" />
                            Aktiv nå
                          </span>
                        ) : (
                          <span
                            className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                            title="Aktivert, men utenfor gyldighetsperioden"
                          >
                            Planlagt
                          </span>
                        )
                      ) : (
                        <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          Inaktiv
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(s)}
                        className="h-7 w-7 p-0"
                        aria-label="Rediger"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDuplicate(s)}
                        disabled={duplicateSchedule.isPending}
                        className="h-7 w-7 p-0"
                        aria-label="Kopier som ny mal"
                        title="Kopier som ny mal"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleting(s)}
                        className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                        aria-label="Slett"
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

      <RecurringScheduleDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        onSaved={() => {
          /* invalidation skjer i hook */
        }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Slett fastordre for «{deleting?.customer_display_name}»?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Dette fjerner malen og alle linjene permanent. Eksisterende faktiske
              ordre påvirkes ikke. Vurder å deaktivere i stedet for å bevare
              historikk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSchedule.isPending}>
              Avbryt
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteSchedule.isPending}
            >
              {deleteSchedule.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Slett
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
