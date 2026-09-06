import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Trophy, Check, X, Loader2, Flag, History, Send, FileCheck, Clock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { UnitPriceHint } from "@/ravarer/components/forhandlinger/UnitPriceHint";
import { LiveTidslinjeDrawer } from "./components/LiveTidslinjeDrawer";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import {
  useNegotiation,
  useNegotiationItems,
  useNegotiationRecipients,
} from "@/ravarer/hooks/useNegotiations";
import { useRawMaterials } from "@/ravarer/hooks/useRawMaterials";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { formatDate, formatNok, formatNumber } from "@/ravarer/lib/constants";

export default function ForhandlingDetail() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { id = "" } = useParams<{ id: string }>();
  const { data: neg } = useNegotiation(id);
  const { data: items = [] } = useNegotiationItems(id);
  const { data: recipients = [] } = useNegotiationRecipients(id);
  const { data: rawMaterials = [] } = useRawMaterials();
  const { data: suppliers = [] } = useSuppliers();

  const { data: responses = [] } = useQuery({
    queryKey: ["negotiation-responses", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("negotiation_responses" as any)
        .select("*")
        .eq("negotiation_id", id);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const rmName = (rid: string) => rawMaterials.find((r) => r.id === rid)?.name ?? "—";
  const rmBaseUnit = (rid: string) => rawMaterials.find((r) => r.id === rid)?.base_unit ?? null;
  const supName = (sid: string) => suppliers.find((s) => s.id === sid)?.name ?? "—";
  const recById = (rcId: string) => recipients.find((r) => r.id === rcId);

  // Build comparison matrix: per item, per recipient
  const matrix = useMemo(() => {
    const map = new Map<string, Map<string, any>>();
    for (const it of items) map.set(it.id, new Map());
    for (const r of responses) {
      const m = map.get(r.negotiation_item_id);
      if (m) m.set(r.recipient_id, r);
    }
    return map;
  }, [items, responses]);

  // Best per item by lowest price
  const bestByItem = useMemo(() => {
    const out = new Map<string, string | null>();
    for (const it of items) {
      const offers = (responses as any[])
        .filter((r) => r.negotiation_item_id === it.id && r.offered_price != null && r.status === "submitted");
      if (offers.length === 0) { out.set(it.id, null); continue; }
      offers.sort((a, b) => a.offered_price - b.offered_price);
      out.set(it.id, offers[0].recipient_id);
    }
    return out;
  }, [items, responses]);

  // Total potential savings
  const totalSavings = useMemo(() => {
    let saved = 0;
    for (const it of items) {
      const winner = bestByItem.get(it.id);
      if (!winner || !it.actual_volume_baseline || !it.actual_cost_baseline) continue;
      const r = (responses as any[]).find((x) => x.recipient_id === winner && x.negotiation_item_id === it.id);
      if (!r?.offered_price) continue;
      const newCost = Number(it.actual_volume_baseline) * Number(r.offered_price);
      saved += Number(it.actual_cost_baseline) - newCost;
    }
    return saved;
  }, [items, responses, bestByItem]);

  // Conclusion modal
  const [concludeOpen, setConcludeOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [activating, setActivating] = useState(false);

  const isLive = (neg as any)?.negotiation_mode === "live";

  useEffect(() => {
    if (
      neg &&
      isLive &&
      neg.status !== "concluded" &&
      neg.status !== "cancelled" &&
      neg.status !== "awaiting_confirmation"
    ) {
      navigate(`/ravarer/forhandlinger/live/${id}`, { replace: true });
    }
  }, [neg, id, navigate, isLive]);

  if (!neg) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => navigate("/ravarer/forhandlinger")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Tilbake
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6 p-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/ravarer/forhandlinger")}>
        <ArrowLeft className="mr-1 h-4 w-4" /> Forhandlinger
      </Button>

      <RavarerHeaderBanner
        title={neg.title}
        subtitle={neg.purpose ?? "Forhandling"}
        actions={
          <>
            <Badge variant="outline">{neg.status}</Badge>
            {isLive && (
              <Button size="sm" variant="outline" className="rounded-full" onClick={() => setTimelineOpen(true)}>
                <History className="mr-1.5 h-4 w-4" /> Tidslinje
              </Button>
            )}
            {!isLive && (
              <Button size="sm" variant="outline" className="rounded-full"
                onClick={() => navigate(`/ravarer/forhandlinger/${id}/rediger`)}>
                Rediger
              </Button>
            )}
            {!isLive && neg.status !== "concluded" && neg.status !== "cancelled" && (
              <Button size="sm" className="rounded-full" onClick={() => setConcludeOpen(true)}>
                <Flag className="mr-1.5 h-4 w-4" /> Avslutt
              </Button>
            )}
          </>
        }
      />

      {isLive && <LiveConfirmationStatus
        neg={neg}
        items={items}
        recipients={recipients}
        rmName={rmName}
        supName={supName}
        activating={activating}
        onActivate={async (onlyConfirmed: boolean) => {
          setActivating(true);
          try {
            const targets = onlyConfirmed
              ? items.filter((i) => i.live_status === "confirmed")
              : items.filter((i) => i.live_status === "confirmed" || i.live_status === "tentatively_agreed");
            if (targets.length === 0) { toast.info("Ingen linjer å aktivere"); return; }
            const rec = recipients[0];
            const outcomes = targets.map((it: any) => ({
              negotiation_item_id: it.id,
              winner_recipient_id: rec?.id ?? null,
              winner_response_id: null,
              // Send prisen slik den ble avtalt, sammen med enheten den gjelder for.
              // Serveren regner om til pris per baseenhet — vi gjetter aldri her.
              agreed_price: it.live_agreed_price,
              agreed_price_unit: it.live_agreed_price_unit ?? null,
              agreed_package_size: it.live_agreed_package_size,
              agreed_package_unit: it.live_agreed_package_unit,
              set_as_primary: false,
              apply_to_supplier: true,
            }));
            const { data, error } = await supabase.functions.invoke("apply-negotiation-outcome", {
              body: { negotiation_id: id, outcomes },
            });
            if (error) throw error;
            if (!data?.success) throw new Error(data?.error ?? "Feil");
            // Mark unconfirmed tentative items as unconfirmed_active
            if (!onlyConfirmed) {
              await supabase
                .from("negotiation_items" as any)
                .update({ live_status: "unconfirmed_active" } as any)
                .eq("negotiation_id", id)
                .eq("live_status", "tentatively_agreed");
            }
            qc.invalidateQueries({ queryKey: ["negotiation-items", id] });
            qc.invalidateQueries({ queryKey: ["negotiation", id] });
            toast.success("Aktivert");
          } catch (e: any) {
            toast.error(e?.message ?? "Aktivering feilet");
          } finally {
            setActivating(false);
          }
        }}
      />}

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-ink-secondary">Svarfrist</p>
          <p className="mt-1 font-medium">{formatDate(neg.response_deadline)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-ink-secondary">Kontraktsperiode</p>
          <p className="mt-1 text-sm">{formatDate(neg.contract_start)} — {formatDate(neg.contract_end)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-ink-secondary">Baseline</p>
          <p className="mt-1 text-sm">{formatDate(neg.baseline_period_start)} — {formatDate(neg.baseline_period_end)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-ink-secondary">Estimert besparelse</p>
          <p className={`mt-1 font-semibold tabular-nums ${totalSavings > 0 ? "text-success" : "text-ink-primary"}`}>
            {formatNok(totalSavings)}
          </p>
        </Card>
      </div>

      {/* Recipient status */}
      <Card className="overflow-hidden">
        <div className="border-b border-line-subtle p-4 font-semibold">Mottakere ({recipients.length})</div>
        <table className="w-full text-sm">
          <thead className="bg-surface-muted/50 text-xs uppercase tracking-wide text-ink-secondary">
            <tr>
              <th className="px-4 py-2 text-left">Leverandør</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Sist sett</th>
              <th className="px-4 py-2 text-left">Utløper</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => (
              <tr key={r.id} className="border-t border-line-subtle">
                <td className="px-4 py-2 font-medium">{supName(r.supplier_id)}</td>
                <td className="px-4 py-2"><Badge variant="outline">{r.status}</Badge></td>
                <td className="px-4 py-2 text-ink-secondary">{formatDate(r.last_viewed_at)}</td>
                <td className="px-4 py-2 text-ink-secondary">{formatDate(r.expires_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Comparison matrix - only RFQ */}
      {!isLive && <Card className="overflow-x-auto">
        <div className="border-b border-line-subtle p-4 font-semibold">Tilbudssammenligning</div>
        <table className="w-full text-sm">
          <thead className="bg-surface-muted/50 text-xs uppercase tracking-wide text-ink-secondary">
            <tr>
              <th className="px-4 py-2 text-left">Råvare</th>
              <th className="px-4 py-2 text-right">Snittpris baseline</th>
              {recipients.map((r) => (
                <th key={r.id} className="px-4 py-2 text-right">{supName(r.supplier_id)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const winner = bestByItem.get(it.id);
              return (
                <tr key={it.id} className="border-t border-line-subtle">
                  <td className="px-4 py-2 font-medium">
                    <div>{rmName(it.raw_material_id)}</div>
                    <UnitPriceHint
                      rawMaterialId={it.raw_material_id}
                      pricePerBase={it.actual_avg_price_baseline == null ? null : Number(it.actual_avg_price_baseline)}
                      baseUnit={rmBaseUnit(it.raw_material_id)}
                    />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">
                    {formatNok(it.actual_avg_price_baseline)}
                  </td>
                  {recipients.map((r) => {
                    const cell = matrix.get(it.id)?.get(r.id);
                    if (!cell?.offered_price) {
                      return <td key={r.id} className="px-4 py-2 text-right text-ink-muted">—</td>;
                    }
                    const isBest = winner === r.id;
                    const better = it.actual_avg_price_baseline != null && cell.offered_price < Number(it.actual_avg_price_baseline);
                    return (
                      <td key={r.id} className={`px-4 py-2 text-right tabular-nums ${isBest ? "bg-success/10 font-semibold text-success" : better ? "text-success" : "text-destructive"}`}>
                        <div className="flex items-center justify-end gap-1">
                          {isBest && <Trophy className="h-3.5 w-3.5" />}
                          {!isBest && better && <Check className="h-3.5 w-3.5" />}
                          {!better && !isBest && <X className="h-3.5 w-3.5" />}
                          {formatNok(cell.offered_price)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>}

      <ConcludeDialog
        open={concludeOpen}
        onOpenChange={setConcludeOpen}
        items={items}
        responses={responses}
        recipients={recipients}
        bestByItem={bestByItem}
        rmName={rmName}
        supName={supName}
        negotiationId={id}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ["negotiation", id] });
          qc.invalidateQueries({ queryKey: ["negotiations"] });
          toast.success("Forhandling avsluttet");
        }}
      />

      {isLive && (
        <LiveTidslinjeDrawer
          open={timelineOpen}
          onOpenChange={setTimelineOpen}
          negotiationId={id}
          rmName={rmName}
          itemRawMaterialMap={new Map(items.map((i) => [i.id, i.raw_material_id]))}
        />
      )}
    </div>
  );
}

function LiveConfirmationStatus({ neg, items, recipients, rmName, supName, activating, onActivate }: any) {
  const tentative = items.filter((i: any) => i.live_status === "tentatively_agreed");
  const confirmed = items.filter((i: any) => i.live_status === "confirmed");
  const disputed = items.filter((i: any) => i.live_supplier_note && i.live_status === "tentatively_agreed");
  const unconfActive = items.filter((i: any) => i.live_status === "unconfirmed_active");
  const total = tentative.length + confirmed.length + unconfActive.length;
  const recipient = recipients[0];
  const deadline = neg.live_confirmation_deadline;
  const overdue = deadline && new Date(deadline) < new Date();
  const allConfirmed = tentative.length === 0;

  const mailtoBody = encodeURIComponent(
    `Hei,\n\nVennligst bekreft de avtalte prisene fra forhandlingen vår.\n\nFrist: ${deadline ? new Date(deadline).toLocaleDateString("nb-NO") : "—"}\n\nMvh.`
  );
  const mailtoSubject = encodeURIComponent(`Påminnelse: Bekreft forhandling - ${neg.title}`);

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-secondary">Bekreftelses-status</p>
          <p className="mt-1 text-lg font-semibold">
            {confirmed.length} av {total} bekreftet
            {disputed.length > 0 && <span className="ml-2 text-warning">· {disputed.length} med innsigelse</span>}
          </p>
          {deadline && (
            <p className={`mt-0.5 text-xs ${overdue ? "text-destructive" : "text-ink-secondary"}`}>
              <Clock className="mr-1 inline h-3 w-3" />
              Frist: {new Date(deadline).toLocaleDateString("nb-NO")}{overdue ? " (utløpt)" : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {recipient?.contact_email && !allConfirmed && (
            <Button asChild size="sm" variant="outline">
              <a href={`mailto:${recipient.contact_email}?subject=${mailtoSubject}&body=${mailtoBody}`}>
                <Send className="mr-1.5 h-4 w-4" /> Send påminnelse
              </a>
            </Button>
          )}
          {confirmed.length > 0 && tentative.length > 0 && neg.status !== "concluded" && (
            <Button size="sm" variant="outline" onClick={() => onActivate(true)} disabled={activating}>
              {activating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Aktiver kun bekreftede ({confirmed.length})
            </Button>
          )}
          {tentative.length > 0 && neg.status !== "concluded" && (
            <Button size="sm" onClick={() => onActivate(false)} disabled={activating}>
              {activating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Aktiver alle uansett
            </Button>
          )}
        </div>
      </div>

      <ul className="divide-y divide-line-subtle">
        {[...confirmed, ...tentative, ...unconfActive].map((it: any) => {
          const isConfirmed = it.live_status === "confirmed";
          const isUnconf = it.live_status === "unconfirmed_active";
          const hasDispute = !!it.live_supplier_note;
          return (
            <li key={it.id} className="flex items-start justify-between gap-3 py-2 text-sm">
              <div className="flex items-start gap-2">
                {isConfirmed ? (
                  <FileCheck className="mt-0.5 h-4 w-4 text-success" />
                ) : isUnconf || hasDispute ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
                ) : (
                  <Clock className="mt-0.5 h-4 w-4 text-ink-muted" />
                )}
                <div>
                  <div className="font-medium">{rmName(it.raw_material_id)}</div>
                  {it.live_supplier_note && (
                    <div className="text-xs text-warning">"{it.live_supplier_note}"</div>
                  )}
                  {it.live_datasheet_path && (
                    <div className="text-xs text-ink-muted">📎 Datablad mottatt</div>
                  )}
                  {it.live_datasheet_skipped && (
                    <div className="text-xs text-ink-muted">Datablad sendes separat</div>
                  )}
                </div>
              </div>
              <div className="text-xs text-ink-secondary">
                {isConfirmed ? "Bekreftet" : isUnconf ? "Aktivert uten bekreftelse" : "Venter"}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ConcludeDialog({
  open, onOpenChange, items, responses, recipients, bestByItem, rmName, supName, negotiationId, onSuccess,
}: any) {
  const [picks, setPicks] = useState<Record<string, { winner_recipient_id: string | null; set_as_primary: boolean; apply_to_supplier: boolean }>>({});

  // Initialise on open
  function initIfNeeded() {
    if (Object.keys(picks).length === 0 && items.length > 0) {
      const init: any = {};
      for (const it of items) {
        init[it.id] = {
          winner_recipient_id: bestByItem.get(it.id) ?? null,
          set_as_primary: false,
          apply_to_supplier: true,
        };
      }
      setPicks(init);
    }
  }
  if (open) initIfNeeded();

  const apply = useMutation({
    mutationFn: async () => {
      const outcomes = items.map((it: any) => {
        const p = picks[it.id];
        const winnerResp = (responses as any[]).find((r) => r.recipient_id === p?.winner_recipient_id && r.negotiation_item_id === it.id);
        return {
          negotiation_item_id: it.id,
          winner_recipient_id: p?.winner_recipient_id ?? null,
          winner_response_id: winnerResp?.id ?? null,
          agreed_price: winnerResp?.offered_price ?? null,
          agreed_price_unit: winnerResp?.offered_price_unit ?? null,
          agreed_package_size: winnerResp?.offered_package_size ?? null,
          agreed_package_unit: winnerResp?.offered_package_unit ?? null,
          set_as_primary: p?.set_as_primary ?? false,
          apply_to_supplier: p?.apply_to_supplier ?? false,
        };
      });
      const { data, error } = await supabase.functions.invoke("apply-negotiation-outcome", {
        body: { negotiation_id: negotiationId, outcomes },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? "Feil");
    },
    onSuccess: () => { onOpenChange(false); onSuccess(); },
    onError: (e: any) => toast.error(e?.message ?? "Avslutning feilet"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Avslutt forhandling</DialogTitle></DialogHeader>
        <div className="max-h-[60vh] overflow-auto space-y-3">
          {items.map((it: any) => {
            const p = picks[it.id] ?? { winner_recipient_id: null, set_as_primary: false, apply_to_supplier: true };
            const offers = (responses as any[]).filter((r) => r.negotiation_item_id === it.id && r.status === "submitted");
            return (
              <div key={it.id} className="rounded-md border border-line-subtle p-3">
                <div className="font-medium">{rmName(it.raw_material_id)}</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-3 sm:items-center">
                  <Select value={p.winner_recipient_id ?? "none"}
                    onValueChange={(v) => setPicks({ ...picks, [it.id]: { ...p, winner_recipient_id: v === "none" ? null : v } })}>
                    <SelectTrigger><SelectValue placeholder="Vinner" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Ingen vinner</SelectItem>
                      {offers.map((o: any) => {
                        const rec = recipients.find((rr: any) => rr.id === o.recipient_id);
                        return (
                          <SelectItem key={o.recipient_id} value={o.recipient_id}>
                            {supName(rec?.supplier_id)} — {formatNok(o.offered_price)}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={p.apply_to_supplier} onCheckedChange={(v) => setPicks({ ...picks, [it.id]: { ...p, apply_to_supplier: !!v } })} />
                    Oppdater leverandør-pris
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={p.set_as_primary} onCheckedChange={(v) => setPicks({ ...picks, [it.id]: { ...p, set_as_primary: !!v } })} />
                    Sett som primær
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={() => apply.mutate()} disabled={apply.isPending}>
            {apply.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Avslutt og lagre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
