// Vedlegg som ansatt har knyttet til ordren. Produksjon/butikk kan åpne dem
// direkte herfra. Bilder vises som thumbs; AI-oppsummeringer er kun referanse.
import { useEffect, useState } from "react";
import { Download, Image as ImageIcon, Loader2, Paperclip, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  getTicketAttachmentSignedUrl,
  useOrderAttachments,
  type AttachmentKind,
} from "@/ordre/hooks/useTickets";

const KIND_LABEL: Record<AttachmentKind, string> = {
  unclassified: "Uklassifisert",
  inspiration: "Inspirasjon",
  logo: "Logo",
  document: "Dokument",
  other: "Annet",
};

const KIND_BADGE: Record<AttachmentKind, string> = {
  unclassified: "bg-muted text-muted-foreground",
  inspiration: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  logo: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  document: "bg-slate-500/15 text-foreground",
  other: "bg-muted text-foreground",
};

export function OrderAttachmentsCard({ orderId, className }: { orderId: string; className?: string }) {
  const { toast } = useToast();
  const { data: attachments = [], isLoading } = useOrderAttachments(orderId);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const a of attachments) {
        if (!a.storage_path) continue;
        if (!a.content_type?.startsWith("image/")) continue;
        if (thumbs[a.id]) continue;
        try {
          const url = await getTicketAttachmentSignedUrl(a.id, { inline: true });
          if (cancelled) return;
          setThumbs((s) => ({ ...s, [a.id]: url }));
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments.map((a) => a.id).join(",")]);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Paperclip className="h-4 w-4" /> Vedlegg
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (attachments.length === 0) return null;

  const onDownload = async (id: string) => {
    setDownloadingId(id);
    try {
      const url = await getTicketAttachmentSignedUrl(id);
      window.open(url, "_blank");
    } catch (e) {
      toast({ title: "Nedlasting feilet", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Paperclip className="h-4 w-4" /> Vedlegg ({attachments.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3 sm:grid-cols-2">
          {attachments.map((a) => {
            const isImage = a.content_type?.startsWith("image/");
            const thumb = thumbs[a.id];
            return (
              <li key={a.id} className="rounded-md border p-3 space-y-2 bg-card">
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted hover:opacity-90 disabled:cursor-default"
                    onClick={() => a.storage_path && onDownload(a.id)}
                    disabled={!a.storage_path}
                  >
                    {isImage && thumb ? (
                      // eslint-disable-next-line jsx-a11y/img-redundant-alt
                      <img src={thumb} alt={a.file_name} className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="truncate text-sm font-medium" title={a.file_name}>
                      {a.file_name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {a.content_type ?? "ukjent type"}
                      {a.size_bytes ? ` · ${(a.size_bytes / 1024).toFixed(0)} kB` : ""}
                    </div>
                    <Badge variant="outline" className={`text-[10px] ${KIND_BADGE[a.kind]}`}>
                      {KIND_LABEL[a.kind]}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 self-start text-xs"
                    disabled={!a.storage_path || downloadingId === a.id}
                    onClick={() => onDownload(a.id)}
                  >
                    {downloadingId === a.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                  </Button>
                </div>
                {a.ai_summary && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                    <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
                      <Sparkles className="h-3 w-3" /> AI-referanse (ikke fasit)
                    </div>
                    <div className="whitespace-pre-wrap">{a.ai_summary}</div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

export default OrderAttachmentsCard;
