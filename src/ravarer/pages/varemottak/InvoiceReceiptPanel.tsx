import { useEffect, useMemo, useRef, useState } from "react";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { ReceiveOutcomeUnknownError } from "@/ravarer/lib/receiptStatus";
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
  fixture,
}: {
  invoiceId: string | null;
  invoiceNumber: string;
  onClose: () => void;
  canWrite: boolean;
  /** Bare skrivebeskyttet forhåndsvisning: faste linjer, ingen nettverk; handlinger rapporteres via `onAction`. */
  fixture?: { lines: ReceiptLine[]; onAction: (message: string) => void };
}) {
  const linesQuery = useReceiptLines(fixture ? undefined : invoiceId ?? undefined);
  const lines = useMemo(() => fixture?.lines ?? linesQuery.data ?? [], [fixture, linesQuery.data]);
  const { legalEntityId } = useRavarer();
  /** Underdialoger fryser opprinnelsen (selskap + faktura + linje). */
  type Ctx = { entity: string | null; invoiceId: string; invoiceNumber: string; line: ReceiptLine };
  const [deviationCtx, setDeviationCtx] = useState<Ctx | null>(null);
  const [packageCtx, setPackageCtx] = useState<Ctx | null>(null);
  const [rematching, setRematching] = useState(false);
  const qc = useQueryClient();
  const live = useRef({ entity: legalEntityId ?? null, invoiceId, canWrite, mounted: true });
  live.current = { ...live.current, entity: legalEntityId ?? null, invoiceId, canWrite };
  useEffect(() => { live.current.mounted = true; return () => { live.current.mounted = false; }; }, []);
  // Ny faktura, nytt selskap eller tapt skrivetilgang: foreldede underdialoger lukkes.
  useEffect(() => { setDeviationCtx(null); setPackageCtx(null); }, [invoiceId, legalEntityId, canWrite]);
  const isCurrent = (c: Ctx) => live.current.mounted && live.current.canWrite && live.current.entity === c.entity && live.current.invoiceId === c.invoiceId;
  const ctxFor = (l: ReceiptLine): Ctx | null => (invoiceId ? { entity: legalEntityId ?? null, invoiceId, invoiceNumber, line: l } : null);

  /** Kun etter bekreftet pakningsendring: regn om akkurat denne linja i dens egen faktura. */
  const rematchLine = async (c: Ctx) => {
    // Ingen ny sideeffekt hvis konteksten er borte eller tilgangen tapt.
    if (!isCurrent(c)) return;
    setRematching(true);
    try {
      const { error } = await supabase.functions.invoke("match-invoice-lines", { body: { invoice_id: c.invoiceId, line_ids: [c.line.id] } });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["receipt-lines", c.invoiceId] });
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
        <DialogContent
          className="flex w-[calc(100vw-1rem)] min-w-0 max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:p-0"
          closeClassName="right-1 top-1 inline-flex h-[44px] w-[44px] items-center justify-center"
        >
          <DialogHeader className="min-w-0 border-b border-line-subtle p-4 pr-14">
            <DialogTitle>Mottak — faktura {invoiceNumber}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
            {!fixture && (linesQuery.isLoading || linesQuery.isError) ? (
              <QueryState scope="ravarer:varemottak-linjer" isLoading={linesQuery.isLoading} isError={linesQuery.isError} error={linesQuery.error} onRetry={() => void linesQuery.refetch()} />
            ) : lines.length === 0 ? (
              <p className="text-sm text-ink-secondary">Fakturaen har ingen linjer.</p>
            ) : (
              <ul className="min-w-0 space-y-3" aria-label="Fakturalinjer">
                {lines.map(l => (
                  <ReceiptLineCard
                    key={l.id}
                    line={l}
                    invoiceId={invoiceId as string}
                    invoiceNumber={invoiceNumber}
                    canWrite={canWrite}
                    busy={rematching}
                    readAt={linesQuery.dataUpdatedAt}
                    reading={linesQuery.isFetching}
                    readFailed={linesQuery.isError}
                    onReread={() => void linesQuery.refetch()}
                    onFixtureReceive={fixture ? (msg) => fixture.onAction(msg) : undefined}
                    onDeviation={() => { if (fixture) fixture.onAction(`Avvik for ${l.description ?? l.id} åpnes ikke i forhåndsvisningen.`); else if (canWrite) setDeviationCtx(ctxFor(l)); }}
                    onPackage={() => { if (fixture) fixture.onAction("Pakning åpnes ikke i forhåndsvisningen."); else if (canWrite) setPackageCtx(ctxFor(l)); }}
                  />
                ))}
              </ul>
            )}
          </div>
          <DialogFooter className="min-w-0 border-t border-line-subtle p-4">
            <Button variant="outline" className="min-h-[44px]" onClick={onClose}>Lukk</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deviationCtx && (
        <DeviationDialog
          key={`${deviationCtx.entity ?? ""}|${deviationCtx.invoiceId}|${deviationCtx.line.id}`}
          line={deviationCtx.line}
          entityId={deviationCtx.entity}
          invoiceId={deviationCtx.invoiceId}
          invoiceNumber={deviationCtx.invoiceNumber}
          isCurrent={() => isCurrent(deviationCtx)}
          onClose={() => setDeviationCtx(null)}
        />
      )}
      <PackageEditor
        open={!!packageCtx}
        row={packageCtx ? receiptLineAsWorklistRow(packageCtx.line) : null}
        onOpenChange={v => {
          if (!v) setPackageCtx(null);
        }}
        onApplied={() => {
          // Rematch bare når pakningen faktisk ble lagret, aldri ved avbrutt dialog,
          // og bare for den frosne opprinnelsen mens den fortsatt er gjeldende.
          const c = packageCtx;
          if (c) void rematchLine(c);
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
  readAt = 0,
  reading = false,
  readFailed = false,
  onReread,
  onFixtureReceive,
  onDeviation,
  onPackage,
}: {
  onFixtureReceive?: (message: string) => void;
  line: ReceiptLine;
  invoiceId: string;
  invoiceNumber: string;
  canWrite: boolean;
  busy: boolean;
  /** Tidspunkt for siste vellykkede autoritative lesing av linjene. */
  readAt?: number;
  reading?: boolean;
  readFailed?: boolean;
  onReread?: () => void;
  onDeviation: () => void;
  onPackage: () => void;
}) {
  const receive = useReceiveInvoiceLine();
  const sending = useRef(false);
  /** Ukjent utfall: frosset til en vellykket lesing ETTER forsøket er fullført. */
  const [unknownAt, setUnknownAt] = useState<number | null>(null);
  const resolved = unknownAt != null && readAt > unknownAt && !reading && !readFailed;
  useEffect(() => { if (resolved) setUnknownAt(null); }, [resolved]);
  const frozenUnknown = unknownAt != null && !resolved;
  const [lot, setLot] = useState("");
  const [bestBefore, setBestBefore] = useState("");
  const state = receiptState(line);
  const lotCheck = validateLotNumber(lot);
  const dateCheck = validateBestBefore(bestBefore);
  const id = `rl-${line.id}`;

  const confirm = () => {
    if (sending.current || frozenUnknown || reading || !canWrite || state.kind !== "receivable" || !lotCheck.ok || !dateCheck.ok || !line.raw_material_id) return;
    if (onFixtureReceive) {
      onFixtureReceive(`Ville sendt rm_receive_invoice_line for linje ${line.id} (parti ${lotCheck.value ?? "—"}, best før ${dateCheck.value ?? "—"}).`);
      return;
    }
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
      {
        onError: e => { if (e instanceof ReceiveOutcomeUnknownError) setUnknownAt(Date.now()); },
        onSettled: () => { sending.current = false; },
      },
    );
  };

  return (
    <li className="min-w-0 rounded-lg border border-line-subtle p-3">
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
                <Input id={`${id}-lot`} value={lot} disabled={frozenUnknown} onChange={e => setLot(e.target.value)} className="h-[44px] min-w-0" aria-invalid={!lotCheck.ok} />
                {!lotCheck.ok && <p className="mt-1 text-xs text-destructive">{lotCheck.message}</p>}
              </div>
              <div>
                <Label htmlFor={`${id}-bf`} className="text-xs">Best før (valgfritt)</Label>
                <Input id={`${id}-bf`} type="date" value={bestBefore} disabled={frozenUnknown} onChange={e => setBestBefore(e.target.value)} className="h-[44px] min-w-0" aria-invalid={!dateCheck.ok} />
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
            {frozenUnknown && (
              <div role="alert" className="w-full space-y-2 text-xs">
                <p className="text-warning">
                  Utfallet er ukjent — mottaket kan være registrert. Status må leses på nytt før du kan prøve igjen.
                  {reading ? " Leser status …" : readFailed ? " Lesingen feilet." : ""}
                </p>
                {onReread && <Button variant="outline" className="min-h-[44px]" disabled={reading} onClick={onReread}>Les status på nytt</Button>}
              </div>
            )}
            <Button className="min-h-[44px] flex-1 sm:flex-none" disabled={receive.isPending || frozenUnknown || reading || !lotCheck.ok || !dateCheck.ok} onClick={confirm}>
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
