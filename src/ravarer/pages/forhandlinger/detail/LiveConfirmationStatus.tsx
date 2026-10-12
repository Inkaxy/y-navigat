import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock, FileCheck, Loader2, Mail, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { classifyApplyOutcome, readEdgeErrorBody } from "@/ravarer/lib/negotiationOps";
import { formatDateTime } from "@/lib/format";
import { LiveItemStatusPill } from "@/ravarer/components/forhandlinger/NegotiationPills";
import type { NegotiationItemRow, NegotiationRecipientRow, NegotiationRow } from "@/ravarer/hooks/useNegotiations";

export interface LiveConfirmationStatusProps {
  neg: NegotiationRow;
  items: NegotiationItemRow[];
  recipients: NegotiationRecipientRow[];
  rmName: (id: string) => string;
  supName: (id: string) => string;
  canWrite: boolean;
}

/** Utfall av en aktivering som brukeren må se (ikke bare en toast). */
type ActivationNotice =
  | { kind: "partial"; text: string }
  | { kind: "followup_failed" }
  | { kind: "unknown" };

/**
 * Bekreftelsesstatus for en avsluttet live-forhandling, med aktivering.
 * Aktivering (motoren) og merking av ubekreftede linjer er to separate steg;
 * feil i det andre steget vises eksplisitt etter at prisene er aktivert.
 */
export function LiveConfirmationStatus({ neg, items, recipients, rmName, supName, canWrite }: LiveConfirmationStatusProps) {
  const qc = useQueryClient();
  const [activeRecipientId, setActiveRecipientId] = useState("");
  const [activating, setActivating] = useState(false);
  const [notice, setNotice] = useState<ActivationNotice | null>(null);
  const lock = useRef(false);
  const selectedRecipient = recipients.find((r) => r.id === activeRecipientId) ?? (recipients.length === 1 ? recipients[0] : undefined);

  const tentative = items.filter((i) => i.live_status === "tentatively_agreed");
  const confirmed = items.filter((i) => i.live_status === "confirmed");
  const disputed = tentative.filter((i) => !!i.live_supplier_note);
  const unconfActive = items.filter((i) => i.live_status === "unconfirmed_active");
  const total = tentative.length + confirmed.length + unconfActive.length;
  const deadline = neg.live_confirmation_deadline;
  const overdue = !!deadline && new Date(deadline) < new Date();
  const closed = neg.status === "concluded";

  const mailtoBody = encodeURIComponent(
    `Hei,\n\nVennligst bekreft de avtalte prisene fra forhandlingen vår.\n\nFrist: ${deadline ? formatDateTime(deadline) : "—"}\n\nMvh.`,
  );
  const mailtoSubject = encodeURIComponent(`Påminnelse: Bekreft forhandling – ${neg.title}`);

  async function onActivate(onlyConfirmed: boolean) {
    if (lock.current) return;
    const targets = onlyConfirmed ? confirmed : [...confirmed, ...tentative];
    if (targets.length === 0) { toast.info("Ingen linjer å aktivere"); return; }
    const rec = selectedRecipient;
    if (!rec) { toast.error("Velg hvilken leverandør avtalen gjelder"); return; }
    lock.current = true;
    setActivating(true);
    setNotice(null);
    const negotiationId = neg.id;
    try {
      const outcomes = targets.map((it) => ({
        negotiation_item_id: it.id,
        winner_recipient_id: rec.id,
        winner_response_id: null,
        // Prisen sendes med enheten den gjelder for; serveren regner om — vi gjetter aldri.
        agreed_price: it.live_agreed_price,
        agreed_price_unit: it.live_agreed_price_unit ?? null,
        agreed_package_size: it.live_agreed_package_size,
        agreed_package_unit: it.live_agreed_package_unit,
        set_as_primary: false,
        apply_to_supplier: true,
      }));
      const { data, error } = await supabase.functions.invoke("apply-negotiation-outcome", {
        body: { negotiation_id: negotiationId, outcomes },
      });
      const outcome = classifyApplyOutcome(data, error, error ? await readEdgeErrorBody(error) : null);
      invalidateRawMaterial(qc);
      qc.invalidateQueries({ queryKey: ["negotiation-items", negotiationId] });
      qc.invalidateQueries({ queryKey: ["negotiation", negotiationId] });
      if (outcome.kind === "rejected") { toast.error(outcome.message); return; }
      if (outcome.kind === "partial") {
        setNotice({ kind: "partial", text: `${outcome.linksOpen ? "Forhandlingen er avsluttet, men lenkene er ikke stengt. " : ""}${outcome.failures.join("; ")}`.trim() });
        return;
      }
      if (outcome.kind === "unknown") { setNotice({ kind: "unknown" }); return; }
      if (!onlyConfirmed) {
        const { error: followErr } = await supabase
          .from("negotiation_items")
          .update({ live_status: "unconfirmed_active" })
          .eq("negotiation_id", negotiationId)
          .eq("live_status", "tentatively_agreed");
        qc.invalidateQueries({ queryKey: ["negotiation-items", negotiationId] });
        if (followErr) { setNotice({ kind: "followup_failed" }); return; }
      }
      toast.success("Aktivert");
    } catch (e) {
      console.warn("[live-aktivering] ukjent utfall", e instanceof Error ? e.name : "ukjent");
      setNotice({ kind: "unknown" });
    } finally {
      lock.current = false;
      setActivating(false);
    }
  }

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption uppercase tracking-wide text-ink-secondary">Bekreftelsesstatus</p>
          {recipients.length > 1 && (
            <div className="mt-2 max-w-xs">
              <Select value={activeRecipientId} onValueChange={setActiveRecipientId}>
                <SelectTrigger className="min-h-[44px]" aria-label="Leverandør avtalen gjelder"><SelectValue placeholder="Velg leverandør" /></SelectTrigger>
                <SelectContent>
                  {recipients.map((r) => <SelectItem key={r.id} value={r.id}>{supName(r.supplier_id)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <p className="mt-1 text-lg font-semibold">
            {confirmed.length} av {total} bekreftet
            {disputed.length > 0 && <span className="ml-2 text-warning">· {disputed.length} med innsigelse</span>}
          </p>
          {deadline && (
            <p className={`mt-0.5 text-caption ${overdue ? "text-destructive" : "text-ink-secondary"}`}>
              <Clock className="mr-1 inline h-3 w-3" aria-hidden />
              Frist: {formatDateTime(deadline)}{overdue ? " (utløpt)" : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedRecipient?.contact_email && tentative.length > 0 && (
            <Button asChild size="sm" variant="outline" className="min-h-[44px]">
              <a href={`mailto:${selectedRecipient.contact_email}?subject=${mailtoSubject}&body=${mailtoBody}`}>
                <Mail className="mr-1.5 h-4 w-4" aria-hidden /> Åpne påminnelse i e-post
              </a>
            </Button>
          )}
          {canWrite && confirmed.length > 0 && tentative.length > 0 && !closed && (
            <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => void onActivate(true)} disabled={activating}>
              {activating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Aktiver kun bekreftede ({confirmed.length})
            </Button>
          )}
          {canWrite && tentative.length > 0 && !closed && (
            <Button size="sm" className="min-h-[44px]" onClick={() => void onActivate(false)} disabled={activating}>
              {activating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Aktiver alle uansett
            </Button>
          )}
        </div>
      </div>

      {notice && (
        <div role="alert" className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
          {notice.kind === "followup_failed" && "Prisene er aktivert, men ubekreftede linjer kunne ikke merkes som «aktivert uten bekreftelse». Status er lest på nytt."}
          {notice.kind === "partial" && <>Noen endringer kan være lagret. {notice.text}</>}
          {notice.kind === "unknown" && "Utfallet er ukjent — noen endringer kan være lagret. Kontroller status før du prøver igjen."}
          <span className="block">Ingenting prøves på nytt automatisk.</span>
        </div>
      )}

      <ul className="divide-y divide-line-subtle">
        {[...confirmed, ...tentative, ...unconfActive].map((it) => {
          const isConfirmed = it.live_status === "confirmed";
          const warn = it.live_status === "unconfirmed_active" || !!it.live_supplier_note;
          return (
            <li key={it.id} className="flex items-start justify-between gap-3 py-2 text-sm">
              <div className="flex min-w-0 items-start gap-2">
                {isConfirmed ? <FileCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                  : warn ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  : <Clock className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden />}
                <div className="min-w-0">
                  <div className="font-medium">{rmName(it.raw_material_id)}</div>
                  {it.live_supplier_note && <div className="text-caption text-warning">«{it.live_supplier_note}»</div>}
                  {it.live_datasheet_path && <div className="text-caption text-ink-muted"><Paperclip className="mr-1 inline h-3 w-3" aria-hidden />Datablad mottatt</div>}
                  {it.live_datasheet_skipped && <div className="text-caption text-ink-muted">Datablad sendes separat</div>}
                </div>
              </div>
              <LiveItemStatusPill status={isConfirmed ? "confirmed" : it.live_status === "unconfirmed_active" ? "unconfirmed_active" : "tentatively_agreed"} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
