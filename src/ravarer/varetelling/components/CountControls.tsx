import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useVtApi, type ListStatusTarget, type TransitionTarget } from "../api";
import { useOpAction, useVtCoverage, type OpOutcome } from "../hooks";
import { priceReasonLabel, type CountSummary } from "../logic";
import type { VtCount, VtCountList } from "../types";
import { Loading, Notice, PendingNotice } from "./shared";

export function report<O>(r: OpOutcome<O>, ok: string): boolean {
  if (r.kind === "ok") { toast.success(ok); return true; }
  if (r.kind === "rejected") toast.error(r.message);
  if (r.kind === "unknown") toast.error(r.message);
  return false;
}

export function StartPanel({ count, canWrite }: { count: VtCount; canWrite: boolean }) {
  const api = useVtApi();
  const cov = useVtCoverage(count.template_ids, count.valuation_mode, count.valuation_mode === "historisk" ? count.valuation_date : null);
  const start = useOpAction(`start:${count.id}`, "write", (opId, p: { countId: string; expectedRevision: number }) => api.startCount({ opId, ...p }));
  const c = cov.data;
  const blocked = !c || c.duplicates.length > 0 || c.empty_templates > 0 || c.archived_location > 0 || c.line_count === 0;
  const payload = { countId: count.id, expectedRevision: count.revision };
  return (
    <Card className="space-y-3 p-4">
      <p className="font-medium">Kontroller dekning før start</p>
      {cov.isLoading ? <Loading /> : cov.error ? <Notice tone="danger" title="Kunne ikke kontrollere dekningen." /> : c && (
        <ul className="text-sm">
          <li>{c.line_count} linjer, {c.material_count} varer fra {count.template_ids.length} lister</li>
          <li>{c.duplicates.length} duplikater (samme vare og sted)</li>
          {c.empty_templates > 0 && <li>{c.empty_templates} lister uten varer</li>}
          {c.archived_location > 0 && <li>{c.archived_location} linjer på arkiverte steder</li>}
          <li>{c.priced} varer med dokumentert pris, {c.missing_price} uten</li>
          {Object.entries(c.missing_price_by_reason).map(([k, n]) => <li key={k} className="pl-3 text-muted-foreground">{priceReasonLabel(k)}: {n}</li>)}
          <li>{c.missing_location} linjer uten plassering</li>
          {count.valuation_mode === "historisk" && c.known_after_valuation > 0 && <li>{c.known_after_valuation} priser ble registrert etter verdsettelsesdatoen (merkes i rapporten)</li>}
        </ul>
      )}
      {c && !c.invoice_access && <Notice tone="warning" title="Du mangler fakturatilgang.">Starter du tellingen, fryses ingen priser. Be noen med fakturatilgang starte den.</Notice>}
      {c && blocked && <Notice tone="danger" title="Avklar duplikater, tomme lister og arkiverte steder i listemalene før start." />}
      <p className="text-xs text-muted-foreground">
        {count.valuation_mode === "historisk"
          ? "Ved start brukes nyeste dokumenterte pris med virkningsdato til og med verdsettelsesdatoen. Varer uten slik pris får ingen pris."
          : "Ved start kopieres listene, og varenavn, enheter og nyeste bekreftede dokumenterte pris fryses for denne tellingen."}
      </p>
      <PendingNotice op={start.pending} onResend={() => void start.execute(payload, JSON.stringify(payload)).then(r => report(r, "Tellingen er startet"))} />
      {canWrite && !start.pending && (
        <Button className="min-h-[48px]" disabled={start.busy || blocked}
          onClick={() => void start.execute(payload, JSON.stringify(payload)).then(r => report(r, "Tellingen er startet"))}>Start telling</Button>
      )}
    </Card>
  );
}

export function ListActions({ list, open, canWrite, canApprove, summary }: { list: VtCountList; open: boolean; canWrite: boolean; canApprove: boolean; summary: CountSummary }) {
  const api = useVtApi();
  const set = useOpAction(`list:${list.id}`, "write", (opId, p: { listId: string; expectedRevision: number; status: ListStatusTarget }) => api.setListStatus({ opId, ...p }));
  const setApprove = useOpAction(`list:${list.id}`, "approve", (opId, p: { listId: string; expectedRevision: number; status: ListStatusTarget }) => api.setListStatus({ opId, ...p }));
  if (!open) return null;
  const go = (status: ListStatusTarget) => {
    const p = { listId: list.id, expectedRevision: list.revision, status };
    const action = status === "godkjent" || list.status === "godkjent" ? setApprove : set;
    void action.execute(p, JSON.stringify(p)).then(r => report(r, "Listestatus oppdatert"));
  };
  const pending = set.pending;
  const busy = set.busy || setApprove.busy;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Listen: {summary.lines - summary.notCounted} / {summary.lines} registrert</span>
        {canWrite && !pending && (list.status === "ikke_startet" || list.status === "under_telling") && <Button variant="outline" className="min-h-[48px]" disabled={busy || unsynced > 0} onClick={() => go("til_kontroll")}>Send liste til kontroll</Button>}
        {canWrite && !pending && list.status === "til_kontroll" && <Button variant="outline" className="min-h-[48px]" disabled={busy} onClick={() => go("under_telling")}>Tilbake til telling</Button>}
        {canApprove && !pending && list.status === "til_kontroll" && <Button className="min-h-[48px]" disabled={busy} onClick={() => go("godkjent")}>Godkjenn liste</Button>}
        {canApprove && !pending && list.status === "godkjent" && <Button variant="outline" className="min-h-[48px]" disabled={busy} onClick={() => go("under_telling")}>Gjenåpne liste</Button>}
      </div>
      <PendingNotice op={pending} onResend={() => {
        const p = pending?.payload as { listId: string; expectedRevision: number; status: ListStatusTarget } | undefined;
        if (p) void (p.status === "godkjent" ? setApprove : set).execute(p, JSON.stringify(p)).then(r => report(r, "Listestatus oppdatert"));
      }} />
    </div>
  );
}

export function Lifecycle({ count, lists, canWrite, canApprove, complete, lineIds = [] }: { count: VtCount; lists: VtCountList[]; canWrite: boolean; canApprove: boolean; complete: boolean; lineIds?: string[] }) {
  const api = useVtApi();
  // Lokale utkast eller sendinger med ukjent utfall for denne tellingen sperrer avslutning/kontroll.
  const drafts = useDraftStore(); const pstore = usePendingStore();
  const unsynced = drafts.forCount(count.id).length + lineIds.filter(id => pstore.get(lineKey(id))).length;
  type P = { countId: string; expectedRevision: number; to: TransitionTarget; reason: string | null };
  const run = (opId: string, p: P) => api.transitionCount({ opId, ...p });
  const trW = useOpAction(`transition:${count.id}`, "write", run);
  const trA = useOpAction(`transition:${count.id}`, "approve", run);
  const [reason, setReason] = useState("");
  const allApproved = lists.length > 0 && lists.every(l => l.status === "godkjent");
  const go = (to: TransitionTarget) => {
    const p: P = { countId: count.id, expectedRevision: count.revision, to, reason: to === "avbrutt" ? reason.trim() : null };
    void (to === "avsluttet" || to === "avbrutt" ? trA : trW).execute(p, JSON.stringify(p)).then(r => report(r, "Status oppdatert"));
  };
  const pending = trW.pending; const busy = trW.busy || trA.busy;
  return (
    <Card className="space-y-3 p-4">
      <p className="font-medium">Avslutning</p>
      <p className="text-xs text-muted-foreground">Avslutning låser tellingen og rapporten. Lagerbeholdningen endres ikke — det blir en egen, senere handling.</p>
      {unsynced > 0 && <p className="text-sm text-destructive" role="alert">{unsynced} linje(r) har utkast eller sending med ukjent utfall i denne nettleseren. Lagre/avklar dem før tellingen sendes til kontroll eller avsluttes.</p>}
      {(!complete || !allApproved) && <p className="text-sm">Kan ikke avsluttes ennå: alle lister må være godkjent, alle linjer registrert, ingen må kontrolleres, og talte varer må ha pris.</p>}
      <PendingNotice op={pending} onResend={() => {
        const p = pending?.payload as P | undefined;
        if (p) void (p.to === "avsluttet" || p.to === "avbrutt" ? trA : trW).execute(p, JSON.stringify(p)).then(r => report(r, "Status oppdatert"));
      }} />
      {!pending && (
        <div className="flex flex-wrap gap-2">
          {canWrite && count.status === "pagar" && <Button variant="outline" className="min-h-[48px]" disabled={busy || unsynced > 0} onClick={() => go("til_kontroll")}>Send til kontroll</Button>}
          {canWrite && count.status === "til_kontroll" && <Button variant="outline" className="min-h-[48px]" disabled={busy} onClick={() => go("pagar")}>Tilbake til telling</Button>}
          {canApprove && <Button className="min-h-[48px]" disabled={busy || !complete || !allApproved || unsynced > 0} onClick={() => go("avsluttet")}>Avslutt telling</Button>}
        </div>
      )}
      {canApprove && !pending && (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input aria-label="Begrunnelse for avbrudd" placeholder="Begrunnelse for å avbryte" className="h-12 sm:h-10" value={reason} onChange={e => setReason(e.target.value)} />
          <Button variant="destructive" className="min-h-[48px] sm:min-h-0" disabled={busy || reason.trim().length < 3} onClick={() => go("avbrutt")}>Avbryt telling</Button>
        </div>
      )}
    </Card>
  );
}
