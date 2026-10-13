import { useRef, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Loader2, Mail, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const SENDER = "Henrik@nottero-bakeri.no";
const MESSAGES: Record<string, string> = {
  ugyldig_mottaker: "E-postadressen ser ikke gyldig ut.",
  ingen_tilgang: "Du har ikke tilgang til denne fakturaen.",
  mangler_original: "Fakturaen har ingen original-PDF.",
  for_stor: "PDF-en er for stor til å sendes som vedlegg (maks 3 MB).",
  sending_avvist: "E-posttjenesten avviste sendingen. Ingenting ble sendt.",
  ukjent_utfall: "Uklart om e-posten ble sendt. Sjekk sendte elementer før du prøver igjen.",
};

interface Props { invoiceId: string | null; invoiceNumber?: string | null; url: string | null }

/** Skriv ut originalen og send den som vedlegg på e-post. */
export function InvoiceShareActions({ invoiceId, invoiceNumber, url }: Props) {
  const [printing, setPrinting] = useState(false);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const lock = useRef(false);

  const print = async () => {
    if (!url) return;
    setPrinting(true);
    try {
      const blob = await (await fetch(url)).blob();
      const obj = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      const frame = document.createElement("iframe");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
      frame.src = obj;
      frame.onload = () => {
        try { frame.contentWindow?.focus(); frame.contentWindow?.print(); }
        catch { window.open(obj, "_blank", "noopener"); }
        setTimeout(() => { frame.remove(); URL.revokeObjectURL(obj); }, 60_000);
      };
      document.body.appendChild(frame);
    } catch {
      toast({ title: "Kunne ikke hente fakturaen for utskrift", variant: "destructive" });
    } finally { setPrinting(false); }
  };

  const send = async () => {
    if (lock.current || !invoiceId) return;
    lock.current = true; setSending(true);
    try {
      const { error } = await supabase.functions.invoke("send-invoice-email", { body: { invoice_id: invoiceId, to: to.trim(), message: msg } });
      if (error) {
        let code = "ukjent_utfall";
        if (error instanceof FunctionsHttpError) {
          const j: unknown = await error.context.json().catch(() => null);
          if (j && typeof j === "object" && "code" in j && typeof j.code === "string") code = j.code;
        }
        toast({ title: "E-post ikke bekreftet sendt", description: MESSAGES[code] ?? "Noe gikk galt. Ingenting er bekreftet sendt.", variant: "destructive" });
        return;
      }
      toast({ title: "Faktura sendt", description: `Sendt til ${to.trim()} fra ${SENDER}.` });
      setOpen(false); setTo(""); setMsg("");
    } finally { lock.current = false; setSending(false); }
  };

  const valid = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to.trim());
  return (
    <>
      <Button type="button" size="icon" variant="ghost" className="min-h-[44px] min-w-[44px]" disabled={!url || printing} onClick={() => void print()} aria-label="Skriv ut faktura" title="Skriv ut">
        {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
      </Button>
      <Button type="button" size="icon" variant="ghost" className="min-h-[44px] min-w-[44px]" disabled={!url || !invoiceId} onClick={() => setOpen(true)} aria-label="Send faktura på e-post" title="Send på e-post">
        <Mail className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={(o) => { if (!sending) setOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send faktura {invoiceNumber ?? ""} på e-post</DialogTitle>
            <DialogDescription>Originalen sendes som PDF-vedlegg fra {SENDER}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="inv-mail-to">Mottaker</Label>
              <Input id="inv-mail-to" type="email" autoComplete="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="navn@firma.no" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-mail-msg">Melding (valgfritt)</Label>
              <Textarea id="inv-mail-msg" rows={4} maxLength={4000} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Vedlagt følger faktura." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={sending} onClick={() => setOpen(false)}>Avbryt</Button>
            <Button disabled={!valid || sending} onClick={() => void send()}>
              {sending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
