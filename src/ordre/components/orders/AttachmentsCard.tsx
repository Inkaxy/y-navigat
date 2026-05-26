// Vedleggskort for ticket: bilde-thumbs, klassifisering, kobling til ordre,
// AI-oppsummering (referanse — ikke fasit).
import { useEffect, useState } from "react";
import { Download, Image as ImageIcon, Loader2, Paperclip, Sparkles, Link2, Link2Off } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  getTicketAttachmentSignedUrl,
  useUpdateAttachment,
  type AttachmentKind,
  type TicketAttachment,
} from "@/ordre/hooks/useTickets";

const KIND_OPTS: { value: AttachmentKind; label: string }[] = [
  { value: "unclassified", label: "Uklassifisert" },
  { value: "inspiration", label: "Inspirasjonsbilde" },
  { value: "logo", label: "Logo" },
  { value: "document", label: "Dokument" },
  { value: "other", label: "Annet" },
];

const KIND_BADGE: Record<AttachmentKind, string> = {
  unclassified: "bg-muted text-muted-foreground",
  inspiration: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  logo: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  document: "bg-slate-500/15 text-foreground",
  other: "bg-muted text-foreground",
};

type Props = {
  attachments: TicketAttachment[];
  relatedOrderId: string | null;
  relatedOrderNumber?: string | null;
};

export function AttachmentsCard({ attachments, relatedOrderId, relatedOrderNumber }: Props) {
  const { toast } = useToast();
  const updateAtt = useUpdateAttachment();
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [summarizingId, setSummarizingId] = useState<string | null>(null);

  // Last inline-signerte URLs for bildevedlegg (preview)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const images = attachments.filter(
        (a) => a.storage_path && a.content_type?.startsWith("image/") && !thumbs[a.id],
      );
      for (const a of images) {
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

  if (attachments.length === 0) return null;

  const onDownload = async (att: TicketAttachment) => {
    setDownloadingId(att.id);
    try {
      const url = await getTicketAttachmentSignedUrl(att.id);
      window.open(url, "_blank");
    } catch (e) {
      toast({ title: "Nedlasting feilet", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  };

  const onChangeKind = async (att: TicketAttachment, kind: AttachmentKind) => {
    await updateAtt.mutateAsync({ id: att.id, patch: { kind } });
  };

  const onToggleAttach = async (att: TicketAttachment) => {
    if (att.attached_to_order_id) {
      await updateAtt.mutateAsync({
        id: att.id,
        patch: { attached_to_order_id: null, attached_by: null, attached_at: null },
      });
      toast({ title: "Kobling fjernet" });
      return;
    }
    if (!relatedOrderId) {
      toast({
        title: "Ingen koblet ordre",
        description: "Koble ticketen til en ordre først.",
        variant: "destructive",
      });
      return;
    }
    const { data: u } = await supabase.auth.getUser();
    await updateAtt.mutateAsync({
      id: att.id,
      patch: {
        attached_to_order_id: relatedOrderId,
        attached_by: u.user?.id ?? null,
        attached_at: new Date().toISOString(),
      },
    });
    toast({ title: "Knyttet til ordre" });
  };

  const onSummarize = async (att: TicketAttachment) => {
    setSummarizingId(att.id);
    try {
      const { data, error } = await supabase.functions.invoke("summarize-attachment", {
        body: { attachment_id: att.id },
      });
      if (error) throw error;
      toast({ title: "AI-oppsummering klar", description: data?.summary?.slice(0, 80) ?? "" });
    } catch (e) {
      toast({ title: "AI-oppsummering feilet", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSummarizingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
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
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {isImage && thumb ? (
                      // eslint-disable-next-line jsx-a11y/img-redundant-alt
                      <img src={thumb} alt={a.file_name} className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="truncate text-sm font-medium" title={a.file_name}>
                      {a.file_name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {a.content_type ?? "ukjent type"}
                      {a.size_bytes ? ` · ${(a.size_bytes / 1024).toFixed(0)} kB` : ""}
                      {!a.storage_path && " · for stor (ikke lagret)"}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <Badge variant="outline" className={`text-[10px] ${KIND_BADGE[a.kind]}`}>
                        {KIND_OPTS.find((o) => o.value === a.kind)?.label}
                      </Badge>
                      {a.attached_to_order_id && (
                        <Badge variant="outline" className="text-[10px]">
                          Knyttet til ordre
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={a.kind}
                    onValueChange={(v) => onChangeKind(a, v as AttachmentKind)}
                  >
                    <SelectTrigger className="h-7 w-40 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KIND_OPTS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={!a.storage_path || downloadingId === a.id}
                    onClick={() => onDownload(a)}
                  >
                    {downloadingId === a.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    <span className="ml-1">Last ned</span>
                  </Button>
                  <Button
                    size="sm"
                    variant={a.attached_to_order_id ? "secondary" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => onToggleAttach(a)}
                    disabled={!relatedOrderId && !a.attached_to_order_id}
                    title={
                      !relatedOrderId && !a.attached_to_order_id
                        ? "Koble ticket til ordre først"
                        : undefined
                    }
                  >
                    {a.attached_to_order_id ? (
                      <>
                        <Link2Off className="h-3 w-3" /> <span className="ml-1">Fjern kobling</span>
                      </>
                    ) : (
                      <>
                        <Link2 className="h-3 w-3" />
                        <span className="ml-1">
                          Knytt til ordre{relatedOrderNumber ? ` ${relatedOrderNumber}` : ""}
                        </span>
                      </>
                    )}
                  </Button>
                  {isImage && a.storage_path && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => onSummarize(a)}
                      disabled={summarizingId === a.id}
                    >
                      {summarizingId === a.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      <span className="ml-1">Oppsummer</span>
                    </Button>
                  )}
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

export default AttachmentsCard;
