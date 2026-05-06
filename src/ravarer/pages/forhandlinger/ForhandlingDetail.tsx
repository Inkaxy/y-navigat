import { useParams, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
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
  const { id } = useParams<{ id: string }>();
  const { data: neg } = useNegotiation(id);
  const { data: items = [] } = useNegotiationItems(id);
  const { data: recipients = [] } = useNegotiationRecipients(id);
  const { data: rawMaterials = [] } = useRawMaterials();
  const { data: suppliers = [] } = useSuppliers();

  const rmName = (rid: string) => rawMaterials.find((r) => r.id === rid)?.name ?? "—";
  const supName = (sid: string) => suppliers.find((s) => s.id === sid)?.name ?? "—";

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
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => navigate(`/ravarer/forhandlinger/${id}/rediger`)}
            >
              Rediger
            </Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-ink-secondary">Svarfrist</p>
          <p className="mt-1 font-medium">{formatDate(neg.response_deadline)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-ink-secondary">Kontraktsperiode</p>
          <p className="mt-1 font-medium">
            {formatDate(neg.contract_start)} — {formatDate(neg.contract_end)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-ink-secondary">Baseline</p>
          <p className="mt-1 font-medium">
            {formatDate(neg.baseline_period_start)} — {formatDate(neg.baseline_period_end)}
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-line-subtle p-4 font-semibold">Råvarer ({items.length})</div>
        <table className="w-full text-sm">
          <thead className="bg-surface-muted/50 text-xs uppercase tracking-wide text-ink-secondary">
            <tr>
              <th className="px-4 py-2 text-left">Råvare</th>
              <th className="px-4 py-2 text-right">Forventet volum</th>
              <th className="px-4 py-2 text-right">Baseline kostnad</th>
              <th className="px-4 py-2 text-right">Snittpris</th>
              <th className="px-4 py-2 text-right">Mål-pris</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t border-line-subtle">
                <td className="px-4 py-2 font-medium">{rmName(it.raw_material_id)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatNumber(it.expected_annual_volume)} {it.expected_annual_volume_unit ?? ""}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNok(it.actual_cost_baseline)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNok(it.actual_avg_price_baseline)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNok(it.target_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-line-subtle p-4 font-semibold">Mottakere ({recipients.length})</div>
        <table className="w-full text-sm">
          <thead className="bg-surface-muted/50 text-xs uppercase tracking-wide text-ink-secondary">
            <tr>
              <th className="px-4 py-2 text-left">Leverandør</th>
              <th className="px-4 py-2 text-left">E-post</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Sist sett</th>
              <th className="px-4 py-2 text-left">Utløper</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => (
              <tr key={r.id} className="border-t border-line-subtle">
                <td className="px-4 py-2 font-medium">{supName(r.supplier_id)}</td>
                <td className="px-4 py-2 text-ink-secondary">{r.contact_email ?? "—"}</td>
                <td className="px-4 py-2">
                  <Badge variant="outline">{r.status}</Badge>
                </td>
                <td className="px-4 py-2 text-ink-secondary">{formatDate(r.last_viewed_at)}</td>
                <td className="px-4 py-2 text-ink-secondary">{formatDate(r.expires_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
