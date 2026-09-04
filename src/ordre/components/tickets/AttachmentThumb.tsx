import { useEffect, useState } from "react";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getTicketAttachmentSignedUrl,
  type TicketAttachment,
} from "@/ordre/hooks/useTickets";
import AttachmentCakePrintButton from "@/ordre/components/tickets/AttachmentCakePrintButton";

/**
 * Ett vedlegg i tråden. Delt mellom full ticket-rute og peek-panelet.
 */
export default function AttachmentThumb({
  att,
  onOpen,
  ticketId,
  ticketSubject,
  order,
  customerName,
  compact,
}: {
  att: TicketAttachment;
  onOpen: (url: string, name: string) => void;
  ticketId?: string;
  ticketSubject?: string | null;
  order?: { id: string; order_number: string; delivery_date: string | null } | null;
  customerName?: string | null;
  /** Peek-panelet er smalt — dropp utskriftsknappen der. */
  compact?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    getTicketAttachmentSignedUrl(att.id, { inline: true })
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [att.id]);

  const ct = att.content_type ?? "";
  const isImage = ct.startsWith("image/");
  const isPdf = ct === "application/pdf" || /\.pdf$/i.test(att.file_name);

  const handleClick = () => {
    if (!url) return;
    if (isImage) onOpen(url, att.file_name);
    else window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-border bg-background p-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={!url}
        className="group flex items-center gap-2 rounded-[8px] px-0.5 py-0.5 text-left text-caption hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
        title={isPdf ? "Åpne PDF i ny fane" : isImage ? "Åpne bilde" : "Åpne vedlegg"}
      >
        {isImage && url ? (
          <img src={url} alt={att.file_name} className="h-10 w-10 rounded object-cover" />
        ) : (
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded",
              isPdf
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground",
            )}
          >
            {isPdf ? (
              <span className="text-[10px] font-bold">PDF</span>
            ) : (
              <Paperclip className="h-4 w-4" aria-hidden="true" />
            )}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">{att.file_name}</div>
          {failed ? (
            <div className="text-caption text-destructive">Kunne ikke hentes</div>
          ) : (
            att.size_bytes != null && (
              <div className="text-caption text-muted-foreground">
                {(att.size_bytes / 1024).toFixed(0)} kB
              </div>
            )
          )}
        </div>
      </button>
      {isImage && ticketId && !compact && (
        <AttachmentCakePrintButton
          att={att}
          ticketId={ticketId}
          ticketSubject={ticketSubject}
          order={order}
          customerName={customerName}
        />
      )}
    </div>
  );
}
