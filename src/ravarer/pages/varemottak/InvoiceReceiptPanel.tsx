import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { QueryState } from "@/components/common/QueryState";
import { PackageEditor } from "@/ravarer/editors/PackageEditor";
import { useReceiptLines, useReceiveInvoiceLine, type ReceiptLine } from "@/ravarer/hooks/useGoodsReceipt";
import { formatDate, formatNumber } from "@/ravarer/lib/constants";
import { paths } from "@/ravarer/lib/paths";
import { movementLabel, receiptState, validateBestBefore, validateLotNumber } from "@/ravarer/lib/receiptStatus";
import { DeviationDialog, receiptLineAsWorklistRow } from "./ReceiptDeviation";

/** Mottaksarket for én faktura (`?valgt=<fakturaId>`). Linjer vises som kort, også på mobil. */
export function InvoiceReceiptPanel({
  invoiceId,
  invoiceNumber,
  onClose,
  canWrite,
}: {
  invoiceId: string | null;
  invoiceNumber: string;
  onClose: () => void;
  canWrite: boolean;
}) {
  const linesQuery = useReceiptLines(invoiceId ?? undefined);
  const lines = useMemo(() => linesQuery.data ?? [], [linesQuery.data]);
  const [deviationLine, setDeviationLine] = useState<ReceiptLine | null>(null);
  const [packageLine, setPackageLine] = useState<ReceiptLine | null>(null);
  const [rematching, setRematching] = useState(false);
  const qc = useQueryClient();

  /** Kun etter bekreftet pakningsendring: regn om akkurat denne linja. */
  const rematchLine = async (line: ReceiptLine) => {
    if (!invoiceId) return;
    setRematching(true);
    try {
      const { error } = await supabase.functions.invoke("match-invoice-lines", { body: { invoice_id: invoiceId, line_ids: [line.id] } });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["receipt-lines", invoiceId] });
      toast.success("Linja er regnet om på nytt");
    } catch (e) {
      console.warn("[varemottak] omregning feilet", e);
      toast.error("Kunne ikke regne om linja. Prøv igjen.");
    } finally {
      setRematching(false);
    }
  };

  return (
    <>
      <Dialog open={!!invoiceId} onOpenChange={v => !v && onClose()}>
        <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col gap-0 p-0">
          <DialogHeader className="border-b border-line-subtle p-4">
            <DialogTitle>Mottak — faktura {invoiceNumber}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {linesQuery.isLoading || linesQuery.isError ? (
              <QueryState scope="ravarer:varemottak-linjer" isLoading={linesQuery.isLoading} isError={linesQuery.isError} error={linesQuery.error} onRetry={() => void linesQuery.refetch()} />
            ) : lines.length === 0 ? (
              <p className="text-sm text-ink-secondary">Fakturaen har ingen linjer.</p>
            ) : (
              <ul className="space-y-3" aria-label="Fakturalinjer">
                {lines.map(l => (
                  <ReceiptLineCard
                    key={l.id}
                    line={l}
                    invoiceId={invoiceId as string}
                    invoiceNumber={invoiceNumber}
                    canWrite={canWrite}
                    busy={rematching}
                    onDeviation={() => setDeviationLine(l)}
                    onPackage={() => setPackageLine(l)}
                  />
                ))}
              </ul>
            )}
          </div>
          <DialogFooter className="border-t border-line-subtle p-4">
            <Button variant="outline" className="min-h-[44px]" onClick={onClose}>Lukk</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeviationDialog line={deviationLine} invoiceNumber={invoiceNumber} onClose={() => setDeviationLine(null)} />
      <PackageEditor
        open={!!packageLine}
        row={packageLine ? receiptLineAsWorklistRow(packageLine) : null}
        onOpenChange={v => {
          if (!v) setPackageLine(null);
        }}
        onApplied={() => {
          // Rematch bare når pakningen faktisk ble lagret, aldri ved avbrutt dialog.
          const line = packageLine;
          if (line) void rematchLine(line);
        }}
      />
    </>
  );
}

function ReceiptLineCard({
  line,
  invoiceId,
  invoiceNumber,
  canWrite,
  busy,
  onDeviation,
  onPackage,
}: {
  line: ReceiptLine;
  invoiceId: string;
  invoiceNumber: string;
  canWrite: boolean;
  busy: boolean;
  onDeviation: () => void;
  onPackage: () => void;
}) {
  const receive = useReceiveInvoiceLine();
  const sending = useRef(false);
  const [lot, setLot] = useState("");
  const [bestBefore, setBestBefore] = useState("");
  const state = receiptState(line);
  const lotCheck = validateLotNumber(lot);
  const dateCheck = validateBestBefore(bestBefore);
  const id = `rl-${line.id}`;

  const confirm = () => {
    if (sending.current || state.kind !== "receivable" || !lotCheck.ok || !dateCheck.ok || !line.raw_material_id) return;
    sending.current = true;
    // Linje, parti og dato fryses i dette kallet; serveren bestemmer mengden.
    receive.mutate(
      {
        invoice_line_id: line.id,
        invoice_id: invoiceId,
        raw_material_id: line.raw_material_id,
        invoice_number: invoiceNumber,
        lot_number: state.credit ? null : lotCheck.value,
        best_before: state.credit ? null : dateCheck.value,
      },
      { onSettled: () => { sending.current = false; } },
    );
  };

  return (
    <li className="rounded-lg border border-line-subtle p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium">{line.raw_material_name ?? line.description ?? "Uten beskrivelse"}</p>
          {line.raw_material_name && line.description && <p className="break-words text-xs text-ink-secondary">{line.description}</p>}
          <p className="mt-1 text-sm tabular-nums">
            Fakturert {formatNumber(line.quantity, 2)} {line.unit ?? ""}
            {line.base_quantity != null && <span className="text-ink-secondary"> · {formatNumber(line.base_quantity, 2)} {line.base_unit}</span>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <StateBadge line={line} />
          {line.stock_tracking && <span className="text-xs text-ink-secondary">{movementLabel(line.movement)}</span>}
        </div>
      </div>

      {state.kind === "receivable" && canWrite && (
        <div className="mt-3 space-y-3 border-t border-line-subtle pt-3">
          {!state.credit && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor={`${id}-lot`} className="text-xs">Partinummer (valgfritt)</Label>
                <Input id={`${id}-lot`} value={lot} onChange={e => setLot(e.target.value)} className="h-[44px]" aria-invalid={!lotCheck.ok} />
                {!lotCheck.ok && <p className="mt-1 text-xs text-destructive">{lotCheck.message}</p>}
              </div>
              <div>
                <Label htmlFor={`${id}-bf`} className="text-xs">Best før (valgfritt)</Label>
                <Input id={`${id}-bf`} type="date" value={bestBefore} onChange={e => setBestBefore(e.target.value)} className="h-[44px]" aria-invalid={!dateCheck.ok} />
                {!dateCheck.ok && <p className="mt-1 text-xs text-destructive">{dateCheck.message}</p>}
              </div>
            </div>
          )}
          <p className="text-xs text-ink-secondary">
            {state.credit
              ? `Kreditnota: ${formatNumber(Math.abs(state.quantity), 2)} ${line.base_unit ?? ""} føres ut som retur.`
              : `Mottas som ${formatNumber(state.quantity, 2)} ${line.base_unit ?? ""}.`}
            {state.hasMovement === true && " Lagerbevegelsen finnes allerede; mottaket knyttes til den uten ny bevegelse."}
            {state.hasMovement === null && " Lagerbevegelse er ukjent — serveren kontrollerer og fører aldri dobbelt."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-[44px] flex-1 sm:flex-none" disabled={receive.isPending || !lotCheck.ok || !dateCheck.ok} onClick={confirm}>
              {receive.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              {state.credit ? "Bekreft retur" : "Bekreft mottak"}
            </Button>
            <Button variant="outline" className="min-h-[44px]" onClick={onDeviation}>Avvik</Button>
          </div>
        </div>
      )}
      {state.kind === "confirmed" && canWrite && (
        <div className="mt-3 flex justify-end">
          <Button variant="outline" className="min-h-[44px]" onClick={onDeviation}>Avvik</Button>
        </div>
      )}
      {state.kind === "needs_quantity" && canWrite && (
        <div className="mt-3 space-y-2 border-t border-line-subtle pt-3 text-xs text-ink-secondary">
          <p>Mengden kan ikke regnes om til {line.base_unit ?? "baseenheten"}. Bekreft pakning eller enhet først.</p>
          <Button variant="outline" className="min-h-[44px]" disabled={busy} onClick={onPackage}>Sett pakning</Button>
        </div>
      )}
      {state.kind === "review" && (
        <p className="mt-2 text-xs text-ink-secondary">
          Linja venter på kontroll i Priskontroll før den kan mottas.{" "}
          <Link className="text-primary underline-offset-2 hover:underline" to={paths.faktura(invoiceId, { linje: line.id })}>Åpne linja</Link>
        </p>
      )}
    </li>
  );
}

function StateBadge({ line }: { line: ReceiptLine }) {
  const s = receiptState(line);
  switch (s.kind) {
    case "confirmed":
      return (
        <Badge variant="outline" className="text-success">
          <Check className="mr-1 h-3 w-3" aria-hidden />
          {s.credit ? "Retur bekreftet" : "Mottatt"} {formatDate(s.receipt.received_at)}
        </Badge>
      );
    case "receivable":
      return <Badge variant="outline" className="text-ink-secondary">Ikke bekreftet mottatt</Badge>;
    case "untracked":
      return <Badge variant="outline" className="text-ink-secondary">Ikke lagerført</Badge>;
    case "unlinked":
      return <Badge variant="outline" className="text-ink-secondary">Ikke koblet til vare</Badge>;
    case "not_applicable":
      return <Badge variant="outline" className="text-ink-secondary">Ikke vare</Badge>;
    case "review":
      return <Badge variant="outline" className="border-warning/50 text-warning">Venter på kontroll</Badge>;
    case "needs_quantity":
      return <Badge variant="outline" className="border-warning/50 text-warning">Mangler omregning</Badge>;
    case "unknown":
      return <Badge variant="outline" className="border-warning/50 text-warning">Mottaksstatus ukjent</Badge>;
  }
}
