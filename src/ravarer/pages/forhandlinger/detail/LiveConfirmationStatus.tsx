import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock, FileCheck, Loader2, Mail, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { classifyApplyOutcome, readEdgeErrorBody } from "@/ravarer/lib/negotiationOps";
import { formatDate as formatDateTime } from "@/ravarer/lib/constants";
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

/**
 * Gjenoppretting etter en aktivering som ikke ble bekreftet. Bundet til frosset forhandling.
 * - uncertain: noe kan være lagret; vanlig aktivering er sperret til status er lest på nytt
 *   OG brukeren eksplisitt tillater et nytt forsøk.
 * - followup: prisene er bekreftet aktivert, bare merkingen av de frosne linjene gjenstår.
 */
type Recovery =
  | { kind: "uncertain"; negotiationId: string; text: string | null; reread: "idle" | "pending" | "ok" | "failed"; readAt: string | null }
  | { kind: "followup"; negotiationId: string; targetIds: string[]; retrying: boolean };

/**
 * Bekreftelsesstatus for en avsluttet live-forhandling, med aktivering.
 * Aktivering (motoren) og merking av ubekreftede linjer er to separate steg;
 * feil i det andre steget vises eksplisitt etter at prisene er aktivert.
 */
export function LiveConfirmationStatus({ neg, items, recipients, rmName, supName, canWrite }: LiveConfirmationStatusProps) {
  const qc = useQueryClient();
  const [activeRecipientId, setActiveRecipientId] = useState("");
  const [activating, setActivating] = useState(false);
  const [recoveryState, setRecovery] = useState<Recovery | null>(null);
  const lock = useRef(false);
  const ctx = useRef({ negotiationId: neg.id, mounted: true });
  ctx.current.negotiationId = neg.id;
  useEffect(() => { const c = ctx.current; c.mounted = true; return () => { c.mounted = false; }; }, []);
  useEffect(() => { setRecovery(null); }, [neg.id]);
  /** Et sent svar for en annen forhandling eller etter avmontering vises aldri. */
  const stillCurrent = (id: string) => ctx.current.mounted && ctx.current.negotiationId === id;
  const recovery = recoveryState && recoveryState.negotiationId === neg.id ? recoveryState : null;
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
    if (lock.current || recovery) return;
    const targets = onlyConfirmed ? confirmed : [...confirmed, ...tentative];
    if (targets.length === 0) { toast.info("Ingen linjer å aktivere"); return; }
    const rec = selectedRecipient;
    if (!rec) { toast.error("Velg hvilken leverandør avtalen gjelder"); return; }
    lock.current = true;
    setActivating(true);
    const negotiationId = neg.id;
    const frozenTentativeIds = tentative.map((i) => i.id);
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
      if (!stillCurrent(negotiationId)) return;
      if (outcome.kind === "rejected") { toast.error(outcome.message); return; }
      if (outcome.kind === "partial") {
        setRecovery({ kind: "uncertain", negotiationId, reread: "idle", readAt: null,
          text: `${outcome.linksOpen ? "Forhandlingen er avsluttet, men lenkene er ikke stengt. " : ""}${outcome.failures.join("; ")}`.trim() || null });
        return;
      }
      if (outcome.kind === "unknown") { setRecovery({ kind: "uncertain", negotiationId, text: null, reread: "idle", readAt: null }); return; }
      if (!onlyConfirmed && frozenTentativeIds.length > 0) {
        const ok = await markRemaining(negotiationId, frozenTentativeIds);
        if (!stillCurrent(negotiationId)) return;
        if (!ok) { setRecovery({ kind: "followup", negotiationId, targetIds: frozenTentativeIds, retrying: false }); return; }
      }
      toast.success("Aktivert");
    } catch (e) {
      console.warn("[live-aktivering] ukjent utfall", e instanceof Error ? e.name : "ukjent");
      if (stillCurrent(negotiationId)) setRecovery({ kind: "uncertain", negotiationId, text: null, reread: "idle", readAt: null });
    } finally {
      lock.current = false;
      setActivating(false);
    }
  }

  /** Bare statussteget, bare for de frosne linjene som fortsatt er foreløpige. Aldri prisene på nytt. */
  async function markRemaining(negotiationId: string, ids: string[]): Promise<boolean> {
    try {
      const { error: followErr } = await supabase
        .from("negotiation_items")
        .update({ live_status: "unconfirmed_active" })
        .eq("negotiation_id", negotiationId)
        .in("id", ids)
        .eq("live_status", "tentatively_agreed");
      return !followErr;
    } catch (e) {
      console.warn("[live-aktivering] merking feilet", e instanceof Error ? e.name : "ukjent");
      return false;
    } finally {
      qc.invalidateQueries({ queryKey: ["negotiation-items", negotiationId] });
    }
  }

  async function retryFollowup() {
    if (!recovery || recovery.kind !== "followup" || recovery.retrying) return;
    const r = recovery;
    setRecovery({ ...r, retrying: true });
    const ok = await markRemaining(r.negotiationId, r.targetIds);
    if (!stillCurrent(r.negotiationId)) return;
    if (ok) { setRecovery(null); toast.success("Gjenstående linjer er merket"); }
    else setRecovery({ ...r, retrying: false });
  }

  async function reread() {
    if (!recovery || recovery.kind !== "uncertain" || recovery.reread === "pending") return;
    const r = recovery;
    setRecovery({ ...r, reread: "pending" });
    try {
      await Promise.all([
        qc.refetchQueries({ queryKey: ["negotiation-items", r.negotiationId] }, { throwOnError: true }),
        qc.refetchQueries({ queryKey: ["negotiation", r.negotiationId] }, { throwOnError: true }),
      ]);
      if (stillCurrent(r.negotiationId)) setRecovery({ ...r, reread: "ok", readAt: new Date().toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" }) });
    } catch (e) {
      console.warn("[live-aktivering] ny lesing feilet", e instanceof Error ? e.name : "ukjent");
      if (stillCurrent(r.negotiationId)) setRecovery({ ...r, reread: "failed" });
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
          {canWrite && !recovery && confirmed.length > 0 && tentative.length > 0 && !closed && (
            <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => void onActivate(true)} disabled={activating}>
              {activating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Aktiver kun bekreftede ({confirmed.length})
            </Button>
          )}
          {canWrite && !recovery && tentative.length > 0 && !closed && (
            <Button size="sm" className="min-h-[44px]" onClick={() => void onActivate(false)} disabled={activating}>
              {activating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Aktiver alle uansett
            </Button>
          )}
        </div>
      </div>

      {recovery?.kind === "followup" && (
        <div role="alert" className="space-y-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
          <p>Prisene er aktivert, men {recovery.targetIds.length} ubekreftede linje{recovery.targetIds.length === 1 ? "" : "r"} ble ikke merket som «aktivert uten bekreftelse». Prisene sendes ikke på nytt.</p>
          {canWrite && (
            <Button size="sm" variant="outline" className="min-h-[44px]" disabled={recovery.retrying} onClick={() => void retryFollowup()}>
              {recovery.retrying && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Merk bare gjenstående linjer
            </Button>
          )}
        </div>
      )}
      {recovery?.kind === "uncertain" && (
        <div role="alert" className="space-y-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
          <p>Utfallet er ukjent — noen endringer kan være lagret.{recovery.text ? ` ${recovery.text}` : ""} Aktivering er sperret til du har kontrollert status. Ingenting prøves på nytt automatisk.</p>
          {recovery.reread === "ok" && <p>Status ble lest på nytt kl. {recovery.readAt}. Kontroller linjene nedenfor før et eventuelt nytt forsøk.</p>}
          {recovery.reread === "failed" && <p className="text-destructive">Status kunne ikke leses på nytt. Prøv igjen.</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="min-h-[44px]" disabled={recovery.reread === "pending"} onClick={() => void reread()}>
              {recovery.reread === "pending" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Les status på nytt
            </Button>
            {canWrite && recovery.reread === "ok" && (
              <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => setRecovery(null)}>
                Jeg har kontrollert — tillat nytt forsøk
              </Button>
            )}
          </div>
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
