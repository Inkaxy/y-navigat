import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { kr } from "./logic";

export type ClaimForm = { title: string; reason: string; followUpOn: string };

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultTitle: string;
  amount: number;
  busy: boolean;
  error: string | null;
  onSubmit: (f: ClaimForm) => void;
};

/** Liten dialog for «Krev kreditt fra leverandøren». */
export function ClaimCreditDialog({ open, onOpenChange, defaultTitle, amount, busy, error, onSubmit }: Props) {
  const [f, setF] = useState<ClaimForm>({ title: defaultTitle, reason: "", followUpOn: "" });
  useEffect(() => { if (open) setF({ title: defaultTitle, reason: "", followUpOn: "" }); }, [open, defaultTitle]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Krev kreditt fra leverandøren</DialogTitle>
          <DialogDescription>
            Merprisen ({kr(amount)}) godtas på fakturaen slik at den kan avstemmes, og kravet følges opp i én leverandørsak.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="claim-title">Tittel</Label>
            <Input id="claim-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="claim-reason">Begrunnelse</Label>
            <Textarea id="claim-reason" rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="F.eks. avtalepris gjelder til 31.12." />
          </div>
          <div className="space-y-1">
            <Label htmlFor="claim-follow">Oppfølgingsdato (valgfri)</Label>
            <Input id="claim-follow" type="date" value={f.followUpOn} onChange={(e) => setF({ ...f, followUpOn: e.target.value })} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Avbryt</Button>
          <Button onClick={() => onSubmit(f)} disabled={busy || f.title.trim().length === 0}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}Opprett krav
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
