import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, Radio, Flag, Check, Pause, Play, X, History, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import {
  useNegotiation,
  useNegotiationItems,
  useNegotiationRecipients,
  useUpdateNegotiation,
} from "@/ravarer/hooks/useNegotiations";
import {
  useAddLiveItem,
  useDeleteLiveItem,
  useLogLiveEvent,
  useUpdateLiveItem,
} from "@/ravarer/hooks/useLiveNegotiation";
import { useRawMaterials } from "@/ravarer/hooks/useRawMaterials";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { useAllRawMaterialPurchaseStats } from "@/ravarer/hooks/usePurchaseStats";
import { LiveTimer } from "./components/LiveTimer";
import { LiveItemSearch } from "./components/LiveItemSearch";
import { LiveItemCard } from "./components/LiveItemCard";
import { formatNok } from "@/ravarer/lib/constants";

export default function LiveForhandlingWorkspace() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useRavarer();

  const { data: neg } = useNegotiation(id);
  const { data: items = [] } = useNegotiationItems(id);
  const { data: recipients = [] } = useNegotiationRecipients(id);
  const { data: rawMaterials = [] } = useRawMaterials();
  const { data: suppliers = [] } = useSuppliers();
  const { data: statsMap } = useAllRawMaterialPurchaseStats();

  const addItem = useAddLiveItem();
  const updateItem = useUpdateLiveItem();
  const deleteItem = useDeleteLiveItem();
  const logEvent = useLogLiveEvent();
  const updateNeg = useUpdateNegotiation();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [deadlineDays, setDeadlineDays] = useState<string>("14");
  const [credentials, setCredentials] = useState<{ url: string; password: string; email: string | null } | null>(null);

  const supplierId = recipients[0]?.supplier_id ?? "";
  const supplierName = suppliers.find((s) => s.id === supplierId)?.name ?? "—";

  const itemsByStatus = useMemo(() => {
    const groups: Record<string, typeof items> = { pending: [], discussing: [], processed: [] };
    for (const it of items) {
      const s = it.live_status ?? "pending";
      if (s === "agreed" || s === "parked" || s === "declined" || s === "tentatively_agreed" || s === "confirmed" || s === "unconfirmed_active") {
        groups.processed.push(it);
      } else if (s === "discussing") {
        groups.discussing.push(it);
      } else {
        groups.pending.push(it);
      }
    }
    return groups;
  }, [items]);

  // Auto-select active item when none chosen
  const activeItem = useMemo(() => {
    if (activeId) return items.find((i) => i.id === activeId) ?? null;
    return itemsByStatus.discussing[0] ?? null;
  }, [items, activeId, itemsByStatus.discussing]);

  const excludeIds = useMemo(() => new Set(items.map((i) => i.raw_material_id)), [items]);

  const totalSavings = useMemo(() => {
    let saved = 0;
    for (const it of items) {
      if (
        (it.live_status !== "agreed" && it.live_status !== "tentatively_agreed" && it.live_status !== "confirmed") ||
        it.live_agreed_price_per_base_unit == null
      ) continue;
      const stats = statsMap?.get(it.raw_material_id);
      if (!stats?.avg_price_per_base_unit_12m || !stats.quantity_12m) continue;
      saved += (Number(stats.avg_price_per_base_unit_12m) - Number(it.live_agreed_price_per_base_unit)) * Number(stats.quantity_12m);
    }
    return saved;
  }, [items, statsMap]);

  const processedCount = itemsByStatus.processed.length;
  const totalCount = items.length;

  async function handleAdd(rmId: string) {
    const created: any = await addItem.mutateAsync({
      negotiation_id: id,
      raw_material_id: rmId,
      sort_order: items.length,
    });
    await logEvent.mutateAsync({
      negotiation_id: id,
      negotiation_item_id: created?.id ?? null,
      event_type: "item_added",
      event_data: { raw_material_id: rmId },
    });
    if (created?.id) setActiveId(created.id);
  }

  async function handleStartDiscuss(itemId: string) {
    await updateItem.mutateAsync({
      id: itemId,
      negotiation_id: id,
      patch: { live_status: "discussing" },
    });
    await logEvent.mutateAsync({
      negotiation_id: id,
      negotiation_item_id: itemId,
      event_type: "item_discussed",
    });
    setActiveId(itemId);
  }

  async function handleSaveActive(patch: Record<string, any>, eventType: string, eventData?: any, note?: string | null) {
    if (!activeItem) return;
    await updateItem.mutateAsync({ id: activeItem.id, negotiation_id: id, patch });
    await logEvent.mutateAsync({
      negotiation_id: id,
      negotiation_item_id: activeItem.id,
      event_type: eventType,
      event_data: eventData,
      note,
    });
    // Move to next pending
    const next = itemsByStatus.pending.find((p) => p.id !== activeItem.id);
    setActiveId(null);
    if (next) {
      await handleStartDiscuss(next.id);
    }
  }

  async function handleEndSession() {
    setEnding(true);
    try {
      const days = Math.max(1, Number(deadlineDays) || 14);
      const deadline = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      await updateNeg.mutateAsync({
        id,
        patch: {
          status: "awaiting_confirmation",
          live_session_ended_at: new Date().toISOString(),
          live_confirmation_deadline: deadline,
        } as any,
      });
      // Generate supplier credentials (reuses RFQ token mechanism)
      const { data: credRes, error: credErr } = await supabase.functions.invoke(
        "generate-rfq-credentials",
        { body: { negotiation_id: id } },
      );
      if (credErr) throw credErr;
      const cred = credRes?.credentials?.[0];
      if (cred) {
        const url = `${window.location.origin}/bekreftelse/${cred.access_token}`;
        setCredentials({ url, password: cred.password, email: cred.contact_email ?? null });
      }
      await logEvent.mutateAsync({
        negotiation_id: id,
        event_type: "session_ended",
        event_data: { processed: processedCount, total: totalCount, total_savings: totalSavings },
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Kunne ikke avslutte");
    } finally {
      setEnding(false);
    }
  }

  function summaryText() {
    const lines: string[] = [];
    lines.push(`Forhandling: ${neg?.title ?? ""}`);
    lines.push(`Leverandør: ${supplierName}`);
    lines.push("");
    lines.push("Avtalte poster (venter bekreftelse):");
    for (const it of items.filter((i) => i.live_status === "tentatively_agreed" || i.live_status === "agreed" || i.live_status === "confirmed")) {
      const rm = rawMaterials.find((r) => r.id === it.raw_material_id);
      lines.push(`- ${rm?.name ?? "?"}: ${it.live_agreed_price ?? "?"} ${it.live_agreed_price_unit ?? ""} (${it.live_agreed_contract_months ?? "?"} mnd)`);
    }
    lines.push("");
    lines.push(`Total estimert besparelse: ${formatNok(totalSavings)}/år`);
    if (credentials) {
      lines.push("");
      lines.push(`Bekreftelses-lenke: ${credentials.url}`);
      lines.push(`Passord (send i separat e-post): ${credentials.password}`);
    }
    return lines.join("\n");
  }

  if (!neg) {
    return (
      <div className="p-6">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (neg.negotiation_mode !== "live") {
    navigate(`/ravarer/forhandlinger/${id}`);
    return null;
  }

  const isEnded = !!neg.live_session_ended_at || neg.status === "concluded";

  return (
    <div className="mx-auto max-w-[1100px] space-y-5 p-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/ravarer/forhandlinger")}>
        <ArrowLeft className="mr-1 h-4 w-4" /> Forhandlinger
      </Button>

      {/* Live header */}
      <Card className="flex flex-col gap-2 border-warning/30 bg-warning/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            {!isEnded && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-75" />
            )}
            <span className={`relative inline-flex h-3 w-3 rounded-full ${isEnded ? "bg-ink-muted" : "bg-warning"}`} />
          </span>
          <div>
            <p className="text-xs uppercase tracking-wider text-warning">
              {isEnded ? "AVSLUTTET" : "LIVE FORHANDLING"}
            </p>
            <p className="font-semibold">
              {supplierName} ·{" "}
              <LiveTimer startedAt={neg.live_session_started_at} endedAt={neg.live_session_ended_at} />
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {!isEnded && (
            <Button size="sm" className="rounded-full" onClick={() => setEndOpen(true)}>
              <Flag className="mr-1.5 h-4 w-4" /> Avslutt →
            </Button>
          )}
        </div>
      </Card>

      {/* Search */}
      {!isEnded && (
        <Card className="p-4">
          <LiveItemSearch
            rawMaterials={rawMaterials}
            excludeIds={excludeIds}
            onAdd={handleAdd}
            disabled={addItem.isPending}
          />
        </Card>
      )}

      {/* Pending queue */}
      {itemsByStatus.pending.length > 0 && !activeItem && !isEnded && (
        <Card className="p-4">
          <p className="mb-3 text-xs uppercase tracking-wide text-ink-secondary">Venter diskusjon</p>
          <div className="flex flex-wrap gap-2">
            {itemsByStatus.pending.map((it) => {
              const rm = rawMaterials.find((r) => r.id === it.raw_material_id);
              return (
                <Button
                  key={it.id}
                  variant="outline"
                  size="sm"
                  onClick={() => handleStartDiscuss(it.id)}
                >
                  {rm?.name ?? "—"}
                </Button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Active card */}
      {activeItem && !isEnded && (
        <LiveItemCard
          item={activeItem}
          rawMaterial={rawMaterials.find((r) => r.id === activeItem.raw_material_id)}
          supplierId={supplierId}
          facilitatorId={user?.id ?? null}
          saving={updateItem.isPending}
          onSave={handleSaveActive}
        />
      )}

      {/* Processed list */}
      {itemsByStatus.processed.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-line-subtle px-4 py-3 text-sm font-semibold">
            Allerede behandlet ({itemsByStatus.processed.length})
          </div>
          <ul>
            {itemsByStatus.processed.map((it) => {
              const rm = rawMaterials.find((r) => r.id === it.raw_material_id);
              const stats = statsMap?.get(it.raw_material_id);
              const baseline = stats?.avg_price_per_base_unit_12m ?? null;
              const newPrice = it.live_agreed_price_per_base_unit;
              const pct =
                baseline && newPrice ? ((Number(newPrice) - Number(baseline)) / Number(baseline)) * 100 : null;
              const Icon = it.live_status === "agreed" ? Check : it.live_status === "parked" ? Pause : X;
              const cls =
                it.live_status === "agreed"
                  ? "text-success"
                  : it.live_status === "parked"
                  ? "text-warning"
                  : "text-destructive";
              return (
                <li
                  key={it.id}
                  className="flex items-center justify-between border-t border-line-subtle px-4 py-2 text-sm first:border-0"
                >
                  <span className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${cls}`} />
                    <span className="font-medium">{rm?.name ?? "—"}</span>
                  </span>
                  <span className="text-ink-secondary tabular-nums">
                    {it.live_status === "agreed" && newPrice != null ? (
                      <>
                        {formatNok(newPrice)}/{rm?.base_unit ?? "kg"}
                        {pct != null && (
                          <span className={`ml-2 ${pct < 0 ? "text-success" : "text-destructive"}`}>
                            ({pct >= 0 ? "+" : ""}
                            {pct.toFixed(1)}%)
                          </span>
                        )}
                        {it.live_agreed_contract_months && (
                          <span className="ml-2 text-ink-muted">· {it.live_agreed_contract_months} mnd</span>
                        )}
                      </>
                    ) : it.live_status === "parked" ? (
                      "Parket"
                    ) : (
                      "Avslått"
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Footer summary */}
      <Card className="flex items-center justify-between p-4 text-sm">
        <span className="text-ink-secondary">
          {processedCount} av {totalCount} råvarer behandlet
        </span>
        <span className="font-semibold tabular-nums">
          Total besparelse:{" "}
          <span className={totalSavings > 0 ? "text-success" : "text-ink-primary"}>
            {formatNok(totalSavings)}/år
          </span>
        </span>
      </Card>

      {/* End dialog */}
      <Dialog open={endOpen} onOpenChange={(o) => { setEndOpen(o); if (!o && credentials) { setCredentials(null); navigate(`/ravarer/forhandlinger/${id}`); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{credentials ? "Send bekreftelse til leverandør" : "Avslutt forhandling"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {!credentials && (
              <>
                <p>
                  Avslutter live-sesjonen og setter status til <strong>awaiting_confirmation</strong>.{" "}
                  {processedCount} av {totalCount} råvarer er behandlet med estimert besparelse{" "}
                  <strong>{formatNok(totalSavings)}/år</strong>.
                </p>
                <div>
                  <label className="text-xs text-ink-secondary">Frist for bekreftelse (dager)</label>
                  <input
                    type="number"
                    min={1}
                    value={deadlineDays}
                    onChange={(e) => setDeadlineDays(e.target.value)}
                    className="mt-1 block w-32 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </>
            )}
            {credentials && (
              <div className="space-y-2 rounded-md border border-success/30 bg-success/5 p-3 text-xs">
                <p className="font-semibold text-success">Lenke og passord generert</p>
                <p>Send til: <strong>{credentials.email ?? "—"}</strong></p>
                <p className="break-all">Lenke: <code>{credentials.url}</code></p>
                <p>Passord (separat e-post): <code className="rounded bg-surface-muted px-1 py-0.5">{credentials.password}</code></p>
              </div>
            )}
            <Card className="max-h-48 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs">
              {summaryText()}
            </Card>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(summaryText());
                  toast.success("Kopiert");
                }}
              >
                Kopier sammendrag
              </Button>
              {recipients[0]?.contact_email && credentials && (
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`mailto:${recipients[0].contact_email}?subject=${encodeURIComponent(
                      "Bekreftelse av avtaler: " + (neg.title ?? "")
                    )}&body=${encodeURIComponent(summaryText())}`}
                  >
                    Send på e-post
                  </a>
                </Button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEndOpen(false)}>
              {credentials ? "Lukk" : "Avbryt"}
            </Button>
            {!credentials && (
              <Button onClick={handleEndSession} disabled={ending}>
                {ending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Avslutt og generer lenke
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
