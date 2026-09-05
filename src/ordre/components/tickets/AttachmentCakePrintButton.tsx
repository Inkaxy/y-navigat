// «Legg i kakeprint» direkte på et bildevedlegg i henvendelsen.
// Virker uavhengig av om henvendelsen har en ordre fra før:
//  - koblet ordre  → kakebildet lages mot ordren, med ordrens leveringsdato
//  - ingen ordre   → dato velges i dialogen, bildet lages uten ordre
//  - allerede lagt → knappen erstattes av status + lenke til Kakebilder
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CakeSlice, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { tomorrow } from "@/ordre/lib/format";
import {
  createCakeImageFromTicketAttachment,
  findCakeImageByTicketAttachment,
  findCakeLineForOrder,
  type CakeImage,
} from "@/ordre/lib/cakeImages";
import type { TicketAttachment } from "@/ordre/hooks/useTickets";

const STATUS_LABEL: Record<string, string> = {
  venter: "venter på redigering",
  ferdig_redigert: "klar til utskrift",
  skrevet_ut: "skrevet ut",
};

export default function AttachmentCakePrintButton({
  att,
  ticketId,
  ticketSubject,
  order,
  customerName,
}: {
  att: TicketAttachment;
  ticketId: string;
  ticketSubject?: string | null;
  order?: {
    id: string;
    order_number: string;
    delivery_date: string | null;
  } | null;
  customerName?: string | null;
}) {
  const qc = useQueryClient();
  const [dateOpen, setDateOpen] = useState(false);
  const [date, setDate] = useState<string>(tomorrow());
  const [saving, setSaving] = useState(false);

  const { data: existing } = useQuery({
    queryKey: ["cake-image-for-attachment", att.id],
    queryFn: () => findCakeImageByTicketAttachment(att.id),
  });

  const create = async (deliveryDate: string) => {
    setSaving(true);
    try {
      const cakeLine = order?.id
        ? await findCakeLineForOrder(order.id).catch(() => null)
        : null;
      if (order && cakeLine && !cakeLine.has_label_product) {
        toast.warning("Ingen etikettvare i ordren — bildet får ikke etikettnummer");
      }
      const image: CakeImage = await createCakeImageFromTicketAttachment({
        attachment_id: att.id,
        file_name: att.file_name,
        ticket_id: ticketId,
        order_id: order?.id ?? null,
        order_line_id: cakeLine?.order_line_id ?? null,
        production_department_id: cakeLine?.production_department_id ?? null,
        delivery_date: deliveryDate,
        title:
          (ticketSubject ?? "").trim() ||
          att.file_name.replace(/\.[^.]+$/, "") ||
          "Kakebilde",
        customer_name: customerName ?? null,
        order_ref: order?.order_number ?? null,
      });

      await supabase
        .from("ticket_attachments")
        .update({ kind: "cake_image" } as never)
        .eq("id", att.id);

      qc.invalidateQueries({ queryKey: ["cake-image-for-attachment", att.id] });
      qc.invalidateQueries({ queryKey: ["cake-images"] });
      qc.invalidateQueries({ queryKey: ["cake-images-for", ticketId] });
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
      setDateOpen(false);
      toast.success(`Lagt i kakeprint-køen for ${image.delivery_date}`, {
        action: {
          label: "Åpne Kakebilder",
          onClick: () => window.open("/ordre/kakebilder", "_blank"),
        },
      });
    } catch (e) {
      toast.error("Kunne ikke legge i kakeprint", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  if (existing) {
    return (
      <Link
        to="/ordre/kakebilder"
        className="inline-flex items-center gap-1.5 rounded-md border border-pink-500/40 bg-pink-500/10 px-2 py-1 text-[11px] font-semibold text-pink-800 hover:bg-pink-500/20 dark:text-pink-200"
        title="Vedlegget ligger allerede i kakeprint-køen"
      >
        <CakeSlice className="h-3 w-3" />
        I kakeprint
        {existing.label_number ? ` · etikett #${existing.label_number}` : " · Mangler etikett"} ·{" "}
        {STATUS_LABEL[existing.status] ?? existing.status}
      </Link>
    );
  }

  const onClick = () => {
    if (order?.delivery_date) {
      void create(order.delivery_date);
    } else {
      setDate(order?.delivery_date ?? tomorrow());
      setDateOpen(true);
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 text-[11px]"
        onClick={onClick}
        disabled={saving}
      >
        {saving ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <CakeSlice className="h-3 w-3" />
        )}
        Legg i kakeprint
      </Button>

      <Dialog open={dateOpen} onOpenChange={setDateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Legg bildet i kakeprint</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cake-print-date">Leveringsdato</Label>
            <Input
              id="cake-print-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Henvendelsen har ingen ordre ennå. Kobles den til en ordre senere,
              oppdateres kakebildet automatisk med ordre og dato.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDateOpen(false)}>
              Avbryt
            </Button>
            <Button onClick={() => void create(date)} disabled={!date || saving}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Legg i køen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
