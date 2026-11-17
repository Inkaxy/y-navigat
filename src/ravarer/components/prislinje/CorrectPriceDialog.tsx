import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseDecimal } from "@/fakturaer/lib/units";
import { callPendingRpc, newOpId } from "@/lib/pendingRpc";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { formatNorwegianNumber } from "@/ravarer/lib/quickFormat";
import { correctionErrorText, parseCorrection, type CorrectionResult } from "@/ravarer/lib/prislinje";
import type { TimelineHistoryRow } from "@/ravarer/lib/priceTimeline";

const money = (n: number | null, unit: string) => (n == null ? "ukjent" : `${formatNorwegianNumber(n, 2)} kr/${unit}`);
const dateNo = (iso: string) => iso.split("-").reverse().join(".");

/**
 * «Rett pris» på ett kjøp (approve/admin). Forhåndsvisning først (dry_run), så lagring med samme opId.
 * Ukjent utfall låser skjemaet; «Send samme retting» gjentar nøyaktig samme forespørsel (idempotent).
 */
export function CorrectPriceDialog({ row, rawMaterialId, unit, onClose }: { row: TimelineHistoryRow; rawMaterialId: string; unit: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Extract<CorrectionResult, { kind: "preview" }> | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "unknown" | "saved">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const frozen = useRef<{ opId: string; price: number; reason: string } | null>(null);
  const lock = useRef(false);
  const parsed = parseDecimal(price);
  const valid = parsed != null && parsed > 0 && reason.trim().length >= 5;

  const call = async (dry: boolean) => {
    if (lock.current) return;
    const f = dry || !frozen.current ? { opId: frozen.current?.opId ?? newOpId(), price: parsed ?? 0, reason: reason.trim() } : frozen.current;
    if (!dry) frozen.current = f;
    lock.current = true; setState("busy"); setMsg(null);
    try {
      const r = await callPendingRpc("rm_correct_purchase_price", { p_history_id: row.id, p_new_price: f.price, p_reason: f.reason, p_op_id: f.opId, p_dry_run: dry });
      if (r.kind === "missing") { setState("idle"); setMsg("Retting venter på databaseendringen for Prislinje."); return; }
      if (r.kind === "denied") { setState("idle"); setMsg("Bare godkjenner eller administrator kan rette priser."); return; }
      const p = r.kind === "ok" ? parseCorrection(r.data) : { kind: "unknown" as const };
      if (p.kind === "preview") { frozen.current = f; setPreview(p); setState("idle"); return; }
      if (p.kind === "rejected") { setState("idle"); setMsg(correctionErrorText(p.error)); if (!dry) frozen.current = null; return; }
      if (p.kind === "saved") { setState("saved"); invalidateRawMaterial(qc, rawMaterialId); void qc.invalidateQueries({ queryKey: ["ravarer", "prisrettinger", rawMaterialId] }); return; }
      setState(dry ? "idle" : "unknown");
      setMsg(dry ? "Forhåndsvisningen kunne ikke leses. Prøv igjen." : "Utfallet er ukjent. Rettingen kan være lagret. Send samme retting for å få svar – den lagres aldri to ganger.");
    } finally { lock.current = false; }
  };
  const editing = state !== "unknown" && state !== "saved";

  return (
    <Dialog open onOpenChange={(v) => { if (!v && state !== "busy") onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rett pris for ett kjøp</DialogTitle>
          <DialogDescription>
            Kjøpet {dateNo(row.effective_date)}{row.invoiceNumber ? ` (faktura ${row.invoiceNumber})` : ""}: {money(Number(row.price), unit)}. Bare dette kjøpet endres. Det gamle beholdes i historikken, og rettingen loggføres.
          </DialogDescription>
        </DialogHeader>
        {state === "saved" ? (
          <p role="status" className="text-sm">Prisen er rettet. Gjeldende kost er regnet på nytt.</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="rett-pris">Riktig pris (kr/{unit})</Label>
              <Input id="rett-pris" inputMode="decimal" value={price} disabled={!editing || !!preview} onChange={(e) => setPrice(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rett-grunn">Begrunnelse</Label>
              <Textarea id="rett-grunn" value={reason} disabled={!editing || !!preview} onChange={(e) => setReason(e.target.value)} placeholder="F.eks. «Prisen ble lest med feil komma»" />
            </div>
            {preview && (
              <div className="rounded-md bg-muted/50 p-3 text-sm tabular-nums" role="status">
                <p>Kjøpet: {money(preview.oldPrice, unit)} → <strong>{money(preview.newPrice, unit)}</strong></p>
                <p>Gjeldende kost: {money(preview.costBefore, unit)} → <strong>{money(preview.costAfter, unit)}</strong></p>
                <p className="text-caption text-ink-secondary">Andre kjøp og fakturaen endres ikke.</p>
              </div>
            )}
            {msg && <p role="alert" className="text-sm text-destructive">{msg}</p>}
          </div>
        )}
        <DialogFooter className="gap-2">
          {state === "saved" ? <Button className="min-h-[44px]" onClick={onClose}>Lukk</Button>
            : state === "unknown" ? <Button className="min-h-[44px]" onClick={() => void call(false)}>Send samme retting</Button>
            : preview ? (
              <>
                <Button variant="ghost" className="min-h-[44px]" disabled={state === "busy"} onClick={() => { setPreview(null); frozen.current = null; }}>Endre</Button>
                <Button className="min-h-[44px]" disabled={state === "busy"} onClick={() => void call(false)}>Lagre retting</Button>
              </>
            ) : (
              <>
                <Button variant="ghost" className="min-h-[44px]" onClick={onClose}>Avbryt</Button>
                <Button className="min-h-[44px]" disabled={!valid || state === "busy"} onClick={() => void call(true)}>Forhåndsvis</Button>
              </>
            )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
