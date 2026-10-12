import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Flag, History, Pause, Play, Radio, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { negotiationListReturn } from "@/ravarer/lib/negotiationOps";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryState } from "@/components/common/QueryState";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { useNegotiation, useNegotiationItems, useNegotiationRecipients, useUpdateNegotiation } from "@/ravarer/hooks/useNegotiations";
import { useAddLiveItem, useLogLiveEvent, useUpdateLiveItem, type LiveItemPatch } from "@/ravarer/hooks/useLiveNegotiation";
import { useRawMaterials } from "@/ravarer/hooks/useRawMaterials";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { useAllRawMaterialPurchaseStats } from "@/ravarer/hooks/usePurchaseStats";
import { NegotiationStatusPill, LiveItemStatusPill } from "@/ravarer/components/forhandlinger/NegotiationPills";
import { UnitPriceHint } from "@/ravarer/components/forhandlinger/UnitPriceHint";
import { baselineFromStats, estimateSavings } from "@/ravarer/lib/negotiationOps";
import { formatNok } from "@/ravarer/lib/constants";
import { paths } from "@/ravarer/lib/paths";
import { LiveTimer } from "./components/LiveTimer";
import { LiveItemSearch } from "./components/LiveItemSearch";
import { LiveItemCard } from "./components/LiveItemCard";
import { LiveTidslinjeDrawer } from "./components/LiveTidslinjeDrawer";
import { EndSessionDialog } from "./components/EndSessionDialog";

const PROCESSED = new Set(["agreed", "parked", "declined", "tentatively_agreed", "confirmed", "unconfirmed_active"]);
const AGREED = new Set(["agreed", "tentatively_agreed", "confirmed"]);
const REOPENABLE = new Set(["agreed", "tentatively_agreed", "parked", "declined"]);

function errText(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}

export default function LiveForhandlingWorkspace() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const { user, legalEntityId } = useRavarer();
  const rights = useInvoiceRights();

  const negQ = useNegotiation(id);
  const neg = negQ.data ?? null;
  const { data: items = [] } = useNegotiationItems(id);
  const { data: recipients = [] } = useNegotiationRecipients(id);
  const { data: rawMaterials = [] } = useRawMaterials();
  const { data: suppliers = [] } = useSuppliers();
  const { data: statsMap } = useAllRawMaterialPurchaseStats();

  const addItem = useAddLiveItem();
  const updateItem = useUpdateLiveItem();
  const logEvent = useLogLiveEvent();
  const updateNeg = useUpdateNegotiation();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [pausing, setPausing] = useState(false);
  const pauseLock = useRef(false);

  const supName = (sid: string) => suppliers.find((s) => s.id === sid)?.name ?? "";
  const rmById = useMemo(() => new Map(rawMaterials.map((r) => [r.id, r])), [rawMaterials]);
  const supplierNames = recipients.map((r) => supName(r.supplier_id)).filter((n) => !!n);
  const supplierName = supplierNames.length > 0 ? supplierNames.join(", ") : "—";
  const isPaused = !!neg?.live_session_paused;

  // Hvilken mottaker prisene og bekreftelsen gjelder (aldri automatisk den første ved flere).
  const [activeRecipientId, setActiveRecipientId] = useState<string>("");
  useEffect(() => { setActiveRecipientId(""); setActiveId(null); }, [id, legalEntityId]);
  const selectedRecipient = recipients.find((r) => r.id === activeRecipientId) ?? (recipients.length === 1 ? recipients[0] : undefined);
  const supplierId = selectedRecipient?.supplier_id ?? "";

  /**
   * Live-flaten må vise det andre i rommet gjør: realtime på forhandling, linjer og
   * hendelser, med oppfriskning hvert 30. sekund som reserve når kanalen ikke er tilkoblet.
   * Kanalen fjernes ved bytte av forhandling og ved avmontering.
   */
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  useEffect(() => {
    if (!id) return;
    let connected = false;
    const channel = supabase
      .channel(`live-negotiation-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "negotiations", filter: `id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["negotiation", id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "negotiation_items", filter: `negotiation_id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["negotiation-items", id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "negotiation_live_events", filter: `negotiation_id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["negotiation-live-events", id] });
        qc.invalidateQueries({ queryKey: ["negotiation", id] });
      })
      .subscribe((status) => {
        connected = status === "SUBSCRIBED";
        setRealtimeConnected(connected);
      });
    const fallback = window.setInterval(() => {
      if (connected) return;
      qc.invalidateQueries({ queryKey: ["negotiation-items", id] });
      qc.invalidateQueries({ queryKey: ["negotiation", id] });
    }, 30000);
    return () => {
      window.clearInterval(fallback);
      supabase.removeChannel(channel);
    };
  }, [id, qc]);

  const itemsByStatus = useMemo(() => {
    const groups = { pending: [] as typeof items, discussing: [] as typeof items, processed: [] as typeof items };
    for (const it of items) {
      const s = it.live_status ?? "pending";
      if (PROCESSED.has(s)) groups.processed.push(it);
      else if (s === "discussing") groups.discussing.push(it);
      else groups.pending.push(it);
    }
    return groups;
  }, [items]);

  const activeItem = useMemo(() => {
    if (activeId) return items.find((i) => i.id === activeId) ?? null;
    return itemsByStatus.discussing[0] ?? null;
  }, [items, activeId, itemsByStatus.discussing]);

  const excludeIds = useMemo(() => new Set(items.map((i) => i.raw_material_id)), [items]);

  /** Besparelse: snittpris − avtalt pris per grunnenhet × volum i grunnenhet. Ukjent grunnlag telles som ukjent. */
  const savings = useMemo(() => estimateSavings(items.filter((it) => AGREED.has(it.live_status ?? "")).map((it) => {
    const s = statsMap?.get(it.raw_material_id);
    const b = s ? baselineFromStats(s) : null;
    return {
      hasWinner: true,
      winnerPerBase: it.live_agreed_price_per_base_unit,
      volumeBaseline: b?.volume ?? null,
      costBaseline: b?.cost ?? null,
    };
  })), [items, statsMap]);
  const savingsValue = savings.known === 0 && savings.unknown > 0 ? null : savings.value;

  const processedCount = itemsByStatus.processed.length;
  const totalCount = items.length;

  async function guarded(fn: () => Promise<void>, fallback: string) {
    try { await fn(); } catch (e) { toast.error(errText(e, fallback)); }
  }

  const handleAdd = (rmId: string) => guarded(async () => {
    const created = await addItem.mutateAsync({ negotiation_id: id, raw_material_id: rmId, sort_order: items.length });
    await logEvent.mutateAsync({ negotiation_id: id, negotiation_item_id: created.id, event_type: "item_added", event_data: { raw_material_id: rmId } });
    setActiveId(created.id);
  }, "Kunne ikke legge til");

  async function startDiscuss(itemId: string) {
    await updateItem.mutateAsync({ id: itemId, negotiation_id: id, patch: { live_status: "discussing" } });
    await logEvent.mutateAsync({ negotiation_id: id, negotiation_item_id: itemId, event_type: "item_discussed" });
    setActiveId(itemId);
  }
  const handleStartDiscuss = (itemId: string) => guarded(() => startDiscuss(itemId), "Kunne ikke starte diskusjon");

  async function handleSaveActive(patch: LiveItemPatch, eventType: string, eventData?: Json, note?: string | null) {
    if (!activeItem) return;
    const current = activeItem;
    await guarded(async () => {
      await updateItem.mutateAsync({ id: current.id, negotiation_id: id, patch });
      await logEvent.mutateAsync({ negotiation_id: id, negotiation_item_id: current.id, event_type: eventType, event_data: eventData ?? null, note });
      const next = itemsByStatus.pending.find((p) => p.id !== current.id);
      setActiveId(null);
      if (next) await startDiscuss(next.id);
    }, "Kunne ikke lagre");
  }

  async function handleTogglePause() {
    if (pauseLock.current) return;
    pauseLock.current = true;
    setPausing(true);
    try {
      const next = !isPaused;
      await updateNeg.mutateAsync({ id, patch: { live_session_paused: next } });
      await logEvent.mutateAsync({ negotiation_id: id, event_type: next ? "session_paused" : "session_resumed" });
    } catch (e) {
      toast.error(errText(e, "Kunne ikke pause"));
    } finally {
      pauseLock.current = false;
      setPausing(false);
    }
  }

  const handleReopen = (itemId: string) => guarded(async () => {
    await updateItem.mutateAsync({ id: itemId, negotiation_id: id, patch: { live_status: "discussing" } });
    await logEvent.mutateAsync({ negotiation_id: id, negotiation_item_id: itemId, event_type: "item_reopened" });
    setActiveId(itemId);
  }, "Kunne ikke gjenåpne");

  function summaryLines(supplierLabel: string): string[] {
    const lines = [`Forhandling: ${neg?.title ?? ""}`, `Leverandør: ${supplierLabel}`, "", "Avtalte poster (venter bekreftelse):"];
    for (const it of items.filter((i) => AGREED.has(i.live_status ?? ""))) {
      const rm = rmById.get(it.raw_material_id);
      const unit = it.live_agreed_price_unit ? `kr/${it.live_agreed_price_unit}` : "ukjent enhet";
      lines.push(`- ${rm?.name ?? "?"}: ${it.live_agreed_price ?? "?"} ${unit} (${it.live_agreed_contract_months ?? "?"} mnd)`);
    }
    lines.push("", `Total estimert besparelse: ${savingsValue == null ? "ukjent" : `${formatNok(savingsValue)}/år`}`);
    return lines;
  }

  useEffect(() => {
    if (neg && neg.negotiation_mode !== "live") navigate(paths.forhandling(id), { replace: true });
  }, [neg, id, navigate]);

  const back = (
    <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => navigate(negotiationListReturn(searchParams.get("retur")))}>
      <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Forhandlinger
    </Button>
  );

  if (!neg || neg.negotiation_mode !== "live") {
    return (
      <div className="mx-auto max-w-[1100px] space-y-4 p-4 sm:p-6">
        {back}
        <QueryState
          scope="ravarer:live-forhandling"
          isLoading={negQ.isLoading || (!!neg && neg.negotiation_mode !== "live")}
          isError={negQ.isError}
          error={negQ.error}
          onRetry={() => void negQ.refetch()}
          isEmpty
          emptyTitle="Fant ikke forhandlingen"
          emptyDescription="Den finnes ikke, tilhører et annet selskap, eller du mangler tilgang."
        >
          {null}
        </QueryState>
      </div>
    );
  }

  const isEnded = !!neg.live_session_ended_at || neg.status === "concluded";
  const canEdit = rights.canWrite && !isEnded;

  return (
    <div className="mx-auto max-w-[1100px] space-y-4 p-4 sm:p-6">
      {back}
      <ModulePage
        eyebrow={isEnded ? "Live-forhandling · avsluttet" : "Live-forhandling"}
        title={neg.title}
        icon={Radio}
        embedsPage={false}
        compact
        actions={<NegotiationStatusPill status={neg.status} />}
      >
        <Card className="flex flex-col gap-3 border-warning/30 bg-warning/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative flex h-3 w-3 shrink-0" aria-hidden>
              {!isEnded && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-75" />}
              <span className={`relative inline-flex h-3 w-3 rounded-full ${isEnded ? "bg-ink-muted" : "bg-warning"}`} />
            </span>
            <div className="min-w-0">
              <p className="break-words font-semibold">
                {supplierName} · <LiveTimer startedAt={neg.live_session_started_at} endedAt={neg.live_session_ended_at} />
              </p>
              <p className="mt-0.5 text-caption text-ink-muted">
                Sanntid: {realtimeConnected ? "tilkoblet" : "frakoblet (oppdateres hvert 30. sekund)"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="min-h-[44px] rounded-full" onClick={() => setTimelineOpen(true)}>
              <History className="mr-1.5 h-4 w-4" aria-hidden /> Tidslinje
            </Button>
            {canEdit && (
              <Button size="sm" variant="outline" className="min-h-[44px] rounded-full" onClick={() => void handleTogglePause()} disabled={pausing}>
                {isPaused ? <Play className="mr-1.5 h-4 w-4" aria-hidden /> : <Pause className="mr-1.5 h-4 w-4" aria-hidden />}
                {isPaused ? "Gjenoppta" : "Pause"}
              </Button>
            )}
            {canEdit && (
              <Button size="sm" className="min-h-[44px] rounded-full" onClick={() => setEndOpen(true)}>
                <Flag className="mr-1.5 h-4 w-4" aria-hidden /> Avslutt
              </Button>
            )}
          </div>
        </Card>

        {!rights.loading && !rights.canWrite && (
          <p role="status" className="rounded-md border border-line-subtle bg-surface-muted p-3 text-sm text-ink-secondary">
            Du har lesetilgang. Registrering i møtet krever skrivetilgang til fakturaer i Råvarer.
          </p>
        )}

        {isPaused && !isEnded && (
          <p role="status" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            Møtet er pauset. Trykk «Gjenoppta» når dere er tilbake.
          </p>
        )}

        {recipients.length > 1 && (
          <Card className="p-4">
            <label htmlFor="live-recipient" className="text-caption uppercase tracking-wide text-ink-secondary">Hvilken leverandør gjelder prisene for?</label>
            <Select value={activeRecipientId} onValueChange={setActiveRecipientId}>
              <SelectTrigger id="live-recipient" className="mt-1 min-h-[44px] max-w-xs" aria-label="Leverandør avtalen gjelder">
                <SelectValue placeholder="Velg leverandør" />
              </SelectTrigger>
              <SelectContent>
                {recipients.map((r) => <SelectItem key={r.id} value={r.id}>{supName(r.supplier_id) || "—"}</SelectItem>)}
              </SelectContent>
            </Select>
          </Card>
        )}

        {canEdit && (
          <Card className="p-4">
            <LiveItemSearch rawMaterials={rawMaterials} excludeIds={excludeIds} onAdd={(rm) => void handleAdd(rm)} disabled={addItem.isPending} />
          </Card>
        )}

        {itemsByStatus.pending.length > 0 && !activeItem && canEdit && (
          <Card className="p-4">
            <p className="mb-3 text-caption uppercase tracking-wide text-ink-secondary">Venter på diskusjon</p>
            <div className="flex flex-wrap gap-2">
              {itemsByStatus.pending.map((it) => (
                <Button key={it.id} variant="outline" size="sm" className="min-h-[44px]" onClick={() => void handleStartDiscuss(it.id)}>
                  {rmById.get(it.raw_material_id)?.name ?? "—"}
                </Button>
              ))}
            </div>
          </Card>
        )}

        {activeItem && canEdit && (
          <LiveItemCard
            item={activeItem}
            rawMaterial={rmById.get(activeItem.raw_material_id)}
            supplierId={supplierId}
            facilitatorId={user?.id ?? null}
            saving={updateItem.isPending}
            onSave={handleSaveActive}
          />
        )}

        {itemsByStatus.processed.length > 0 && (
          <Card className="overflow-hidden">
            <div className="border-b border-line-subtle px-4 py-3 text-sm font-semibold">Allerede behandlet ({itemsByStatus.processed.length})</div>
            <ul>
              {itemsByStatus.processed.map((it) => {
                const rm = rmById.get(it.raw_material_id);
                const unit = rm?.base_unit ?? null;
                const baseline = statsMap?.get(it.raw_material_id)?.avg_price_per_base_unit_12m ?? null;
                const newPrice = it.live_agreed_price_per_base_unit;
                const pct = baseline && newPrice != null ? ((newPrice - baseline) / baseline) * 100 : null;
                const reopenable = canEdit && REOPENABLE.has(it.live_status ?? "");
                const name = rm?.name ?? "—";
                return (
                  <li key={it.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line-subtle px-4 py-2 text-sm first:border-0">
                    <span className="min-w-0">
                      <span className="font-medium">{name}</span>
                      <span className="block"><UnitPriceHint rawMaterialId={it.raw_material_id} pricePerBase={newPrice ?? baseline} baseUnit={unit} /></span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 tabular-nums text-ink-secondary">
                      {AGREED.has(it.live_status ?? "") && newPrice != null ? (
                        <span>
                          {formatNok(newPrice)}/{unit ?? "grunnenhet"}
                          {pct != null && <span className={`ml-2 ${pct < 0 ? "text-success" : "text-destructive"}`}>({pct >= 0 ? "+" : ""}{pct.toFixed(1)} %)</span>}
                          {it.live_agreed_contract_months != null && <span className="ml-2 text-ink-muted">· {it.live_agreed_contract_months} mnd</span>}
                        </span>
                      ) : AGREED.has(it.live_status ?? "") ? (
                        <span>Pris per grunnenhet ukjent</span>
                      ) : null}
                      <LiveItemStatusPill status={it.live_status} />
                      {reopenable && (
                        <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px]" aria-label={`Gjenåpne ${name}`} onClick={() => void handleReopen(it.id)}>
                          <RotateCcw className="h-4 w-4" aria-hidden />
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <Card className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
          <span className="text-ink-secondary">{processedCount} av {totalCount} råvarer behandlet</span>
          <span className="font-semibold tabular-nums">
            Total besparelse:{" "}
            <span className={savingsValue != null && savingsValue > 0 ? "text-success" : "text-ink-primary"}>
              {savingsValue == null ? "ukjent" : `${formatNok(savingsValue)}/år`}
            </span>
            {savings.unknown > 0 && savingsValue != null && <span className="block text-caption font-normal text-ink-secondary">{savings.unknown} avtale(r) med ukjent grunnlag er ikke regnet med</span>}
          </span>
        </Card>
      </ModulePage>

      <EndSessionDialog
        open={endOpen}
        onOpenChange={(o, hadCredentials) => {
          setEndOpen(o);
          if (!o && hadCredentials) navigate(paths.forhandling(id));
        }}
        negotiationId={id}
        legalEntityId={legalEntityId}
        title={neg.title}
        recipients={recipients}
        selectedRecipient={selectedRecipient}
        supplierName={supName}
        summaryLines={summaryLines}
        processedCount={processedCount}
        totalCount={totalCount}
        savingsValue={savingsValue}
      />

      <LiveTidslinjeDrawer
        open={timelineOpen}
        onOpenChange={setTimelineOpen}
        negotiationId={id}
        rmName={(rid) => rmById.get(rid)?.name ?? "—"}
        itemRawMaterialMap={new Map(items.map((i) => [i.id, i.raw_material_id]))}
      />
    </div>
  );
}
