import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { showError } from "@/lib/userError";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatNOK, formatNumber } from "@/ordre/lib/format";
import {
  useApproveReturn,
  useRejectReturn,
  useReturnNoteLines,
  type ReturnNoteRow,
} from "@/ordre/hooks/useReturnDeliveryNotes";

function lineTotal(qty: number, unitPrice: number, vatRate: number) {
  return qty * unitPrice * (1 + (vatRate ?? 0) / 100);
}

export function ApproveReturnDialog({
  note,
  open,
  onOpenChange,
}: {
  note: ReturnNoteRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: lines, isLoading } = useReturnNoteLines(open ? note?.id : undefined);
  const approve = useApproveReturn();
  const reject = useRejectReturn();

  const [received, setReceived] = useState<Record<string, string>>({});
  const [noteText, setNoteText] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNoteText("");
    setRejectOpen(false);
    setReason("");
    setErrorText(null);
  }, [open, note?.id]);

  useEffect(() => {
    if (!lines) return;
    setReceived(
      Object.fromEntries(
        lines.map((l) => [l.id, String(l.received_quantity ?? l.quantity)]),
      ),
    );
  }, [lines]);

  useEffect(() => {
    if (errorText) {
      toast.error(errorText);
      setErrorText(null);
    }
  }, [errorText]);

  useEffect(() => {
    if (successText) {
      toast.success(successText);
      setSuccessText(null);
    }
  }, [successText]);

  const qtyOf = (id: string, fallback: number) => {
    const raw = received[id];
    if (raw === undefined || raw === "") return 0;
    const n = Number(raw.replace(",", "."));
    return Number.isNaN(n) ? 0 : n;
  };

  const totals = useMemo(() => {
    let reported = 0;
    let approved = 0;
    for (const l of lines ?? []) {
      reported += lineTotal(l.quantity, l.unit_price, l.vat_rate);
      approved += lineTotal(qtyOf(l.id, l.quantity), l.unit_price, l.vat_rate);
    }
    return { reported, approved, diff: approved - reported };
  }, [lines, received]);

  const setQty = (id: string, value: string, max: number) => {
    const n = Number(value.replace(",", "."));
    if (value !== "" && !Number.isNaN(n)) {
      if (n < 0) value = "0";
      else if (n > max) value = String(max);
    }
    setReceived((prev) => ({ ...prev, [id]: value }));
  };

  const handleApprove = async () => {
    if (!note || !lines) return;
    try {
      const res = await approve.mutateAsync({
        noteId: note.id,
        lines: lines.map((l) => ({
          line_id: l.id,
          received_quantity: qtyOf(l.id, l.quantity),
        })),
        note: noteText,
      });
      const sum = Number(res.total_incl_vat ?? totals.approved);
      setSuccessText(
        `Retur godkjent — ${formatNumber(sum, 2)} kr blir trukket fra ved neste fakturering`,
      );
      onOpenChange(false);
    } catch (e) {
      showError("approve-return", e, "Kunne ikke godkjenne returen. Prøv igjen.");
    }
  };

  const handleReject = async () => {
    if (!note) return;
    if (!reason.trim()) {
      setErrorText("Begrunnelse er påkrevd for å avvise returen");
      return;
    }
    try {
      await reject.mutateAsync({ noteId: note.id, reason: reason.trim() });
      setSuccessText("Retur avvist");
      onOpenChange(false);
    } catch (e) {
      showError("reject-return", e, "Kunne ikke avvise returen. Prøv igjen.");
    }
  };

  const busy = approve.isPending || reject.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {note?.customer_name} · Retur {note?.display_number}
          </DialogTitle>
          <DialogDescription>
            {formatDate(note?.delivery_date)}
            {note?.notes ? ` · ${note.notes}` : ""}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <div className="max-h-[45vh] overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vare</TableHead>
                  <TableHead className="text-right">Meldt retur</TableHead>
                  <TableHead className="w-[190px] text-right">Mottatt</TableHead>
                  <TableHead className="text-right">Returpris</TableHead>
                  <TableHead className="text-right">Sum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(lines ?? []).map((l) => {
                  const q = qtyOf(l.id, l.quantity);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium">{l.product_name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(l.quantity, 0)} {l.sales_unit}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Input
                            type="number"
                            min={0}
                            max={l.quantity}
                            value={received[l.id] ?? ""}
                            onChange={(e) => setQty(l.id, e.target.value, l.quantity)}
                            className="h-8 w-20 text-right tabular-nums"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2"
                            onClick={() => setQty(l.id, String(l.quantity), l.quantity)}
                          >
                            Alt
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2"
                            onClick={() => setQty(l.id, "0", l.quantity)}
                          >
                            Ingen
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNOK(l.unit_price)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNOK(lineTotal(q, l.unit_price, l.vat_rate))}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {Math.abs(totals.diff) > 0.005
              ? `Meldt ${formatNumber(totals.reported, 2)} · Godkjennes ${formatNumber(
                  totals.approved,
                  2,
                )} · Avvik ${totals.diff > 0 ? "+" : "−"}${formatNumber(
                  Math.abs(totals.diff),
                  2,
                )}`
              : "Godkjennes som meldt"}
          </span>
          <span className="text-base font-semibold tabular-nums">
            Totalt {formatNOK(totals.approved)}
          </span>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="return-note">Notat</Label>
          <Textarea
            id="return-note"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Valgfritt notat om kontrollen av returen"
            rows={2}
          />
        </div>

        {rejectOpen && (
          <>
            <Separator />
            <div className="space-y-1.5">
              <Label htmlFor="reject-reason">Begrunnelse for avvisning (påkrevd)</Label>
              <Textarea
                id="reject-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Hvorfor avvises returen?"
                rows={2}
              />
            </div>
          </>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {rejectOpen ? (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setRejectOpen(false)} disabled={busy}>
                Angre
              </Button>
              <Button variant="destructive" onClick={handleReject} disabled={busy}>
                {reject.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Bekreft avvisning
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setRejectOpen(true)} disabled={busy}>
              Avvis
            </Button>
          )}
          <Button onClick={handleApprove} disabled={busy || isLoading}>
            {approve.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Godkjenn retur
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
