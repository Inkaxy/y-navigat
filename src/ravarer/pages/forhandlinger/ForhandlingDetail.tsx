import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Flag, Handshake, History, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QueryState } from "@/components/common/QueryState";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { DataTable, type Column } from "@/ravarer/ui/DataTable";
import { NegotiationStatusPill, RecipientStatusPill } from "@/ravarer/components/forhandlinger/NegotiationPills";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import {
  useNegotiation,
  useNegotiationItems,
  useNegotiationRecipients,
  useNegotiationResponses,
  type NegotiationRecipientRow,
} from "@/ravarer/hooks/useNegotiations";
import { useRawMaterials } from "@/ravarer/hooks/useRawMaterials";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { formatDate, formatNok } from "@/ravarer/lib/constants";
import { bestOfferRecipient, isNegotiationClosed, offerPricePerBaseUnit } from "@/ravarer/lib/negotiationMatrix";
import { estimateSavings, negotiationListReturn } from "@/ravarer/lib/negotiationOps";
import { paths } from "@/ravarer/lib/paths";
import { LiveTidslinjeDrawer } from "./components/LiveTidslinjeDrawer";
import { ConcludeDialog } from "./detail/ConcludeDialog";
import { LiveConfirmationStatus } from "./detail/LiveConfirmationStatus";
import { OfferComparison } from "./detail/OfferComparison";
import { SavingsValue } from "./detail/SavingsValue";

function Kpi({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="p-3 sm:p-4">
      <p className="text-caption uppercase tracking-wide text-ink-secondary">{label}</p>
      <div className="mt-1 text-sm">{children}</div>
    </Card>
  );
}

export default function ForhandlingDetail() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { id = "" } = useParams<{ id: string }>();
  const rights = useInvoiceRights();
  const [params] = useSearchParams();
  const listHref = negotiationListReturn(params.get("retur"));
  const negQ = useNegotiation(id);
  // Barn hentes bare når forelderen er lest i gjeldende selskap.
  const parentOk = !!negQ.data;
  const itemsQ = useNegotiationItems(id, { enabled: parentOk });
  const recipientsQ = useNegotiationRecipients(id, { enabled: parentOk });
  const responsesQ = useNegotiationResponses(id, { enabled: parentOk });
  const { data: rawMaterials = [] } = useRawMaterials();
  const { data: suppliers = [] } = useSuppliers();
  const neg = negQ.data ?? null;
  const items = useMemo(() => itemsQ.data ?? [], [itemsQ.data]);
  const recipients = useMemo(() => recipientsQ.data ?? [], [recipientsQ.data]);
  const responses = useMemo(() => responsesQ.data ?? [], [responsesQ.data]);

  const rmById = useMemo(() => new Map(rawMaterials.map((r) => [r.id, r])), [rawMaterials]);
  const rmName = (rid: string) => rmById.get(rid)?.name ?? "—";
  const rmBaseUnit = (rid: string) => rmById.get(rid)?.base_unit ?? null;
  const rmCost = (rid: string) => { const c = rmById.get(rid)?.current_cost_price; return c == null ? null : Number(c); };
  const supName = (sid: string) => suppliers.find((s) => s.id === sid)?.name ?? "—";

  const responseIndex = useMemo(() => {
    const m = new Map<string, (typeof responses)[number]>();
    for (const r of responses) m.set(`${r.negotiation_item_id}:${r.recipient_id}`, r);
    return m;
  }, [responses]);

  /** Alle tilbud regnes om til pris per grunnenhet før sammenligning; ukjent pakning = null. */
  const perBaseByItem = useMemo(() => {
    const out = new Map<string, Map<string, number | null>>();
    for (const it of items) {
      const rm = rmById.get(it.raw_material_id);
      const inner = new Map<string, number | null>();
      for (const r of responses) {
        if (r.negotiation_item_id !== it.id || r.status !== "submitted") continue;
        inner.set(r.recipient_id, offerPricePerBaseUnit({
          offeredPrice: r.offered_price,
          offeredPackageSize: r.offered_package_size,
          offeredPackageUnit: r.offered_package_unit,
          baseUnit: rm?.base_unit ?? null,
          // Råvarens globale pakningstall er ikke leverandørens bekreftede pakning — sendes ikke.
        }).value);
      }
      out.set(it.id, inner);
    }
    return out;
  }, [items, responses, rmById]);

  const bestByItem = useMemo(() => {
    const out = new Map<string, string | null>();
    for (const it of items) {
      const offers = Array.from(perBaseByItem.get(it.id)?.entries() ?? []).map(([recipientId, pricePerBaseUnit]) => ({ recipientId, pricePerBaseUnit }));
      out.set(it.id, bestOfferRecipient(offers));
    }
    return out;
  }, [items, perBaseByItem]);

  const savings = useMemo(() => estimateSavings(items.map((it) => {
    const winner = bestByItem.get(it.id) ?? null;
    return {
      hasWinner: !!winner || (perBaseByItem.get(it.id)?.size ?? 0) > 0,
      winnerPerBase: winner ? perBaseByItem.get(it.id)?.get(winner) ?? null : null,
      volumeBaseline: it.actual_volume_baseline,
      costBaseline: it.actual_cost_baseline,
    };
  })), [items, bestByItem, perBaseByItem]);

  const [concludeOpen, setConcludeOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const isLive = neg?.negotiation_mode === "live";

  useEffect(() => {
    if (neg && isLive && neg.status !== "concluded" && neg.status !== "cancelled" && neg.status !== "awaiting_confirmation") {
      navigate(paths.liveForhandling(id), { replace: true });
    }
  }, [neg, id, navigate, isLive]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["negotiation", id] });
    qc.invalidateQueries({ queryKey: ["negotiations"] });
    qc.invalidateQueries({ queryKey: ["negotiation-items", id] });
    invalidateRawMaterial(qc);
  };

  const back = (
    <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => navigate(listHref)}>
      <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Forhandlinger
    </Button>
  );

  if (!neg) {
    return (
      <div className="mx-auto max-w-[1280px] space-y-4 p-4 sm:p-6">
        {back}
        <QueryState
          scope="ravarer:forhandling"
          isLoading={negQ.isLoading}
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

  const recipientColumns: Column<NegotiationRecipientRow>[] = [
    { id: "sup", header: "Leverandør", alwaysVisible: true, cell: (r) => <span className="font-medium">{supName(r.supplier_id)}</span> },
    { id: "status", header: "Status", cell: (r) => <RecipientStatusPill status={r.status} /> },
    { id: "seen", header: "Sist sett", cell: (r) => formatDate(r.last_viewed_at) },
    { id: "exp", header: "Lenken utløper", cell: (r) => formatDate(r.expires_at) },
  ];

  return (
    <div className="mx-auto max-w-[1280px] space-y-4 p-4 sm:p-6">
      {back}
      <ModulePage
        eyebrow={isLive ? "Live-forhandling" : "Forespørsel"}
        title={neg.title}
        subtitle={neg.purpose ?? undefined}
        icon={Handshake}
        embedsPage={false}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <NegotiationStatusPill status={neg.status} />
            {isLive && (
              <Button size="sm" variant="outline" className="min-h-[44px] rounded-full" onClick={() => setTimelineOpen(true)}>
                <History className="mr-1.5 h-4 w-4" aria-hidden /> Tidslinje
              </Button>
            )}
            {rights.canWrite && !isLive && !isNegotiationClosed(neg.status) && (
              <Button size="sm" variant="outline" className="min-h-[44px] rounded-full" onClick={() => navigate(paths.forhandlingRediger(id))}>
                <Pencil className="mr-1.5 h-4 w-4" aria-hidden /> Rediger
              </Button>
            )}
            {rights.canWrite && !isLive && !isNegotiationClosed(neg.status) && (
              <Button size="sm" className="min-h-[44px] rounded-full" onClick={() => setConcludeOpen(true)}>
                <Flag className="mr-1.5 h-4 w-4" aria-hidden /> Avslutt
              </Button>
            )}
          </div>
        }
      >
        {isLive && (
          <LiveConfirmationStatus neg={neg} items={items} recipients={recipients} rmName={rmName} supName={supName} canWrite={rights.canWrite} />
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Svarfrist">{formatDate(neg.response_deadline)}</Kpi>
          <Kpi label="Kontraktsperiode">{formatDate(neg.contract_start)} – {formatDate(neg.contract_end)}</Kpi>
          <Kpi label="Baseline">{formatDate(neg.baseline_period_start)} – {formatDate(neg.baseline_period_end)}</Kpi>
          <Kpi label="Estimert besparelse">
            <SavingsValue
              loading={itemsQ.isLoading || responsesQ.isLoading || !itemsQ.data || !responsesQ.data}
              failed={itemsQ.isError || responsesQ.isError}
              known={savings.known}
              unknown={savings.unknown}
              value={savings.value}
            />
          </Kpi>
        </div>

        <section className="space-y-2" aria-labelledby="mottakere">
          <h2 id="mottakere" className="font-semibold">Mottakere ({recipients.length})</h2>
          <DataTable
            ariaLabel="Mottakere"
            rows={recipients}
            columns={recipientColumns}
            getId={(r) => r.id}
            isLoading={recipientsQ.isLoading}
            error={recipientsQ.error}
            onRetry={() => void recipientsQ.refetch()}
            emptyText="Ingen leverandører er lagt til."
            renderMobileCard={(r) => (
              <div className="space-y-1 rounded-lg border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{supName(r.supplier_id)}</span>
                  <RecipientStatusPill status={r.status} />
                </div>
                <div className="text-caption text-ink-secondary">Sist sett {formatDate(r.last_viewed_at)} · Utløper {formatDate(r.expires_at)}</div>
              </div>
            )}
          />
        </section>

        {!isLive && (
          <QueryState
            scope="ravarer:forhandling-tilbud"
            isLoading={itemsQ.isLoading || responsesQ.isLoading}
            isError={itemsQ.isError || responsesQ.isError}
            error={itemsQ.error ?? responsesQ.error}
            onRetry={() => { void itemsQ.refetch(); void responsesQ.refetch(); }}
          >
            <OfferComparison
              items={items}
              recipients={recipients}
              responseFor={(i, r) => responseIndex.get(`${i}:${r}`)}
              perBase={(i, r) => perBaseByItem.get(i)?.get(r) ?? null}
              bestByItem={bestByItem}
              rmName={rmName}
              rmBaseUnit={rmBaseUnit}
              rmCost={rmCost}
              supName={supName}
            />
          </QueryState>
        )}
      </ModulePage>

      <ConcludeDialog
        open={concludeOpen}
        onOpenChange={setConcludeOpen}
        items={items}
        responses={responses}
        recipients={recipients}
        bestByItem={bestByItem}
        rmName={rmName}
        rmBaseUnit={rmBaseUnit}
        supName={supName}
        negotiationId={id}
        onRefresh={refresh}
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
