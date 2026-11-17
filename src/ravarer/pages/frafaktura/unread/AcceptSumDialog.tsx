import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { newOpId } from "@/lib/pendingRpc";
import { useSumAccept } from "@/ravarer/hooks/useSumAccept";
import { ACCEPT_CATEGORIES, canSubmitAccept, sumRejectText, type AcceptCategory } from "@/ravarer/lib/fraFaktura/sumAccept";

export type AcceptTarget = { invoiceId: string; updatedAt: string; title: string; diffText: string };
export type AcceptReceipt = { invoiceId: string; title: string; category: AcceptCategory; auditId: string | null };

const EXTRA: Record<string, string> = {
  ikke_kjort: "Databaseendringen for «Godta som den er» er ikke kjørt ennå. Ingenting er endret.",
  ingen_tilgang: "Du har ikke skrivetilgang til fakturaer. Ingenting er endret.",
  ugyldig: "Serveren godtok ikke utfyllingen. Ingenting er endret.",
};

/**
 * Godta sumavviket med kategori og begrunnelse. Én op_id per åpning: ukjent utfall låser valgene og kan bare
 * sendes uendret på nytt (serveren gir samme svar for samme op_id).
 */
export function AcceptSumDialog({ target, onClose, onAccepted }: { target: AcceptTarget | null; onClose: () => void; onAccepted: (r: AcceptReceipt) => void }) {
  const { accept } = useSumAccept();
  const [category, setCategory] = useState<AcceptCategory | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; unknown: boolean } | null>(null);
  const op = useRef<string | null>(null);
  const lock = useRef(false);
  const frozen = useRef<{ category: AcceptCategory; reason: string } | null>(null);

  useEffect(() => {
    if (!target) return;
    setCategory(null); setReason(""); setMsg(null); op.current = newOpId(); frozen.current = null;
  }, [target]);

  const submit = async () => {
    if (!target || lock.current) return;
    const payload = frozen.current ?? (category && canSubmitAccept(category, reason) ? { category, reason } : null);
    if (!payload || !op.current) return;
    lock.current = true; setBusy(true); setMsg(null);
    frozen.current = payload;
    try {
      const r = await accept({ invoiceId: target.invoiceId, updatedAt: target.updatedAt, category: payload.category, reason: payload.reason, opId: op.current });
      if (r.kind === "ok") { onAccepted({ invoiceId: target.invoiceId, title: target.title, category: payload.category, auditId: r.auditId }); onClose(); return; }
      if (r.kind === "avvist") { frozen.current = null; op.current = newOpId(); setMsg({ text: EXTRA[r.code] ?? sumRejectText(r.code), unknown: false }); return; }
      setMsg({ text: "Utfallet er ukjent. Send det samme på nytt – det blir ikke registrert to ganger.", unknown: true });
    } finally { lock.current = false; setBusy(false); }
  };

  const unknown = msg?.unknown === true;
  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o && !busy && !unknown) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Godta summen som den er?</DialogTitle>
          <DialogDescription>{target?.title}. {target?.diffText} Fakturaen tas ut av listen, og begrunnelsen lagres på fakturaen og i loggen. Du kan angre etterpå.</DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy || unknown} className="space-y-3">
          <legend className="text-sm font-semibold">Hvorfor stemmer ikke summen?</legend>
          <RadioGroup value={category ?? ""} onValueChange={(v) => setCategory(ACCEPT_CATEGORIES.find((c) => c.id === v)?.id ?? null)}>
            {ACCEPT_CATEGORIES.map((c) => (
              <div key={c.id} className="flex min-h-[44px] items-center gap-2">
                <RadioGroupItem id={`godta-${c.id}`} value={c.id} /><Label htmlFor={`godta-${c.id}`}>{c.label}</Label>
              </div>
            ))}
          </RadioGroup>
          <div className="space-y-1">
            <Label htmlFor="godta-begrunnelse">Begrunnelse {category === "annet" ? "(påkrevd)" : "(valgfritt)"}</Label>
            <Textarea id="godta-begrunnelse" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="F.eks. miljøgebyr og pant står ikke som varelinjer" />
          </div>
        </fieldset>
        {msg && <p role="alert" className="text-sm text-destructive">{msg.text}</p>}
        <DialogFooter>
          {!unknown && <Button variant="ghost" className="min-h-[44px]" disabled={busy} onClick={onClose}>Avbryt</Button>}
          <Button className="min-h-[44px]" disabled={busy || (!unknown && !canSubmitAccept(category, reason))} onClick={() => void submit()}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}{unknown ? "Send på nytt" : "Godta som den er"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
