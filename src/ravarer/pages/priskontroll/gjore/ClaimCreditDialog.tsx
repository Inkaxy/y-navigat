import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KIND_COPY, type CaseKind } from "@/ravarer/lib/supplierClaim";
import { kr } from "./logic";

export type ClaimForm = { title: string; reason: string; followUpOn: string };

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultTitle: string;
  /** Fra serverens kontroll av nøyaktig de valgte linjene. */
  kind: CaseKind | null;
  amount: number | null;
  observed: number | null;
  lineCount: number;
  busy: boolean;
  error: string | null;
  onSubmit: (f: ClaimForm) => void;
};

/** Oppretter leverandørsak: dokumentert krav (avtalepris) eller prisforespørsel (ingen penger kreves). */
export function ClaimCreditDialog({ open, onOpenChange, defaultTitle, kind, amount, observed, lineCount, busy, error, onSubmit }: Props) {
  const [f, setF] = useState<ClaimForm>({ title: defaultTitle, reason: "", followUpOn: "" });
  useEffect(() => { if (open) setF({ title: defaultTitle, reason: "", followUpOn: "" }); }, [open, defaultTitle]);
  const c = kind ? KIND_COPY[kind] : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{c ? c.action : "Leverandørsak"}</DialogTitle>
          <DialogDescription>
            {kind === "documented_claim" && amount != null && <>Dokumentert krav på {kr(amount)} eks. mva for {lineCount} {lineCount === 1 ? "linje" : "linjer"}, kontrollert mot gjeldende avtalepris. </>}
            {kind === "price_inquiry" && <>Prisforespørsel for {lineCount} {lineCount === 1 ? "linje" : "linjer"}. Ingen penger kreves; vi spør leverandøren om gjeldende pris og årsaken.{observed != null ? ` Observert prisforskjell: ${kr(observed)} eks. mva (bare en observasjon).` : ""} </>}
            Fakturaprisen godtas slik at fakturaen kan avstemmes; saken følges opp separat.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="claim-title">Tittel</Label>
            <Input id="claim-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="claim-reason">Begrunnelse</Label>
            <Textarea id="claim-reason" rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={kind === "documented_claim" ? "F.eks. avtalepris gjelder til 31.12." : "F.eks. ønsker forklaring på prisendringen"} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="claim-follow">Oppfølgingsdato (valgfri)</Label>
            <Input id="claim-follow" type="date" value={f.followUpOn} onChange={(e) => setF({ ...f, followUpOn: e.target.value })} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Avbryt</Button>
          <Button onClick={() => onSubmit(f)} disabled={busy || !kind || f.title.trim().length === 0}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}{kind === "documented_claim" ? "Opprett krav" : "Opprett prisforespørsel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
