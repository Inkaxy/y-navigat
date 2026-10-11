import { useEffect, useRef, useState, type ReactNode } from "react";
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
  /** Serveren meldte endret grunnlag: gammel plan er forkastet og kan ikke sendes. */
  stale?: boolean;
  onRecheck?: () => void;
  recheckBusy?: boolean;
  recheckError?: boolean;
  blocked?: { message: string; reasons: string[] } | null;
  /** Endringer i ny kontroll, til gjennomgang før innsending. */
  changes?: string[];
  notice?: ReactNode;
};

/** Oppretter leverandørsak: dokumentert krav (avtalepris) eller prisforespørsel (ingen penger kreves). */
export function ClaimCreditDialog({ open, onOpenChange, defaultTitle, kind, amount, observed, lineCount, busy, error, onSubmit, stale, onRecheck, recheckBusy, recheckError, blocked, changes, notice }: Props) {
  const [f, setF] = useState<ClaimForm>({ title: defaultTitle, reason: "", followUpOn: "" });
  // Tittel/begrunnelse nullstilles bare når dialogen åpnes på nytt, ikke ved ny kontroll.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) setF({ title: defaultTitle, reason: "", followUpOn: "" });
    wasOpen.current = open;
  }, [open, defaultTitle]);
  const canSubmit = !!kind && !stale && !blocked && !recheckError && !recheckBusy;
  const c = kind ? KIND_COPY[kind] : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{c ? c.action : "Leverandørsak"}</DialogTitle>
          <DialogDescription>
            {!kind && "Ingen gyldig kontrollert plan. "}
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
          {stale && (
            <div role="alert" className="space-y-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <p className="font-medium">Grunnlaget er endret. Kontroller på nytt.</p>
              <p className="text-ink-secondary">Det gamle grunnlaget er forkastet og kan ikke sendes. Ny kontroll gjelder de samme valgte linjene og sendes ikke automatisk.</p>
              {recheckError && <p className="text-destructive">Kunne ikke kontrollere på nytt. Grunnlaget er ukjent.</p>}
              {onRecheck && <Button size="sm" className="min-h-11" variant="outline" disabled={recheckBusy} onClick={onRecheck}>{recheckBusy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}Kontroller på nytt</Button>}
            </div>
          )}
          {blocked && (
            <div role="alert" className="space-y-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <p className="font-medium">{blocked.message}</p>
              {blocked.reasons.length > 0 && <ul className="list-disc pl-5">{blocked.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            </div>
          )}
          {!stale && changes && changes.length > 0 && (
            <div role="status" className="space-y-1 rounded-md border border-border px-3 py-2 text-sm">
              <p className="font-medium">Ny kontroll — gjennomgå før du oppretter</p>
              <ul className="list-disc pl-5">{changes.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          )}
          {notice}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2 [&>button]:min-h-11">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Avbryt</Button>
          <Button onClick={() => onSubmit(f)} disabled={busy || !canSubmit || f.title.trim().length === 0}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}{kind === "documented_claim" ? "Opprett krav" : "Opprett prisforespørsel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
