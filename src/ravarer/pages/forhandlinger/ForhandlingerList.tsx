import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Loader2, Handshake, Radio } from "lucide-react";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { useNegotiations, type NegotiationStatus } from "@/ravarer/hooks/useNegotiations";
import { formatDate } from "@/ravarer/lib/constants";
import NewNegotiationTypeDialog from "./NewNegotiationTypeDialog";

const STATUS_META: Record<NegotiationStatus, { label: string; cls: string }> = {
  draft: { label: "Kladd", cls: "border-line-strong bg-surface-muted text-ink-secondary" },
  invited: { label: "Sendt ut", cls: "border-primary/30 bg-primary/10 text-primary" },
  in_progress: { label: "Pågår", cls: "border-warning/30 bg-warning/10 text-warning" },
  awaiting_confirmation: { label: "Venter bekreftelse", cls: "border-primary/30 bg-primary/10 text-primary" },
  concluded: { label: "Avsluttet", cls: "border-success/30 bg-success/10 text-success" },
  cancelled: { label: "Kansellert", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
};

export default function ForhandlingerList() {
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: rows = [], isLoading } = useNegotiations();

  function openNegotiation(n: any) {
    if (n.negotiation_mode === "live" && n.status !== "concluded" && n.status !== "cancelled") {
      navigate(`/ravarer/forhandlinger/live/${n.id}`);
    } else {
      navigate(`/ravarer/forhandlinger/${n.id}`);
    }
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6 p-6">
      <RavarerHeaderBanner
        title="Forhandlinger"
        subtitle="Forbered, send og sammenlign tilbud fra leverandører"
        actions={
          <Button size="sm" className="rounded-full" onClick={() => setPickerOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Ny forhandling
          </Button>
        }
      />

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-ink-secondary">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted">
              <Handshake className="h-5 w-5 text-ink-secondary" />
            </div>
            <div>
              <p className="font-medium text-ink-primary">Ingen forhandlinger ennå</p>
              <p className="text-sm text-ink-secondary">Kom i gang med din første forhandling.</p>
            </div>
            <Button size="sm" className="rounded-full" onClick={() => setPickerOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Ny forhandling
            </Button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-muted/50 text-xs uppercase tracking-wide text-ink-secondary">
              <tr>
                <th className="px-4 py-3 text-left">Tittel</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Frist</th>
                <th className="px-4 py-3 text-left">Opprettet</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => (
                <tr
                  key={n.id}
                  onClick={() => openNegotiation(n)}
                  className="cursor-pointer border-t border-line-subtle hover:bg-surface-muted/40"
                >
                  <td className="px-4 py-3 font-medium text-ink-primary">{n.title}</td>
                  <td className="px-4 py-3">
                    {n.negotiation_mode === "live" ? (
                      <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">
                        <Radio className="mr-1 h-3 w-3" /> Live
                      </Badge>
                    ) : (
                      <Badge variant="outline">RFQ</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={STATUS_META[n.status].cls}>
                      {STATUS_META[n.status].label}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">{formatDate(n.response_deadline)}</td>
                  <td className="px-4 py-3 text-ink-secondary">{formatDate(n.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <NewNegotiationTypeDialog open={pickerOpen} onOpenChange={setPickerOpen} />
    </div>
  );
}
