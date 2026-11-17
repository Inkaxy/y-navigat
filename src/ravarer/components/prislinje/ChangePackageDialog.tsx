import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PackageSpecFields } from "@/fakturaer/components/package/PackageSpecFields";
import { describePackageSpec, initialContainer, type PackageSpecInput } from "@/fakturaer/lib/packageSpec";
import { callPendingRpc, newOpId } from "@/lib/pendingRpc";
import { invalidateRawMaterial, invalidateInvoice } from "@/ravarer/lib/invalidate";
import { correctionErrorText, parsePackageChange, type PackageChangeResult, type PrislinjeRow } from "@/ravarer/lib/prislinje";
import { PackagePreviewTable } from "../beslutninger/PackagePreviewTable";

/**
 * «Endre godkjent pakning» (approve/admin). Endrer leverandørens godkjente pakning framover; tidligere kjøp
 * endres ikke. Forhåndsvisning (åpne linjer som regnes om) før lagring; ukjent utfall gjentar samme opId.
 */
export function ChangePackageDialog({ row, onClose }: { row: PrislinjeRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [spec, setSpec] = useState<PackageSpecInput>(() => ({
    container: initialContainer(row.containerUnit), size: row.buPerPackage != null ? String(row.buPerPackage).replace(".", ",") : "", contentUnit: row.baseUnit,
  }));
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Extract<PackageChangeResult, { kind: "preview" }> | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "unknown" | "saved">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const frozen = useRef<Record<string, unknown> | null>(null);
  const lock = useRef(false);
  const st = describePackageSpec(spec, row.baseUnit, row.containerUnit);
  const valid = st.state === "valid" && reason.trim().length >= 5;

  const call = async (dry: boolean) => {
    if (lock.current) return;
    if (dry && st.state !== "valid") return;
    const args = !dry && frozen.current ? frozen.current : st.state === "valid" ? {
      p_rms_id: row.id, p_package_size: st.size, p_package_unit: st.unit, p_base_units_per_package: st.baseUnitsPerPackage,
      p_container_unit: spec.container || null, p_reason: reason.trim(), p_expected_updated_at: row.updatedAt, p_op_id: newOpId(),
    } : null;
    if (!args) return;
    frozen.current = args;
    lock.current = true; setState("busy"); setMsg(null);
    try {
      const r = await callPendingRpc("rm_change_approved_package", { ...args, p_dry_run: dry });
      if (r.kind === "missing") { setState("idle"); setMsg("Venter på databaseendringen for Prislinje."); return; }
      if (r.kind === "denied") { setState("idle"); setMsg("Bare godkjenner eller administrator kan endre godkjent pakning."); return; }
      const p = r.kind === "ok" ? parsePackageChange(r.data) : { kind: "unknown" as const };
      if (p.kind === "preview") { setPreview(p); setState("idle"); return; }
      if (p.kind === "rejected") { setState("idle"); setMsg(correctionErrorText(p.error)); frozen.current = null; return; }
      if (p.kind === "saved") {
        setState("saved"); setSaved(`Pakningen er endret. ${p.requeued} ${p.requeued === 1 ? "åpen faktura er" : "åpne fakturaer er"} lagt i kø for ny beregning. Tidligere kjøp er uendret.`);
        invalidateRawMaterial(qc, row.rawMaterialId); invalidateInvoice(qc);
        void qc.invalidateQueries({ queryKey: ["ravarer", "prislinje"] });
        void qc.invalidateQueries({ queryKey: ["ravarer", "prisrettinger", row.rawMaterialId] });
        return;
      }
      setState(dry ? "idle" : "unknown");
      setMsg(dry ? "Forhåndsvisningen kunne ikke leses. Prøv igjen." : "Utfallet er ukjent. Send samme endring for å få svar – den lagres aldri to ganger.");
    } finally { lock.current = false; }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v && state !== "busy") onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Endre godkjent pakning</DialogTitle>
          <DialogDescription>{row.rmName} hos {row.supplierName}. Gjelder nye og åpne kjøp. Tidligere kjøp og priser endres ikke. Endringen loggføres.</DialogDescription>
        </DialogHeader>
        {state === "saved" ? <p role="status" className="text-sm">{saved}</p> : (
          <div className="space-y-3">
            <PackageSpecFields idPrefix={`endre-${row.id}`} baseUnit={row.baseUnit} invoiceUnit={row.containerUnit} value={spec} onChange={setSpec} containerEditable disabled={!!preview || state !== "idle"} />
            {st.state === "valid" && <p className="text-caption text-ink-secondary">{st.text}</p>}
            {st.state === "invalid" && <p className="text-caption text-destructive">{st.reason}</p>}
            <div className="space-y-1">
              <Label htmlFor={`endre-grunn-${row.id}`}>Begrunnelse</Label>
              <Textarea id={`endre-grunn-${row.id}`} value={reason} disabled={!!preview || state !== "idle"} onChange={(e) => setReason(e.target.value)} />
            </div>
            {preview && (
              <div className="space-y-1">
                <p className="text-sm">{preview.openLines} åpne {preview.openLines === 1 ? "linje" : "linjer"} på {preview.openInvoices} {preview.openInvoices === 1 ? "faktura" : "fakturaer"} regnes om.</p>
                <PackagePreviewTable baseUnit={row.baseUnit} caption="Anslag for åpne linjer (serveren regner på nytt i køen):"
                  rows={preview.lines.map((l) => ({ id: l.lineId, invoiceNumber: l.invoiceNumber, invoiceDate: l.invoiceDate, before: l.before, after: l.after, vsExpectedPct: null, unaffected: false }))} />
              </div>
            )}
            {msg && <p role="alert" className="text-sm text-destructive">{msg}</p>}
          </div>
        )}
        <DialogFooter className="gap-2">
          {state === "saved" ? <Button className="min-h-[44px]" onClick={onClose}>Lukk</Button>
            : state === "unknown" ? <Button className="min-h-[44px]" onClick={() => void call(false)}>Send samme endring</Button>
            : preview ? (
              <>
                <Button variant="ghost" className="min-h-[44px]" disabled={state === "busy"} onClick={() => { setPreview(null); frozen.current = null; }}>Endre</Button>
                <Button className="min-h-[44px]" disabled={state === "busy"} onClick={() => void call(false)}>Lagre pakning og regn om</Button>
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
