import { useEffect, useRef, useState } from "react";
import { Copy, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useUpdateNegotiation, type NegotiationRecipientRow } from "@/ravarer/hooks/useNegotiations";
import { useLogLiveEvent } from "@/ravarer/hooks/useLiveNegotiation";
import { isKnownRejection, parseRfqCredentials, portalUrlFor } from "@/ravarer/lib/negotiationOps";
import { formatNok } from "@/ravarer/lib/constants";

export interface EndSessionCredentials {
  recipientId: string;
  url: string;
  password: string;
  email: string | null;
  supplierName: string;
}

export interface EndSessionDialogProps {
  open: boolean;
  /** Lukking etter generert lenke navigerer videre (kalleren bestemmer). */
  onOpenChange: (open: boolean, hadCredentials: boolean) => void;
  negotiationId: string;
  legalEntityId: string;
  title: string;
  recipients: NegotiationRecipientRow[];
  selectedRecipient: NegotiationRecipientRow | undefined;
  supplierName: (supplierId: string) => string;
  /** Sammendragslinjer uten lenke/passord (de legges til fra samme matchede mottaker). */
  summaryLines: (supplierLabel: string) => string[];
  processedCount: number;
  totalCount: number;
  /** null = ukjent besparelse (vises aldri som et tall). */
  savingsValue: number | null;
}

/**
 * Avslutter live-økten og genererer bekreftelseslenke for VALGT mottaker.
 * Mottakeren fryses ved klikk; svaret matches på mottaker-ID (aldri første element).
 * Et sent svar etter lukk, ruteskifte eller selskapsbytte ignoreres. Ukjent utfall
 * (passord kan være rotert) krever eksplisitt ny generering — aldri automatisk.
 */
export function EndSessionDialog(p: EndSessionDialogProps) {
  const updateNeg = useUpdateNegotiation();
  const logEvent = useLogLiveEvent();
  const [deadlineDays, setDeadlineDays] = useState("14");
  const [autoApply, setAutoApply] = useState(true);
  const [ending, setEnding] = useState(false);
  const [credentials, setCredentials] = useState<EndSessionCredentials | null>(null);
  const [credUnknown, setCredUnknown] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const lock = useRef(false);
  /** Gjeldende kontekst; et svar for en annen kontekst eller etter avmontering forkastes. */
  const ctx = useRef({ negotiationId: p.negotiationId, legalEntityId: p.legalEntityId, mounted: true, gen: 0 });
  ctx.current.negotiationId = p.negotiationId;
  ctx.current.legalEntityId = p.legalEntityId;
  useEffect(() => {
    const c = ctx.current;
    c.mounted = true;
    return () => { c.mounted = false; c.gen++; };
  }, []);
  useEffect(() => {
    // Ny forhandling eller nytt selskap: glem visning og ugyldiggjør pågående svar.
    ctx.current.gen++;
    setCredentials(null);
    setCredUnknown(false);
    setConfirmRegen(false);
  }, [p.negotiationId, p.legalEntityId]);

  async function handleEnd() {
    if (lock.current) return;
    const frozen = p.selectedRecipient;
    if (!frozen) { toast.error("Velg hvilken leverandør bekreftelsen gjelder"); return; }
    if (credUnknown && !confirmRegen) return;
    const expected = p.recipients.map((r) => ({ id: r.id, supplier_id: r.supplier_id }));
    const frozenNeg = p.negotiationId;
    const frozenEntity = p.legalEntityId;
    const gen = ++ctx.current.gen;
    const current = () =>
      ctx.current.mounted && ctx.current.gen === gen && ctx.current.negotiationId === frozenNeg && ctx.current.legalEntityId === frozenEntity;
    lock.current = true;
    setEnding(true);
    try {
      const days = Math.max(1, Number(deadlineDays) || 14);
      const deadline = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      await updateNeg.mutateAsync({
        id: frozenNeg,
        patch: {
          status: "awaiting_confirmation",
          live_session_ended_at: new Date().toISOString(),
          live_confirmation_deadline: deadline,
          live_auto_apply_on_confirm: autoApply,
        },
      });
      const { data, error } = await supabase.functions.invoke("generate-rfq-credentials", { body: { negotiation_id: frozenNeg } });
      if (!current()) return;
      if (error) {
        if (!isKnownRejection(error)) setCredUnknown(true);
        toast.error(isKnownRejection(error) ? "Lenken ble avvist av serveren." : "Utfallet av lenkegenereringen er ukjent.");
        return;
      }
      const parsed = parseRfqCredentials(data, expected);
      const cred = parsed.kind === "ok" ? parsed.byRecipient.get(frozen.id) : undefined;
      if (!cred) {
        setCredUnknown(true);
        toast.error("Svaret kunne ikke knyttes sikkert til valgt leverandør. Passord kan være endret.");
        return;
      }
      setCredUnknown(false);
      setConfirmRegen(false);
      setCredentials({
        recipientId: cred.recipient_id,
        url: portalUrlFor(window.location.origin, "bekreftelse", cred),
        password: cred.password,
        email: cred.contact_email,
        supplierName: p.supplierName(cred.supplier_id) || cred.supplier_name,
      });
      await logEvent.mutateAsync({
        negotiation_id: frozenNeg,
        event_type: "session_ended",
        event_data: { processed: p.processedCount, total: p.totalCount, total_savings: p.savingsValue },
      });
    } catch (e) {
      if (current()) toast.error(e instanceof Error && e.message ? e.message : "Kunne ikke avslutte");
    } finally {
      lock.current = false;
      if (ctx.current.mounted) setEnding(false);
    }
  }

  const supplierLabel = credentials ? credentials.supplierName : p.selectedRecipient ? p.supplierName(p.selectedRecipient.supplier_id) : "—";
  const summary = (() => {
    const lines = p.summaryLines(supplierLabel);
    if (credentials) lines.push("", `Bekreftelseslenke: ${credentials.url}`, `Passord (send i separat e-post): ${credentials.password}`);
    return lines.join("\n");
  })();

  return (
    <Dialog open={p.open} onOpenChange={(o) => p.onOpenChange(o, !!credentials)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{credentials ? "Bekreftelse til leverandør" : "Avslutt forhandling"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {credUnknown && !credentials && (
            <div role="alert" className="space-y-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-caption">
              <p>
                Utfallet av lenkegenereringen er ukjent. Passord kan allerede være endret, og ingenting prøves på nytt
                automatisk. Genererer du igjen, får alle mottakere nye passord.
              </p>
              <label className="flex min-h-[44px] items-center gap-2">
                <Checkbox checked={confirmRegen} onCheckedChange={(v) => setConfirmRegen(!!v)} />
                Jeg forstår at alle mottakere får nye passord
              </label>
            </div>
          )}
          {!credentials && (
            <>
              <p>
                Avslutter live-økten og setter status til «Venter på bekreftelse». {p.processedCount} av {p.totalCount} råvarer er
                behandlet; estimert besparelse{" "}
                <strong>{p.savingsValue == null ? "ukjent" : `${formatNok(p.savingsValue)}/år`}</strong>.
              </p>
              <p className="text-caption text-ink-secondary">
                Lenken gjelder {p.selectedRecipient ? <strong>{p.supplierName(p.selectedRecipient.supplier_id)}</strong> : "valgt leverandør"}.
                Ingenting sendes automatisk.
              </p>
              <div>
                <label htmlFor="end-deadline" className="text-caption text-ink-secondary">Frist for bekreftelse (dager)</label>
                <Input id="end-deadline" type="number" min={1} value={deadlineDays} onChange={(e) => setDeadlineDays(e.target.value)} className="mt-1 min-h-[44px] w-32" />
              </div>
              <label className="flex min-h-[44px] items-center gap-2 text-sm">
                <Checkbox checked={autoApply} onCheckedChange={(v) => setAutoApply(!!v)} />
                <span>Aktiver leverandørpriser automatisk når alle linjer er bekreftet</span>
              </label>
            </>
          )}
          {credentials && (
            <div className="space-y-2 rounded-md border border-success/30 bg-success/5 p-3 text-caption" data-testid="end-credentials">
              <p className="font-semibold text-success">Lenke og passord generert — ingenting er sendt</p>
              <p>Passordet gjelder i 5 minutter.</p>
              <p>Til: <strong>{credentials.supplierName}</strong> · {credentials.email ?? "mangler e-post"}</p>
              <p className="break-all">Lenke: <code>{credentials.url}</code></p>
              <p>Passord (separat e-post): <code className="rounded bg-surface-muted px-1 py-0.5">{credentials.password}</code></p>
            </div>
          )}
          <Card className="max-h-48 overflow-auto whitespace-pre-wrap p-3 font-mono text-caption" aria-label="Sammendrag">{summary}</Card>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="min-h-[44px]"
              onClick={() => {
                navigator.clipboard.writeText(summary).then(
                  () => toast.success("Kopiert"),
                  () => toast.error("Kunne ikke kopiere"),
                );
              }}
            >
              <Copy className="mr-1.5 h-4 w-4" aria-hidden /> Kopier sammendrag
            </Button>
            {credentials?.email && (
              <Button asChild variant="outline" size="sm" className="min-h-[44px]">
                <a href={`mailto:${credentials.email}?subject=${encodeURIComponent("Bekreftelse av avtaler: " + p.title)}&body=${encodeURIComponent(summary)}`}>
                  <Mail className="mr-1.5 h-4 w-4" aria-hidden /> Åpne e-postutkast
                </a>
              </Button>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="min-h-[44px]" onClick={() => p.onOpenChange(false, !!credentials)}>
            {credentials ? "Lukk" : "Avbryt"}
          </Button>
          {!credentials && (
            <Button className="min-h-[44px]" onClick={() => void handleEnd()} disabled={ending || !p.selectedRecipient || (credUnknown && !confirmRegen)}>
              {ending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {credUnknown ? "Generer ny lenke" : "Avslutt og generer lenke"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
